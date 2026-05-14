-- =====================================================================
-- Reconciliation table: per-booking sign-off with snapshot of totals
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.acct_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE,
  host_id uuid NOT NULL,
  reconciled_by uuid NOT NULL,
  reconciled_at timestamptz NOT NULL DEFAULT now(),
  total_debits numeric(14,2) NOT NULL,
  total_credits numeric(14,2) NOT NULL,
  is_balanced boolean NOT NULL,
  notes text,
  reversed_at timestamptz,
  reversed_by uuid,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_acct_recon_booking ON public.acct_reconciliations(booking_id);
CREATE INDEX IF NOT EXISTS idx_acct_recon_host ON public.acct_reconciliations(host_id);
CREATE INDEX IF NOT EXISTS idx_acct_recon_reversed ON public.acct_reconciliations(reversed_at);

ALTER TABLE public.acct_reconciliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage reconciliations"
  ON public.acct_reconciliations FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Finance officers view reconciliations"
  ON public.acct_reconciliations FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'finance_officer'::app_role));

CREATE POLICY "Hosts view own reconciliations"
  ON public.acct_reconciliations FOR SELECT
  TO authenticated
  USING (auth.uid() = host_id);

CREATE TRIGGER trg_acct_reconciliations_updated_at
BEFORE UPDATE ON public.acct_reconciliations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================================
-- Bank charges: admin-entered bank fees / FX adjustments / deductions
-- Each charge auto-posts a balanced journal entry against the host books
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.acct_bank_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL,
  booking_id uuid,
  charge_type text NOT NULL CHECK (charge_type IN (
    'bank_fee','wire_fee','fx_adjustment','chargeback','reversal','other'
  )),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'USD',
  charge_date date NOT NULL DEFAULT CURRENT_DATE,
  description text NOT NULL,
  reference text,
  journal_entry_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text
);

CREATE INDEX IF NOT EXISTS idx_acct_bank_charges_host ON public.acct_bank_charges(host_id);
CREATE INDEX IF NOT EXISTS idx_acct_bank_charges_booking ON public.acct_bank_charges(booking_id);
CREATE INDEX IF NOT EXISTS idx_acct_bank_charges_date ON public.acct_bank_charges(charge_date);

ALTER TABLE public.acct_bank_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage bank charges"
  ON public.acct_bank_charges FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Finance officers manage bank charges"
  ON public.acct_bank_charges FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'finance_officer'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'finance_officer'::app_role));

CREATE POLICY "Hosts view own bank charges"
  ON public.acct_bank_charges FOR SELECT
  TO authenticated
  USING (auth.uid() = host_id);

