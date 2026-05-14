
-- 1. Add an `fx_rate` editable column already exists on acct_external_bookings.
-- Add status flag for AR / paid tracking + payment clearing entries
ALTER TABLE public.acct_external_bookings
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'received' CHECK (payment_status IN ('received','receivable','cleared')),
  ADD COLUMN IF NOT EXISTS clearing_entry_id uuid REFERENCES public.acct_journal_entries(id) ON DELETE SET NULL;

-- 2. Trigger: auto-post Hostly bookings into acct_external_bookings + journal when confirmed/completed.
CREATE OR REPLACE FUNCTION public.acct_autopost_hostly_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_platform_id uuid;
  v_settings_seeded boolean;
  v_already uuid;
  v_entry_id uuid;
  v_acc_deposit uuid;
  v_acc_revenue uuid;
  v_acc_commission uuid;
  v_acc_cleaning uuid;
  v_acc_service_fee_exp uuid;
  v_nights integer;
  v_gross numeric(14,2);
  v_cleaning numeric(14,2);
  v_commission numeric(14,2);
  v_service_fee numeric(14,2);
  v_net numeric(14,2);
BEGIN
  -- Only act on confirmed/completed transitions
  IF NEW.status NOT IN ('confirmed','completed') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;

  -- Skip if host hasn't seeded accounting yet
  SELECT seeded INTO v_settings_seeded FROM public.acct_settings WHERE host_id = NEW.host_id;
  IF v_settings_seeded IS NOT TRUE THEN RETURN NEW; END IF;

  -- Skip if already posted (idempotent)
  SELECT id INTO v_already FROM public.acct_external_bookings
    WHERE host_id = NEW.host_id AND notes = 'AUTO:HOSTLY:' || NEW.id::text LIMIT 1;
  IF v_already IS NOT NULL THEN RETURN NEW; END IF;

  -- Resolve Hostly platform
  SELECT id INTO v_platform_id FROM public.acct_platforms
    WHERE host_id = NEW.host_id AND name = 'Hostly' LIMIT 1;

  -- Resolve accounts
  SELECT id INTO v_acc_deposit  FROM public.acct_chart_of_accounts WHERE host_id = NEW.host_id AND code = '1100' LIMIT 1;
  SELECT id INTO v_acc_revenue  FROM public.acct_chart_of_accounts WHERE host_id = NEW.host_id AND code = '4010' LIMIT 1;
  SELECT id INTO v_acc_commission FROM public.acct_chart_of_accounts WHERE host_id = NEW.host_id AND code = '5010' LIMIT 1;
  SELECT id INTO v_acc_cleaning FROM public.acct_chart_of_accounts WHERE host_id = NEW.host_id AND code = '4100' LIMIT 1;

  IF v_acc_deposit IS NULL OR v_acc_revenue IS NULL THEN RETURN NEW; END IF;

  v_nights := GREATEST(1, NEW.num_nights);
  v_gross := COALESCE(NEW.subtotal, 0);
  v_cleaning := COALESCE(NEW.cleaning_fee, 0);
  v_service_fee := COALESCE(NEW.service_fee, 0);
  -- We treat service_fee as Hostly commission only when the host pays it
  v_commission := v_service_fee;
  v_net := v_gross + v_cleaning - v_commission;

  -- Insert journal entry header
  INSERT INTO public.acct_journal_entries (host_id, entry_date, description, reference, source_type, source_id)
  VALUES (
    NEW.host_id,
    NEW.check_out_date,
    'Hostly booking — ' || COALESCE(NEW.id::text, ''),
    'HOSTLY-' || UPPER(SUBSTRING(NEW.id::text, 1, 8)),
    'booking',
    NEW.id
  ) RETURNING id INTO v_entry_id;

  -- Lines (debits = credits)
  INSERT INTO public.acct_journal_lines (entry_id, account_id, debit, credit, memo) VALUES
    (v_entry_id, v_acc_deposit, v_net, 0, 'Net payout from Hostly');
  IF v_commission > 0 AND v_acc_commission IS NOT NULL THEN
    INSERT INTO public.acct_journal_lines (entry_id, account_id, debit, credit, memo)
    VALUES (v_entry_id, v_acc_commission, v_commission, 0, 'Hostly service fee');
  END IF;
  IF v_gross > 0 THEN
    INSERT INTO public.acct_journal_lines (entry_id, account_id, debit, credit, memo)
    VALUES (v_entry_id, v_acc_revenue, 0, v_gross, 'Gross rental revenue');
  END IF;
  IF v_cleaning > 0 AND v_acc_cleaning IS NOT NULL THEN
    INSERT INTO public.acct_journal_lines (entry_id, account_id, debit, credit, memo)
    VALUES (v_entry_id, v_acc_cleaning, 0, v_cleaning, 'Cleaning fee income');
  END IF;

  -- Mirror in acct_external_bookings so it appears in the host's books
  INSERT INTO public.acct_external_bookings (
    host_id, property_id, platform_id, guest_name,
    check_in_date, check_out_date, num_nights,
    gross_revenue, cleaning_fee, commission_amount, net_payout,
    payment_method, payment_received_date, notes,
    txn_currency, fx_rate, base_amount, journal_entry_id, status, payment_status
  ) VALUES (
    NEW.host_id, NEW.property_id, v_platform_id, NULL,
    NEW.check_in_date, NEW.check_out_date, v_nights,
    v_gross, v_cleaning, v_commission, v_net,
    'Hostly payout', NULL, 'AUTO:HOSTLY:' || NEW.id::text,
    COALESCE(NEW.currency, 'USD'), 1, v_net, v_entry_id, 'auto', 'receivable'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_acct_autopost_hostly ON public.bookings;
CREATE TRIGGER trg_acct_autopost_hostly
AFTER INSERT OR UPDATE OF status ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.acct_autopost_hostly_booking();
