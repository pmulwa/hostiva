-- 1) Per-host attempt tracker
CREATE TABLE IF NOT EXISTS public.acct_pin_attempts (
  host_id uuid PRIMARY KEY,
  failed_count integer NOT NULL DEFAULT 0,
  first_failed_at timestamptz,
  last_failed_at timestamptz,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.acct_pin_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hosts view own pin attempts" ON public.acct_pin_attempts;
CREATE POLICY "Hosts view own pin attempts"
  ON public.acct_pin_attempts FOR SELECT
  TO authenticated
  USING (auth.uid() = host_id);

DROP POLICY IF EXISTS "Admins view all pin attempts" ON public.acct_pin_attempts;
CREATE POLICY "Admins view all pin attempts"
  ON public.acct_pin_attempts FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- No INSERT/UPDATE/DELETE policies — only SECURITY DEFINER functions touch this table.

-- 2) Status RPC: PIN set? failed count? locked until?
CREATE OR REPLACE FUNCTION public.acct_pin_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_host uuid := auth.uid();
  v_set boolean := false;
  v_failed int := 0;
  v_locked timestamptz;
BEGIN
  IF v_host IS NULL THEN RETURN jsonb_build_object('authenticated', false); END IF;
  SELECT (account_pin_hash IS NOT NULL) INTO v_set
    FROM public.acct_settings WHERE host_id = v_host;
  SELECT failed_count, locked_until INTO v_failed, v_locked
    FROM public.acct_pin_attempts WHERE host_id = v_host;
  RETURN jsonb_build_object(
    'authenticated', true,
    'pin_set', COALESCE(v_set, false),
    'failed_count', COALESCE(v_failed, 0),
    'locked_until', v_locked,
    'is_locked', (v_locked IS NOT NULL AND v_locked > now())
  );
END;
$$;

REVOKE ALL ON FUNCTION public.acct_pin_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acct_pin_status() TO authenticated;

-- 3) Internal helpers
CREATE OR REPLACE FUNCTION public._acct_check_pin_lock(p_host uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locked timestamptz;
BEGIN
  SELECT locked_until INTO v_locked FROM public.acct_pin_attempts WHERE host_id = p_host;
  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RAISE EXCEPTION 'Too many failed attempts. Try again after %', to_char(v_locked, 'HH24:MI')
      USING ERRCODE = '54000';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._acct_register_pin_failure(p_host uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_count int;
  v_first timestamptz;
  v_window_minutes int := 15;
  v_max_attempts int := 5;
  v_lock_minutes int := 15;
  v_new_count int;
  v_new_first timestamptz;
  v_lock timestamptz := NULL;
BEGIN
  SELECT failed_count, first_failed_at INTO v_count, v_first
    FROM public.acct_pin_attempts WHERE host_id = p_host;

  IF v_first IS NULL OR v_now - v_first > make_interval(mins => v_window_minutes) THEN
    -- Reset window
    v_new_count := 1;
    v_new_first := v_now;
  ELSE
    v_new_count := COALESCE(v_count, 0) + 1;
    v_new_first := v_first;
  END IF;

  IF v_new_count >= v_max_attempts THEN
    v_lock := v_now + make_interval(mins => v_lock_minutes);
  END IF;

  INSERT INTO public.acct_pin_attempts (host_id, failed_count, first_failed_at, last_failed_at, locked_until, updated_at)
  VALUES (p_host, v_new_count, v_new_first, v_now, v_lock, v_now)
  ON CONFLICT (host_id) DO UPDATE
    SET failed_count = EXCLUDED.failed_count,
        first_failed_at = EXCLUDED.first_failed_at,
        last_failed_at = EXCLUDED.last_failed_at,
        locked_until = EXCLUDED.locked_until,
        updated_at = v_now;
END;
$$;

CREATE OR REPLACE FUNCTION public._acct_clear_pin_failures(p_host uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.acct_pin_attempts WHERE host_id = p_host;
END;
$$;

REVOKE ALL ON FUNCTION public._acct_check_pin_lock(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._acct_register_pin_failure(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._acct_clear_pin_failures(uuid) FROM PUBLIC;

-- 4) Rate-limited verifier (used by unlock screen). Returns boolean.
CREATE OR REPLACE FUNCTION public.acct_verify_account_pin_v2(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- Check lockout (raises if locked)
  PERFORM public._acct_check_pin_lock(v_host);

  SELECT account_pin_hash INTO v_hash FROM public.acct_settings WHERE host_id = v_host;
  IF v_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_pin_set');
  END IF;

  v_ok := (p_pin IS NOT NULL AND crypt(p_pin, v_hash) = v_hash);

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

-- 5) Update set-PIN to enforce lockout + register failure on bad current_pin
CREATE OR REPLACE FUNCTION public.acct_set_account_pin(
  p_new_pin text,
  p_current_pin text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    -- Enforce lockout when changing an existing PIN
    PERFORM public._acct_check_pin_lock(v_host);
    IF p_current_pin IS NULL OR crypt(p_current_pin, v_existing_hash) <> v_existing_hash THEN
      PERFORM public._acct_register_pin_failure(v_host);
      RAISE EXCEPTION 'Current PIN is incorrect' USING ERRCODE = '28P01';
    END IF;
  END IF;

  INSERT INTO public.acct_settings (host_id, account_pin_hash, account_pin_set_at)
  VALUES (v_host, crypt(p_new_pin, gen_salt('bf', 10)), now())
  ON CONFLICT (host_id) DO UPDATE
    SET account_pin_hash = EXCLUDED.account_pin_hash,
        account_pin_set_at = now(),
        updated_at = now();

  -- Successful set/change clears any prior failures
  PERFORM public._acct_clear_pin_failures(v_host);
END;
$$;

REVOKE ALL ON FUNCTION public.acct_set_account_pin(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acct_set_account_pin(text, text) TO authenticated;

-- 6) Update reset_books with same lockout + counter logic
CREATE OR REPLACE FUNCTION public.acct_reset_books(p_pin text, p_confirm text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  IF p_pin IS NULL OR crypt(p_pin, v_hash) <> v_hash THEN
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