-- =====================================================================
-- Function: auto-post a bank charge to the journal
-- Creates a balanced entry: Dr Bank Fees expense / Cr Cash Clearing
-- Returns the new journal_entry_id.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.acct_post_bank_charge(p_charge_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_charge public.acct_bank_charges;
  v_entry_id uuid;
  v_acc_expense uuid;
  v_acc_cash uuid;
BEGIN
  IF NOT (public.has_role(v_caller, 'admin'::app_role)
       OR public.has_role(v_caller, 'finance_officer'::app_role)) THEN
    RAISE EXCEPTION 'acct_post_bank_charge: admin or finance_officer required';
  END IF;

  SELECT * INTO v_charge FROM public.acct_bank_charges WHERE id = p_charge_id;
  IF v_charge IS NULL THEN
    RAISE EXCEPTION 'Bank charge % not found', p_charge_id;
  END IF;
  IF v_charge.journal_entry_id IS NOT NULL THEN
    RETURN v_charge.journal_entry_id; -- idempotent
  END IF;

  -- Resolve / create the two accounts we need on the host's CoA.
  SELECT id INTO v_acc_expense FROM public.acct_chart_of_accounts
   WHERE host_id = v_charge.host_id AND code = '5020' LIMIT 1;
  IF v_acc_expense IS NULL THEN
    INSERT INTO public.acct_chart_of_accounts (host_id, code, name, type, is_system)
    VALUES (v_charge.host_id, '5020', 'Bank & Payment Fees', 'expense', true)
    RETURNING id INTO v_acc_expense;
  END IF;

  SELECT id INTO v_acc_cash FROM public.acct_chart_of_accounts
   WHERE host_id = v_charge.host_id AND code = '1010' LIMIT 1;
  IF v_acc_cash IS NULL THEN
    INSERT INTO public.acct_chart_of_accounts (host_id, code, name, type, is_system)
    VALUES (v_charge.host_id, '1010', 'Cash Clearing', 'asset', true)
    RETURNING id INTO v_acc_cash;
  END IF;

  -- Create the journal entry header.
  INSERT INTO public.acct_journal_entries (
    host_id, entry_date, reference, description, source_type, source_id, posted, created_by
  ) VALUES (
    v_charge.host_id, v_charge.charge_date,
    COALESCE(v_charge.reference, 'BANK-' || substr(v_charge.id::text, 1, 8)),
    v_charge.charge_type || ': ' || v_charge.description,
    'manual'::acct_journal_source,
    'BANK_CHARGE:' || v_charge.id::text,
    true,
    v_caller
  ) RETURNING id INTO v_entry_id;

  -- Balanced double-entry: expense up, cash down.
  INSERT INTO public.acct_journal_lines (entry_id, account_id, debit, credit, memo)
  VALUES
    (v_entry_id, v_acc_expense, v_charge.amount, 0,
     v_charge.charge_type || ' / ' || COALESCE(v_charge.reference, 'no-ref')),
    (v_entry_id, v_acc_cash, 0, v_charge.amount,
     'Cash settlement of bank charge');

  UPDATE public.acct_bank_charges
     SET journal_entry_id = v_entry_id
   WHERE id = p_charge_id;

  RETURN v_entry_id;
END;
$$;

REVOKE ALL ON FUNCTION public.acct_post_bank_charge(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acct_post_bank_charge(uuid) TO authenticated;

-- =====================================================================
-- Function: void a bank charge (reverses the journal entry)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.acct_void_bank_charge(p_charge_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_charge public.acct_bank_charges;
  v_entry_id uuid;
  v_acc_expense uuid;
  v_acc_cash uuid;
BEGIN
  IF NOT (public.has_role(v_caller, 'admin'::app_role)
       OR public.has_role(v_caller, 'finance_officer'::app_role)) THEN
    RAISE EXCEPTION 'acct_void_bank_charge: admin or finance_officer required';
  END IF;

  SELECT * INTO v_charge FROM public.acct_bank_charges WHERE id = p_charge_id;
  IF v_charge IS NULL THEN RAISE EXCEPTION 'Bank charge % not found', p_charge_id; END IF;
  IF v_charge.voided_at IS NOT NULL THEN RETURN; END IF;

  IF v_charge.journal_entry_id IS NOT NULL THEN
    SELECT id INTO v_acc_expense FROM public.acct_chart_of_accounts
     WHERE host_id = v_charge.host_id AND code = '5020' LIMIT 1;
    SELECT id INTO v_acc_cash FROM public.acct_chart_of_accounts
     WHERE host_id = v_charge.host_id AND code = '1010' LIMIT 1;

    INSERT INTO public.acct_journal_entries (
      host_id, entry_date, reference, description, source_type, source_id, posted, created_by
    ) VALUES (
      v_charge.host_id, CURRENT_DATE,
      'VOID-' || COALESCE(v_charge.reference, substr(v_charge.id::text, 1, 8)),
      'VOID: ' || v_charge.charge_type || ' — ' || COALESCE(p_reason, 'no reason'),
      'manual'::acct_journal_source,
      'BANK_CHARGE_VOID:' || v_charge.id::text,
      true, v_caller
    ) RETURNING id INTO v_entry_id;

    INSERT INTO public.acct_journal_lines (entry_id, account_id, debit, credit, memo)
    VALUES
      (v_entry_id, v_acc_cash, v_charge.amount, 0, 'Reversal of bank charge'),
      (v_entry_id, v_acc_expense, 0, v_charge.amount, 'Reversal of bank charge');
  END IF;

  UPDATE public.acct_bank_charges
     SET voided_at = now(), voided_by = v_caller, void_reason = p_reason
   WHERE id = p_charge_id;
END;
$$;

REVOKE ALL ON FUNCTION public.acct_void_bank_charge(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acct_void_bank_charge(uuid, text) TO authenticated;