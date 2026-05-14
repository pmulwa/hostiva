-- 1) Fix gen_salt cast issue in PIN setter
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
    PERFORM public._acct_check_pin_lock(v_host);
    IF p_current_pin IS NULL OR public.crypt(p_current_pin, v_existing_hash) <> v_existing_hash THEN
      PERFORM public._acct_register_pin_failure(v_host);
      RAISE EXCEPTION 'Current PIN is incorrect' USING ERRCODE = '28P01';
    END IF;
  END IF;

  INSERT INTO public.acct_settings (host_id, account_pin_hash, account_pin_set_at)
  VALUES (v_host, public.crypt(p_new_pin, public.gen_salt('bf'::text, 10)), now())
  ON CONFLICT (host_id) DO UPDATE
    SET account_pin_hash = EXCLUDED.account_pin_hash,
        account_pin_set_at = now(),
        updated_at = now();

  PERFORM public._acct_clear_pin_failures(v_host);
END;
$$;

REVOKE ALL ON FUNCTION public.acct_set_account_pin(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acct_set_account_pin(text, text) TO authenticated;

-- 2) Admin-only override: clear a host's lockout (does NOT bypass PIN for the host;
--    it only resets the failed-attempt counter so they can try again).
CREATE OR REPLACE FUNCTION public.acct_admin_unlock_host(
  p_host_id uuid,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_was jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;
  IF p_host_id IS NULL THEN
    RAISE EXCEPTION 'host_id required' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'failed_count', failed_count,
    'locked_until', locked_until
  ) INTO v_was
  FROM public.acct_pin_attempts WHERE host_id = p_host_id;

  DELETE FROM public.acct_pin_attempts WHERE host_id = p_host_id;

  INSERT INTO public.audit_logs (admin_id, action, entity_type, entity_id, details)
  VALUES (
    v_caller,
    'acct_pin_lockout_cleared',
    'acct_pin_attempts',
    p_host_id::text,
    jsonb_build_object(
      'reason', COALESCE(p_reason, ''),
      'previous_state', COALESCE(v_was, '{}'::jsonb)
    )
  );

  RETURN jsonb_build_object('ok', true, 'host_id', p_host_id, 'cleared_at', now(), 'previous_state', COALESCE(v_was, '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.acct_admin_unlock_host(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acct_admin_unlock_host(uuid, text) TO authenticated;