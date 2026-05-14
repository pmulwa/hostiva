-- 1) Update the auto-post trigger function to use the host take-home formula.
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
  IF NEW.status NOT IN ('confirmed','completed') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;

  SELECT seeded, base_currency INTO v_settings_seeded, v_base_currency
    FROM public.acct_settings WHERE host_id = NEW.host_id;
  IF v_settings_seeded IS NOT TRUE THEN RETURN NEW; END IF;

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
      'Hostly payout', NULL, 'AUTO:HOSTLY:' || NEW.id::text,
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
    NEW.check_out_date,
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
    VALUES (v_entry_id, v_acc_revenue, 0, v_gross, 'Gross rental revenue');
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
    'Hostly payout', NULL, 'AUTO:HOSTLY:' || NEW.id::text,
    v_booking_ccy, 1, v_net, v_entry_id, 'auto', 'receivable'
  );

  RETURN NEW;
END;
$function$;

-- 2) Recompute existing AUTO:HOSTLY rows in place so displayed values match host take-home.
DO $$
DECLARE
  r record;
  v_charged_to text;
  v_service_fee_pct numeric;
  v_service_tax_pct numeric;
  v_host_commission_pct numeric;
  v_host_tax_pct numeric;
  v_service_fee_with_tax numeric(14,2);
  v_host_service_fee numeric(14,2);
  v_host_commission numeric(14,2);
  v_host_commission_tax numeric(14,2);
  v_subtotal numeric(14,2);
  v_cleaning numeric(14,2);
  v_commission numeric(14,2);
  v_net numeric(14,2);
  v_acc_deposit uuid;
  v_acc_revenue uuid;
  v_acc_commission uuid;
  v_acc_cleaning uuid;
BEGIN
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

  FOR r IN
    SELECT eb.id, eb.host_id, eb.property_id, eb.gross_revenue, eb.cleaning_fee, eb.journal_entry_id
    FROM public.acct_external_bookings eb
    WHERE eb.notes LIKE 'AUTO:HOSTLY:%'
  LOOP
    SELECT COALESCE(p.service_fee_charged_to, 'guest') INTO v_charged_to
      FROM public.properties p WHERE p.id = r.property_id;
    v_charged_to := COALESCE(v_charged_to, 'guest');

    v_subtotal := COALESCE(r.gross_revenue, 0);
    v_cleaning := COALESCE(r.cleaning_fee, 0);
    v_service_fee_with_tax := ROUND(v_subtotal * (v_service_fee_pct / 100.0) * (1 + v_service_tax_pct / 100.0), 2);
    v_host_service_fee := CASE
      WHEN v_charged_to = 'host' THEN v_service_fee_with_tax
      WHEN v_charged_to = 'split' THEN ROUND(v_service_fee_with_tax / 2.0, 2)
      ELSE 0
    END;
    v_host_commission := ROUND(v_subtotal * (v_host_commission_pct / 100.0), 2);
    v_host_commission_tax := ROUND(v_host_commission * (v_host_tax_pct / 100.0), 2);
    v_commission := v_host_service_fee + v_host_commission + v_host_commission_tax;
    v_net := v_subtotal - v_commission + v_cleaning;

    UPDATE public.acct_external_bookings
      SET commission_amount = v_commission,
          net_payout = v_net,
          base_amount = COALESCE(base_amount, v_net)
      WHERE id = r.id;

    -- Rebuild journal lines if a journal entry exists.
    IF r.journal_entry_id IS NOT NULL THEN
      SELECT id INTO v_acc_deposit  FROM public.acct_chart_of_accounts WHERE host_id = r.host_id AND code = '1100' LIMIT 1;
      SELECT id INTO v_acc_revenue  FROM public.acct_chart_of_accounts WHERE host_id = r.host_id AND code = '4010' LIMIT 1;
      SELECT id INTO v_acc_commission FROM public.acct_chart_of_accounts WHERE host_id = r.host_id AND code = '5010' LIMIT 1;
      SELECT id INTO v_acc_cleaning FROM public.acct_chart_of_accounts WHERE host_id = r.host_id AND code = '4100' LIMIT 1;

      DELETE FROM public.acct_journal_lines WHERE entry_id = r.journal_entry_id;

      IF v_acc_deposit IS NOT NULL THEN
        INSERT INTO public.acct_journal_lines (entry_id, account_id, debit, credit, memo)
        VALUES (r.journal_entry_id, v_acc_deposit, v_net, 0, 'Net payout from Hostly (recomputed)');
      END IF;
      IF v_commission > 0 AND v_acc_commission IS NOT NULL THEN
        INSERT INTO public.acct_journal_lines (entry_id, account_id, debit, credit, memo)
        VALUES (r.journal_entry_id, v_acc_commission, v_commission, 0, 'Hostly fees (service + commission + tax)');
      END IF;
      IF v_subtotal > 0 AND v_acc_revenue IS NOT NULL THEN
        INSERT INTO public.acct_journal_lines (entry_id, account_id, debit, credit, memo)
        VALUES (r.journal_entry_id, v_acc_revenue, 0, v_subtotal, 'Gross rental revenue');
      END IF;
      IF v_cleaning > 0 AND v_acc_cleaning IS NOT NULL THEN
        INSERT INTO public.acct_journal_lines (entry_id, account_id, debit, credit, memo)
        VALUES (r.journal_entry_id, v_acc_cleaning, 0, v_cleaning, 'Cleaning fee income');
      END IF;
    END IF;
  END LOOP;
END;
$$;