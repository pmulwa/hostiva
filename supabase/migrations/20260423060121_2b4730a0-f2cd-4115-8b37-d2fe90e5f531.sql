
-- Enforce host-accounting income recognition policy:
--   Revenue (and platform fees) are recorded only when the stay is COMPLETED
--   (i.e. after check-out). Pending/confirmed bookings no longer post to the
--   host's books. Entry date is always the check_out_date for booking revenue.
-- Cancelled bookings keep their existing import behaviour (manual import only).

CREATE OR REPLACE FUNCTION public.acct_autopost_hostly_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_platform_id uuid;
  v_settings_seeded boolean;
  v_base_currency text;
  v_entry_date date;
  v_booking_ccy text;
  v_already uuid;
  v_entry_id uuid;
  v_acc_deposit uuid;
  v_acc_revenue uuid;
  v_acc_commission uuid;
  v_acc_cleaning uuid;
  v_nights integer;
  v_subtotal numeric(14,2);
  v_gross numeric(14,2);
  v_cleaning numeric(14,2);
  v_commission numeric(14,2);
  v_host_service_fee numeric(14,2);
  v_host_commission numeric(14,2);
  v_host_commission_tax numeric(14,2);
  v_charged_to text;
  v_service_fee_pct numeric;
  v_service_tax_pct numeric;
  v_host_commission_pct numeric;
  v_host_tax_pct numeric;
  v_service_fee_with_tax numeric(14,2);
  v_net numeric(14,2);
BEGIN
  -- HARD POLICY: revenue is recognised at check-out only.
  -- Only post when the booking transitions into 'completed'.
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;

  SELECT seeded, base_currency
    INTO v_settings_seeded, v_base_currency
    FROM public.acct_settings WHERE host_id = NEW.host_id;
  IF v_settings_seeded IS NOT TRUE THEN RETURN NEW; END IF;

  -- Always check-out date for income recognition.
  v_entry_date := NEW.check_out_date;

  SELECT id INTO v_already FROM public.acct_external_bookings
    WHERE host_id = NEW.host_id AND notes = 'AUTO:HOSTLY:' || NEW.id::text LIMIT 1;
  IF v_already IS NOT NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_platform_id FROM public.acct_platforms
    WHERE host_id = NEW.host_id AND name = 'Hostly' LIMIT 1;

  SELECT
    COALESCE(service_fee_percent, 10),
    COALESCE(service_tax_percent, 16),
    COALESCE(host_commission_percent, 3),
    COALESCE(host_tax_percent, 16)
  INTO v_service_fee_pct, v_service_tax_pct, v_host_commission_pct, v_host_tax_pct
  FROM public.platform_settings LIMIT 1;
  v_service_fee_pct := COALESCE(v_service_fee_pct, 10);
  v_service_tax_pct := COALESCE(v_service_tax_pct, 16);
  v_host_commission_pct := COALESCE(v_host_commission_pct, 3);
  v_host_tax_pct := COALESCE(v_host_tax_pct, 16);

  SELECT COALESCE(p.service_fee_charged_to, 'guest') INTO v_charged_to
    FROM public.properties p WHERE p.id = NEW.property_id;
  v_charged_to := COALESCE(v_charged_to, 'guest');

  v_nights := GREATEST(1, NEW.num_nights);
  v_subtotal := COALESCE(NEW.subtotal, 0);
  v_cleaning := COALESCE(NEW.cleaning_fee, 0);

  v_service_fee_with_tax := ROUND(v_subtotal * (v_service_fee_pct / 100.0) * (1 + v_service_tax_pct / 100.0), 2);
  v_host_service_fee := CASE
    WHEN v_charged_to = 'host' THEN v_service_fee_with_tax
    WHEN v_charged_to = 'split' THEN ROUND(v_service_fee_with_tax / 2.0, 2)
    ELSE 0
  END;
  v_host_commission := ROUND(v_subtotal * (v_host_commission_pct / 100.0), 2);
  v_host_commission_tax := ROUND(v_host_commission * (v_host_tax_pct / 100.0), 2);

  v_gross := v_subtotal;
  v_commission := v_host_service_fee + v_host_commission + v_host_commission_tax;
  v_net := v_subtotal - v_commission + v_cleaning;
  v_booking_ccy := UPPER(COALESCE(NEW.currency, 'USD'));

  IF v_booking_ccy <> UPPER(COALESCE(v_base_currency, 'USD')) THEN
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
      'Hostly payout', v_entry_date, 'AUTO:HOSTLY:' || NEW.id::text,
      v_booking_ccy, 1, NULL, NULL, 'needs_fx', 'receivable'
    );
    RETURN NEW;
  END IF;

  SELECT id INTO v_acc_deposit  FROM public.acct_chart_of_accounts WHERE host_id = NEW.host_id AND code = '1100' LIMIT 1;
  SELECT id INTO v_acc_revenue  FROM public.acct_chart_of_accounts WHERE host_id = NEW.host_id AND code = '4010' LIMIT 1;
  SELECT id INTO v_acc_commission FROM public.acct_chart_of_accounts WHERE host_id = NEW.host_id AND code = '5010' LIMIT 1;
  SELECT id INTO v_acc_cleaning FROM public.acct_chart_of_accounts WHERE host_id = NEW.host_id AND code = '4100' LIMIT 1;

  IF v_acc_deposit IS NULL OR v_acc_revenue IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.acct_journal_entries (host_id, entry_date, description, reference, source_type, source_id)
  VALUES (
    NEW.host_id,
    v_entry_date,
    'Hostly booking — ' || COALESCE(NEW.id::text, ''),
    'HOSTLY-' || UPPER(SUBSTRING(NEW.id::text, 1, 8)),
    'booking',
    NEW.id
  ) RETURNING id INTO v_entry_id;

  INSERT INTO public.acct_journal_lines (entry_id, account_id, debit, credit, memo) VALUES
    (v_entry_id, v_acc_deposit, v_net, 0, 'Net payout from Hostly');
  IF v_commission > 0 AND v_acc_commission IS NOT NULL THEN
    INSERT INTO public.acct_journal_lines (entry_id, account_id, debit, credit, memo)
    VALUES (v_entry_id, v_acc_commission, v_commission, 0, 'Hostly fees (service + commission + tax)');
  END IF;
  IF v_gross > 0 THEN
    INSERT INTO public.acct_journal_lines (entry_id, account_id, debit, credit, memo)
    VALUES (v_entry_id, v_acc_revenue, 0, v_gross, 'Gross rental revenue (recognised at check-out)');
  END IF;
  IF v_cleaning > 0 AND v_acc_cleaning IS NOT NULL THEN
    INSERT INTO public.acct_journal_lines (entry_id, account_id, debit, credit, memo)
    VALUES (v_entry_id, v_acc_cleaning, 0, v_cleaning, 'Cleaning fee income');
  END IF;

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
    'Hostly payout', v_entry_date, 'AUTO:HOSTLY:' || NEW.id::text,
    v_booking_ccy, 1, v_net, v_entry_id, 'auto', 'received'
  );

  RETURN NEW;
