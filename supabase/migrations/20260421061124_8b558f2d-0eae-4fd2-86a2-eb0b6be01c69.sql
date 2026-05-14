-- Host deductions ledger: penalties / fines / clawbacks that reduce the host's
-- next payout. Negative balance = host owes platform; settled when next payout
-- is processed (deduction taken first off the payout amount).
CREATE TABLE IF NOT EXISTS public.host_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL,
  booking_id uuid,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'USD',
  reason_code text NOT NULL,           -- e.g. 'host_cancel_fine', 'damage_claim', 'manual_adjustment'
  reason_detail text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','settled','waived')),
  settled_payout_id uuid,              -- references payouts.id when applied
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX IF NOT EXISTS idx_host_deductions_host_pending
  ON public.host_deductions (host_id, status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_host_deductions_booking
  ON public.host_deductions (booking_id);

ALTER TABLE public.host_deductions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hosts view own deductions"
  ON public.host_deductions FOR SELECT
  TO authenticated
  USING (auth.uid() = host_id);

CREATE POLICY "Hosts insert own deductions"
  ON public.host_deductions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = host_id);

CREATE POLICY "Staff manage all deductions"
  ON public.host_deductions FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'finance_officer'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'finance_officer'::app_role)
  );

CREATE TRIGGER trg_host_deductions_updated_at
  BEFORE UPDATE ON public.host_deductions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Settle all pending deductions for a host against a payout. Returns the total
-- amount settled. Caller is responsible for subtracting this from the payout.
CREATE OR REPLACE FUNCTION public.settle_host_deductions_for_payout(_payout_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_host uuid;
  v_total numeric(14,2) := 0;
BEGIN
  SELECT host_id INTO v_host FROM public.payouts WHERE id = _payout_id;
  IF v_host IS NULL THEN RETURN 0; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_total
    FROM public.host_deductions
    WHERE host_id = v_host AND status = 'pending';

  UPDATE public.host_deductions
    SET status = 'settled',
        settled_payout_id = _payout_id,
        settled_at = now()
    WHERE host_id = v_host AND status = 'pending';

  RETURN v_total;
END;
$$;