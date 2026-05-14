-- 1) Add account PIN (hashed) to host accounting settings
ALTER TABLE public.acct_settings
  ADD COLUMN IF NOT EXISTS account_pin_hash text,
  ADD COLUMN IF NOT EXISTS account_pin_set_at timestamptz;

-- 2) Helper: pgcrypto for PIN hashing/verification
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 3) RPC: set or change the host's accounting PIN.
--    First-time set: no current_pin required.
--    Change: must verify current_pin.
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
    IF p_current_pin IS NULL OR crypt(p_current_pin, v_existing_hash) <> v_existing_hash THEN
      RAISE EXCEPTION 'Current PIN is incorrect' USING ERRCODE = '28P01';
    END IF;
  END IF;

  INSERT INTO public.acct_settings (host_id, account_pin_hash, account_pin_set_at)
  VALUES (v_host, crypt(p_new_pin, gen_salt('bf', 10)), now())
  ON CONFLICT (host_id) DO UPDATE
    SET account_pin_hash = EXCLUDED.account_pin_hash,
        account_pin_set_at = now(),
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.acct_set_account_pin(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acct_set_account_pin(text, text) TO authenticated;

-- 4) RPC: verify PIN (returns boolean) — used as a guard before destructive ops
CREATE OR REPLACE FUNCTION public.acct_verify_account_pin(p_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_host uuid := auth.uid();
  v_hash text;
BEGIN
  IF v_host IS NULL THEN RETURN false; END IF;
  SELECT account_pin_hash INTO v_hash FROM public.acct_settings WHERE host_id = v_host;
  IF v_hash IS NULL OR p_pin IS NULL THEN RETURN false; END IF;
  RETURN crypt(p_pin, v_hash) = v_hash;
END;
$$;

REVOKE ALL ON FUNCTION public.acct_verify_account_pin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acct_verify_account_pin(text) TO authenticated;

-- 5) RPC: PIN-gated destructive reset of host's accounting records.
--    Wipes journal lines/entries, expenses, fixed assets, external bookings,
--    bank charges, opening balances, reconciliations — but PRESERVES the
--    chart of accounts, categories, settings, and the PIN itself.
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
  SELECT account_pin_hash INTO v_hash FROM public.acct_settings WHERE host_id = v_host;
  IF v_hash IS NULL THEN
    RAISE EXCEPTION 'Set an account PIN before resetting' USING ERRCODE = '28000';
  END IF;
  IF p_pin IS NULL OR crypt(p_pin, v_hash) <> v_hash THEN
    RAISE EXCEPTION 'Incorrect PIN' USING ERRCODE = '28P01';
  END IF;

  -- Delete journal lines first (FK to entries via host scope)
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