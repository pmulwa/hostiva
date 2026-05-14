CREATE OR REPLACE FUNCTION public.acct_run_self_test()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_host_id uuid := gen_random_uuid();
  v_guest_id uuid := gen_random_uuid();
  v_property_id uuid;
  v_booking_id uuid;
  v_entry_id uuid;
  v_entry_id_after uuid;
  v_total_debits numeric;
  v_total_credits numeric;
  v_line_count int;
  v_external_count int;
  v_ext_after_dup int;
  v_results jsonb := '[]'::jsonb;
  v_passed int := 0;
  v_failed int := 0;
  v_ok boolean;
  v_check text;
  v_detail text;
BEGIN
  IF NOT public.has_role(v_caller, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'acct_run_self_test: admin role required';
  END IF;

  -- Setup ---------------------------------------------------------
  INSERT INTO public.properties (
    id, host_id, title, description, address, city, country,
    property_type, max_guests, bedrooms, bathrooms, beds, base_price,
    status, listing_status
  ) VALUES (
    gen_random_uuid(), v_host_id, 'ACCT TEST PROPERTY', 'self-test',
    '1 Test St', 'Testville', 'TestLand',
    'apartment', 2, 1, 1, 1, 100,
    'approved', 'live'
  ) RETURNING id INTO v_property_id;

  INSERT INTO public.acct_settings (host_id, base_currency, accounting_method, seeded, go_live_date)
  VALUES (v_host_id, 'USD', 'accrual', true, CURRENT_DATE - INTERVAL '30 days');

  INSERT INTO public.acct_platforms (host_id, name, currency, commission_percent, is_active)
  VALUES (v_host_id, 'Hostly', 'USD', 0, true);

  INSERT INTO public.acct_chart_of_accounts (host_id, code, name, type, is_system) VALUES
    (v_host_id, '1010', 'Cash Clearing',      'asset',   true),
    (v_host_id, '4010', 'Rental Revenue',     'revenue', true),
    (v_host_id, '4020', 'Cleaning Income',    'revenue', true),
    (v_host_id, '5010', 'Platform Commission','expense', true);

  -- 1. Pending booking should not auto-post -----------------------
  INSERT INTO public.bookings (
    id, host_id, guest_id, property_id,
    check_in_date, check_out_date, num_nights, num_guests,
    nightly_rate, subtotal, cleaning_fee, service_fee, total_price,
    currency, status
  ) VALUES (
    gen_random_uuid(), v_host_id, v_guest_id, v_property_id,
    CURRENT_DATE - INTERVAL '5 days', CURRENT_DATE - INTERVAL '2 days', 3, 2,
    100, 300, 50, 30, 380,
    'USD', 'pending'
  ) RETURNING id INTO v_booking_id;

  SELECT COUNT(*) INTO v_external_count
    FROM public.acct_external_bookings
   WHERE host_id = v_host_id AND notes = 'AUTO:HOSTLY:' || v_booking_id::text;
  v_check := 'pending booking does not auto-post';
  v_ok := v_external_count = 0;
  v_detail := format('external rows=%s', v_external_count);
  v_results := v_results || jsonb_build_object('check', v_check, 'ok', v_ok, 'detail', v_detail);
  IF v_ok THEN v_passed := v_passed + 1; ELSE v_failed := v_failed + 1; END IF;

  -- 2. Completion creates a journal entry -------------------------
  UPDATE public.bookings SET status = 'completed' WHERE id = v_booking_id;

  SELECT journal_entry_id INTO v_entry_id
    FROM public.acct_external_bookings
   WHERE host_id = v_host_id AND notes = 'AUTO:HOSTLY:' || v_booking_id::text;
  v_check := 'completion creates journal entry';
  v_ok := v_entry_id IS NOT NULL;
  v_detail := format('entry_id=%s', v_entry_id);
  v_results := v_results || jsonb_build_object('check', v_check, 'ok', v_ok, 'detail', v_detail);
  IF v_ok THEN v_passed := v_passed + 1; ELSE v_failed := v_failed + 1; END IF;

  -- 3. Debits = Credits ------------------------------------------
  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0), COUNT(*)
    INTO v_total_debits, v_total_credits, v_line_count
    FROM public.acct_journal_lines WHERE entry_id = v_entry_id;
  v_check := 'debits equal credits';
  v_ok := v_total_debits = v_total_credits AND v_total_debits > 0;
  v_detail := format('debits=%s credits=%s lines=%s', v_total_debits, v_total_credits, v_line_count);
  v_results := v_results || jsonb_build_object('check', v_check, 'ok', v_ok, 'detail', v_detail);
  IF v_ok THEN v_passed := v_passed + 1; ELSE v_failed := v_failed + 1; END IF;

  -- 4. Idempotency: re-completing must NOT create a second post --
  UPDATE public.bookings SET status = 'pending' WHERE id = v_booking_id;
  UPDATE public.bookings SET status = 'completed' WHERE id = v_booking_id;
  SELECT COUNT(*) INTO v_ext_after_dup
    FROM public.acct_external_bookings
   WHERE host_id = v_host_id AND notes = 'AUTO:HOSTLY:' || v_booking_id::text;
  v_check := 'double-post prevented on re-completion';
  v_ok := v_ext_after_dup = 1;
  v_detail := format('external rows=%s', v_ext_after_dup);
  v_results := v_results || jsonb_build_object('check', v_check, 'ok', v_ok, 'detail', v_detail);
  IF v_ok THEN v_passed := v_passed + 1; ELSE v_failed := v_failed + 1; END IF;

  -- 5. Hard guard: direct duplicate insert must fail -------------
  BEGIN
    INSERT INTO public.acct_external_bookings (
      host_id, property_id, check_in_date, check_out_date,
      num_nights, gross_revenue, status, notes
    ) VALUES (
      v_host_id, v_property_id, CURRENT_DATE - 5, CURRENT_DATE - 2,
      3, 300, 'completed', 'AUTO:HOSTLY:' || v_booking_id::text
    );
    v_ok := false; v_detail := 'duplicate insert succeeded';
  EXCEPTION WHEN unique_violation THEN
    v_ok := true; v_detail := 'unique_violation raised';
  END;
  v_check := 'unique-index blocks duplicate auto-post';
  v_results := v_results || jsonb_build_object('check', v_check, 'ok', v_ok, 'detail', v_detail);
  IF v_ok THEN v_passed := v_passed + 1; ELSE v_failed := v_failed + 1; END IF;

  -- 6. Persistence across non-status edits -----------------------
  UPDATE public.bookings SET guest_message = 'edited after posting' WHERE id = v_booking_id;
  SELECT journal_entry_id INTO v_entry_id_after
    FROM public.acct_external_bookings
   WHERE host_id = v_host_id AND notes = 'AUTO:HOSTLY:' || v_booking_id::text;
  v_check := 'journal entry persists across booking edits';
  v_ok := v_entry_id_after = v_entry_id;
  v_detail := format('before=%s after=%s', v_entry_id, v_entry_id_after);
  v_results := v_results || jsonb_build_object('check', v_check, 'ok', v_ok, 'detail', v_detail);
  IF v_ok THEN v_passed := v_passed + 1; ELSE v_failed := v_failed + 1; END IF;

  -- 7. Stay-date resync ------------------------------------------
  UPDATE public.bookings
     SET check_out_date = CURRENT_DATE - INTERVAL '1 day'
   WHERE id = v_booking_id;
  PERFORM 1 FROM public.acct_journal_entries
    WHERE id = v_entry_id AND entry_date = (CURRENT_DATE - INTERVAL '1 day')::date;
  v_check := 'entry_date resyncs to new check-out';
  v_ok := FOUND;
  v_results := v_results || jsonb_build_object('check', v_check, 'ok', v_ok, 'detail', NULL);
  IF v_ok THEN v_passed := v_passed + 1; ELSE v_failed := v_failed + 1; END IF;

  -- 8. Balance trigger rejects unbalanced lines ------------------
  BEGIN
    INSERT INTO public.acct_journal_lines (entry_id, account_id, debit, credit)
    SELECT v_entry_id, account_id, 999, 0
      FROM public.acct_journal_lines WHERE entry_id = v_entry_id LIMIT 1;
    v_ok := false; v_detail := 'unbalanced insert succeeded';
  EXCEPTION WHEN OTHERS THEN
    v_ok := true; v_detail := SQLERRM;
  END;
  v_check := 'balance trigger rejects unbalanced line';
  v_results := v_results || jsonb_build_object('check', v_check, 'ok', v_ok, 'detail', v_detail);
  IF v_ok THEN v_passed := v_passed + 1; ELSE v_failed := v_failed + 1; END IF;

  -- Cleanup ------------------------------------------------------
  DELETE FROM public.acct_journal_lines WHERE entry_id = v_entry_id;
  DELETE FROM public.acct_journal_entries WHERE id = v_entry_id;
  DELETE FROM public.acct_external_bookings WHERE host_id = v_host_id;
  DELETE FROM public.bookings WHERE id = v_booking_id;
  DELETE FROM public.acct_chart_of_accounts WHERE host_id = v_host_id;
  DELETE FROM public.acct_platforms WHERE host_id = v_host_id;
  DELETE FROM public.acct_settings WHERE host_id = v_host_id;
  DELETE FROM public.properties WHERE id = v_property_id;

  RETURN jsonb_build_object(
    'passed', v_passed,
    'failed', v_failed,
    'total', v_passed + v_failed,
    'checks', v_results,
    'ran_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.acct_run_self_test() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acct_run_self_test() TO authenticated;
COMMENT ON FUNCTION public.acct_run_self_test() IS
  'Admin-only accounting cycle self-test. Returns a JSON report of all assertions.';