END;
$function$;

-- Re-sync trigger: when a completed booking's check_out_date moves, the journal
-- entry follows. Force check_out as the basis regardless of acct_settings.
CREATE OR REPLACE FUNCTION public.acct_resync_booking_entry_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_new_date date;
BEGIN
  IF NEW.check_in_date = OLD.check_in_date
     AND NEW.check_out_date = OLD.check_out_date THEN
    RETURN NEW;
  END IF;

  -- Income is recognised at check-out — always use check_out_date.
  v_new_date := NEW.check_out_date;

  UPDATE public.acct_journal_entries
  SET entry_date = v_new_date,
      updated_at = now()
  WHERE host_id = NEW.host_id
    AND source_type = 'booking'
    AND source_id IS NOT NULL
    AND source_id::uuid = NEW.id
    AND entry_date <> v_new_date;

  UPDATE public.acct_external_bookings
  SET payment_received_date = v_new_date,
      check_in_date = NEW.check_in_date,
      check_out_date = NEW.check_out_date,
      updated_at = now()
  WHERE host_id = NEW.host_id
    AND notes LIKE 'AUTO:HOSTLY:' || NEW.id::text || '%';

  RETURN NEW;
END;
$function$;

-- Update the manual import RPC to also use check_out_date as the entry basis,
-- so the policy is consistent whether bookings are auto-posted or back-filled.
CREATE OR REPLACE FUNCTION public.acct_import_hostly_bookings(_host_id uuid)
RETURNS TABLE(imported integer, needs_fx integer, skipped integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_platform_id uuid;
  v_settings_seeded boolean;
  v_base_currency text;
  v_entry_date date;
  v_booking record;
  v_booking_ccy text;
  v_already uuid;
  v_entry_id uuid;
  v_acc_deposit uuid;
  v_acc_revenue uuid;
  v_acc_commission uuid;
  v_acc_cleaning uuid;
  v_nights integer;
  v_subtotal numeric(14,2);
  v_gross numeric(14,2);
  v_cleaning numeric(14,2);
  v_commission numeric(14,2);
  v_host_service_fee numeric(14,2);
  v_host_commission numeric(14,2);
  v_host_commission_tax numeric(14,2);
  v_charged_to text;
  v_service_fee_pct numeric;
  v_service_tax_pct numeric;
  v_host_commission_pct numeric;
  v_host_tax_pct numeric;
  v_service_fee_with_tax numeric(14,2);
  v_net numeric(14,2);
  v_refund_pct numeric;
  v_imported integer := 0;
  v_needs_fx integer := 0;
  v_skipped integer := 0;
BEGIN
  IF auth.uid() <> _host_id AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT seeded, base_currency
    INTO v_settings_seeded, v_base_currency
    FROM public.acct_settings WHERE host_id = _host_id;
  IF v_settings_seeded IS NOT TRUE THEN
    RAISE EXCEPTION 'Accounting not seeded for this host yet';
  END IF;

  SELECT
    COALESCE(service_fee_percent, 10),
    COALESCE(service_tax_percent, 16),
    COALESCE(host_commission_percent, 3),
    COALESCE(host_tax_percent, 16)
  INTO v_service_fee_pct, v_service_tax_pct, v_host_commission_pct, v_host_tax_pct
  FROM public.platform_settings LIMIT 1;
  v_service_fee_pct := COALESCE(v_service_fee_pct, 10);
  v_service_tax_pct := COALESCE(v_service_tax_pct, 16);
  v_host_commission_pct := COALESCE(v_host_commission_pct, 3);
  v_host_tax_pct := COALESCE(v_host_tax_pct, 16);

  SELECT id INTO v_platform_id FROM public.acct_platforms
    WHERE host_id = _host_id AND name = 'Hostly' LIMIT 1;

  SELECT id INTO v_acc_deposit  FROM public.acct_chart_of_accounts WHERE host_id = _host_id AND code = '1100' LIMIT 1;
  SELECT id INTO v_acc_revenue  FROM public.acct_chart_of_accounts WHERE host_id = _host_id AND code = '4010' LIMIT 1;
  SELECT id INTO v_acc_commission FROM public.acct_chart_of_accounts WHERE host_id = _host_id AND code = '5010' LIMIT 1;
  SELECT id INTO v_acc_cleaning FROM public.acct_chart_of_accounts WHERE host_id = _host_id AND code = '4100' LIMIT 1;

  FOR v_booking IN
    SELECT b.*, p.service_fee_charged_to AS prop_charged_to
    FROM public.bookings b
    LEFT JOIN public.properties p ON p.id = b.property_id
    WHERE b.host_id = _host_id
      AND b.status IN ('completed','cancelled')
    ORDER BY b.check_out_date
  LOOP
    IF v_booking.status = 'cancelled' THEN
      IF COALESCE(v_booking.total_price, 0) = 0 THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
      v_refund_pct := ROUND((COALESCE(v_booking.refund_amount, 0) / NULLIF(v_booking.total_price, 0)) * 100);
      IF v_refund_pct NOT IN (0, 50) THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
    END IF;

    SELECT id INTO v_already FROM public.acct_external_bookings
      WHERE host_id = _host_id AND notes LIKE 'AUTO:HOSTLY:' || v_booking.id::text || '%' LIMIT 1;
    IF v_already IS NOT NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Income is always recognised at check-out.
    v_entry_date := v_booking.check_out_date;

    v_nights := GREATEST(1, COALESCE(v_booking.num_nights, 1));
    v_subtotal := COALESCE(v_booking.subtotal, 0);
    v_cleaning := COALESCE(v_booking.cleaning_fee, 0);
    v_charged_to := COALESCE(v_booking.prop_charged_to, 'guest');

    IF v_booking.status = 'cancelled' AND v_refund_pct = 50 THEN
      v_subtotal := ROUND(v_subtotal * 0.5, 2);
      v_cleaning := 0;
    END IF;

    v_service_fee_with_tax := ROUND(v_subtotal * (v_service_fee_pct / 100.0) * (1 + v_service_tax_pct / 100.0), 2);
    v_host_service_fee := CASE
      WHEN v_charged_to = 'host' THEN v_service_fee_with_tax
      WHEN v_charged_to = 'split' THEN ROUND(v_service_fee_with_tax / 2.0, 2)
      ELSE 0
    END;
    v_host_commission := ROUND(v_subtotal * (v_host_commission_pct / 100.0), 2);
    v_host_commission_tax := ROUND(v_host_commission * (v_host_tax_pct / 100.0), 2);

    v_gross := v_subtotal;
    v_commission := v_host_service_fee + v_host_commission + v_host_commission_tax;
    v_net := v_subtotal - v_commission + v_cleaning;
    v_booking_ccy := UPPER(COALESCE(v_booking.currency, 'USD'));

    IF v_booking_ccy <> UPPER(COALESCE(v_base_currency, 'USD')) THEN
      INSERT INTO public.acct_external_bookings (
        host_id, property_id, platform_id, guest_name,
        check_in_date, check_out_date, num_nights,
        gross_revenue, cleaning_fee, commission_amount, net_payout,
        payment_method, payment_received_date, notes,
        txn_currency, fx_rate, base_amount, journal_entry_id, status, payment_status
      ) VALUES (
        _host_id, v_booking.property_id, v_platform_id, NULL,
        v_booking.check_in_date, v_booking.check_out_date, v_nights,
        v_gross, v_cleaning, v_commission, v_net,
        'Hostly payout', v_entry_date,
        'AUTO:HOSTLY:' || v_booking.id::text || CASE WHEN v_booking.status = 'cancelled' THEN ' (cancelled, kept ' || v_refund_pct || '%)' ELSE '' END,
        v_booking_ccy, 1, NULL, NULL, 'needs_fx', 'receivable'
      );
      v_needs_fx := v_needs_fx + 1;
      CONTINUE;
    END IF;

    IF v_acc_deposit IS NULL OR v_acc_revenue IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.acct_journal_entries (host_id, entry_date, description, reference, source_type, source_id)
    VALUES (
      _host_id,
      v_entry_date,
      'Hostly booking — ' || COALESCE(v_booking.id::text, '') || CASE WHEN v_booking.status = 'cancelled' THEN ' (cancelled, kept ' || v_refund_pct || '%)' ELSE '' END,
      'HOSTLY-' || UPPER(SUBSTRING(v_booking.id::text, 1, 8)),
      'booking',
      v_booking.id
    ) RETURNING id INTO v_entry_id;

    INSERT INTO public.acct_journal_lines (entry_id, account_id, debit, credit, memo) VALUES
      (v_entry_id, v_acc_deposit, v_net, 0, 'Net payout from Hostly');
    IF v_commission > 0 AND v_acc_commission IS NOT NULL THEN
      INSERT INTO public.acct_journal_lines (entry_id, account_id, debit, credit, memo)
      VALUES (v_entry_id, v_acc_commission, v_commission, 0, 'Hostly fees (service + commission + tax)');
    END IF;
    IF v_gross > 0 THEN
      INSERT INTO public.acct_journal_lines (entry_id, account_id, debit, credit, memo)
      VALUES (v_entry_id, v_acc_revenue, 0, v_gross, 'Gross rental revenue (recognised at check-out)');
    END IF;
    IF v_cleaning > 0 AND v_acc_cleaning IS NOT NULL THEN
      INSERT INTO public.acct_journal_lines (entry_id, account_id, debit, credit, memo)
      VALUES (v_entry_id, v_acc_cleaning, 0, v_cleaning, 'Cleaning fee income');
    END IF;

    INSERT INTO public.acct_external_bookings (
      host_id, property_id, platform_id, guest_name,
      check_in_date, check_out_date, num_nights,
      gross_revenue, cleaning_fee, commission_amount, net_payout,
      payment_method, payment_received_date, notes,
      txn_currency, fx_rate, base_amount, journal_entry_id, status, payment_status
    ) VALUES (
      _host_id, v_booking.property_id, v_platform_id, NULL,
      v_booking.check_in_date, v_booking.check_out_date, v_nights,
      v_gross, v_cleaning, v_commission, v_net,
      'Hostly payout', v_entry_date,
      'AUTO:HOSTLY:' || v_booking.id::text || CASE WHEN v_booking.status = 'cancelled' THEN ' (cancelled, kept ' || v_refund_pct || '%)' ELSE '' END,
      v_booking_ccy, 1, v_net, v_entry_id, 'auto', 'received'
    );
    v_imported := v_imported + 1;
  END LOOP;

  RETURN QUERY SELECT v_imported, v_needs_fx, v_skipped;
END;
$function$;

-- Force the entry-date basis to 'check_out' for every host. The setting
-- remains in the schema for backwards compatibility but is now a constant.
UPDATE public.acct_settings SET entry_date_basis = 'check_out' WHERE entry_date_basis <> 'check_out';
ALTER TABLE public.acct_settings ALTER COLUMN entry_date_basis SET DEFAULT 'check_out';
