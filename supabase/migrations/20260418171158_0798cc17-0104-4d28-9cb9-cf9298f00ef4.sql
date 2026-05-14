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
  v_booking record;
  v_booking_ccy text;
  v_already uuid;
  v_entry_id uuid;
  v_acc_deposit uuid;
  v_acc_revenue uuid;
  v_acc_commission uuid;
  v_acc_cleaning uuid;
  v_nights integer;
  v_gross numeric(14,2);
  v_cleaning numeric(14,2);
  v_commission numeric(14,2);
  v_service_fee numeric(14,2);
  v_net numeric(14,2);
  v_imported integer := 0;
  v_needs_fx integer := 0;
  v_skipped integer := 0;
BEGIN
  -- Verify caller is the host or an admin
  IF auth.uid() <> _host_id AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT seeded, base_currency INTO v_settings_seeded, v_base_currency
    FROM public.acct_settings WHERE host_id = _host_id;
  IF v_settings_seeded IS NOT TRUE THEN
    RAISE EXCEPTION 'Accounting not seeded for this host yet';
  END IF;

  SELECT id INTO v_platform_id FROM public.acct_platforms
    WHERE host_id = _host_id AND name = 'Hostly' LIMIT 1;

  SELECT id INTO v_acc_deposit  FROM public.acct_chart_of_accounts WHERE host_id = _host_id AND code = '1100' LIMIT 1;
  SELECT id INTO v_acc_revenue  FROM public.acct_chart_of_accounts WHERE host_id = _host_id AND code = '4010' LIMIT 1;
  SELECT id INTO v_acc_commission FROM public.acct_chart_of_accounts WHERE host_id = _host_id AND code = '5010' LIMIT 1;
  SELECT id INTO v_acc_cleaning FROM public.acct_chart_of_accounts WHERE host_id = _host_id AND code = '4100' LIMIT 1;

  FOR v_booking IN
    SELECT b.* FROM public.bookings b
    WHERE b.host_id = _host_id
      AND b.status IN ('confirmed','completed')
    ORDER BY b.check_in_date
  LOOP
    -- Skip already-imported
    SELECT id INTO v_already FROM public.acct_external_bookings
      WHERE host_id = _host_id AND notes = 'AUTO:HOSTLY:' || v_booking.id::text LIMIT 1;
    IF v_already IS NOT NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_nights := GREATEST(1, COALESCE(v_booking.num_nights, 1));
    v_gross := COALESCE(v_booking.subtotal, 0);
    v_cleaning := COALESCE(v_booking.cleaning_fee, 0);
    v_service_fee := COALESCE(v_booking.service_fee, 0);
    v_commission := v_service_fee;
    v_net := v_gross + v_cleaning - v_commission;
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
        'Hostly payout', NULL, 'AUTO:HOSTLY:' || v_booking.id::text,
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
      v_booking.check_out_date,
      'Hostly booking — ' || COALESCE(v_booking.id::text, ''),
      'HOSTLY-' || UPPER(SUBSTRING(v_booking.id::text, 1, 8)),
      'booking',
      v_booking.id
    ) RETURNING id INTO v_entry_id;

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
      'Hostly payout', NULL, 'AUTO:HOSTLY:' || v_booking.id::text,
      v_booking_ccy, 1, v_net, v_entry_id, 'auto', 'receivable'
    );
    v_imported := v_imported + 1;
  END LOOP;

  RETURN QUERY SELECT v_imported, v_needs_fx, v_skipped;
END;
$function$;