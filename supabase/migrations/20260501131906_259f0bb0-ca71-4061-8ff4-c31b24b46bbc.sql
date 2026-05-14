-- Make all PIN-related functions resolve crypt/gen_salt against the extensions schema
CREATE OR REPLACE FUNCTION public.acct_set_account_pin(
  p_new_pin text,
  p_current_pin text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_host uuid := auth.uid();
  v_existing_hash text;
BEGIN
  IF v_host IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_new_pin IS NULL OR length(p_new_pin) < 4 OR length(p_new_pin) > 12 THEN
    RAISE EXCEPTION 'PIN must be 4–12 characters' USING ERRCODE = '22023';
  END IF;
  IF p_new_pin !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'PIN must be digits only' USING ERRCODE = '22023';
  END IF;

  SELECT account_pin_hash INTO v_existing_hash
  FROM public.acct_settings WHERE host_id = v_host;

  IF v_existing_hash IS NOT NULL THEN
    PERFORM public._acct_check_pin_lock(v_host);
    IF p_current_pin IS NULL OR extensions.crypt(p_current_pin, v_existing_hash) <> v_existing_hash THEN
      PERFORM public._acct_register_pin_failure(v_host);
      RAISE EXCEPTION 'Current PIN is incorrect' USING ERRCODE = '28P01';
    END IF;
  END IF;

  INSERT INTO public.acct_settings (host_id, account_pin_hash, account_pin_set_at)
  VALUES (v_host, extensions.crypt(p_new_pin, extensions.gen_salt('bf'::text, 10)), now())
  ON CONFLICT (host_id) DO UPDATE
    SET account_pin_hash = EXCLUDED.account_pin_hash,
        account_pin_set_at = now(),
        updated_at = now();

  PERFORM public._acct_clear_pin_failures(v_host);
END;
$$;
REVOKE ALL ON FUNCTION public.acct_set_account_pin(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acct_set_account_pin(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.acct_verify_account_pin_v2(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_host uuid := auth.uid();
  v_hash text;
  v_ok boolean;
  v_locked timestamptz;
  v_failed int;
BEGIN
  IF v_host IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  PERFORM public._acct_check_pin_lock(v_host);
  SELECT account_pin_hash INTO v_hash FROM public.acct_settings WHERE host_id = v_host;
  IF v_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_pin_set');
  END IF;
  v_ok := (p_pin IS NOT NULL AND extensions.crypt(p_pin, v_hash) = v_hash);
  IF v_ok THEN
    PERFORM public._acct_clear_pin_failures(v_host);
    RETURN jsonb_build_object('ok', true);
  ELSE
    PERFORM public._acct_register_pin_failure(v_host);
    SELECT failed_count, locked_until INTO v_failed, v_locked
      FROM public.acct_pin_attempts WHERE host_id = v_host;
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'wrong_pin',
      'failed_count', COALESCE(v_failed, 0),
      'attempts_remaining', GREATEST(0, 5 - COALESCE(v_failed, 0)),
      'locked_until', v_locked
    );
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.acct_verify_account_pin_v2(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acct_verify_account_pin_v2(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.acct_reset_books(p_pin text, p_confirm text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_host uuid := auth.uid();
  v_hash text;
  v_deleted jsonb := '{}'::jsonb;
  v_n int;
BEGIN
  IF v_host IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_confirm <> 'RESET' THEN
    RAISE EXCEPTION 'Type RESET to confirm' USING ERRCODE = '22023';
  END IF;
  PERFORM public._acct_check_pin_lock(v_host);
  SELECT account_pin_hash INTO v_hash FROM public.acct_settings WHERE host_id = v_host;
  IF v_hash IS NULL THEN
    RAISE EXCEPTION 'Set an account PIN before resetting' USING ERRCODE = '28000';
  END IF;
  IF p_pin IS NULL OR extensions.crypt(p_pin, v_hash) <> v_hash THEN
    PERFORM public._acct_register_pin_failure(v_host);
    RAISE EXCEPTION 'Incorrect PIN' USING ERRCODE = '28P01';
  END IF;
  PERFORM public._acct_clear_pin_failures(v_host);

  WITH del AS (
    DELETE FROM public.acct_journal_lines l
    USING public.acct_journal_entries e
    WHERE l.entry_id = e.id AND e.host_id = v_host
    RETURNING l.id
  ) SELECT count(*) INTO v_n FROM del;
  v_deleted := v_deleted || jsonb_build_object('journal_lines', v_n);
  DELETE FROM public.acct_journal_entries WHERE host_id = v_host;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('journal_entries', v_n);
  DELETE FROM public.acct_expenses WHERE host_id = v_host;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('expenses', v_n);
  DELETE FROM public.acct_fixed_assets WHERE host_id = v_host;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('fixed_assets', v_n);
  DELETE FROM public.acct_external_bookings WHERE host_id = v_host;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('external_bookings', v_n);
  DELETE FROM public.acct_bank_charges WHERE host_id = v_host;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('bank_charges', v_n);
  DELETE FROM public.acct_opening_balances WHERE host_id = v_host;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('opening_balances', v_n);
  DELETE FROM public.acct_reconciliations WHERE host_id = v_host;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('reconciliations', v_n);

  RETURN jsonb_build_object('reset_at', now(), 'deleted', v_deleted);
END;
$$;
REVOKE ALL ON FUNCTION public.acct_reset_books(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acct_reset_books(text, text) TO authenticated;