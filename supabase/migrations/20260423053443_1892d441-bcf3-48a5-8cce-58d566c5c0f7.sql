-- Replace tier validator with stronger ordering + machine-readable error codes.
CREATE OR REPLACE FUNCTION public.validate_platform_controls()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s jsonb;
  free_pct numeric;
  low_pct numeric;
  std_pct numeric;
  free_bk numeric;
  low_bk numeric;
BEGIN
  IF NEW.section <> 'payout_tiers' THEN
    RETURN NEW;
  END IF;

  s := COALESCE(NEW.settings, '{}'::jsonb);

  free_pct := COALESCE((s->>'starter_free_pct')::numeric, 0);
  low_pct  := COALESCE((s->>'starter_low_pct')::numeric, 6);
  std_pct  := COALESCE((s->>'standard_pct')::numeric, 8);
  free_bk  := COALESCE((s->>'starter_free_bookings')::numeric, 3);
  low_bk   := COALESCE((s->>'starter_low_bookings')::numeric, 10);

  -- Commission percentages: 0–30% inclusive (host rate only).
  IF free_pct < 0 OR free_pct > 30 THEN
    RAISE EXCEPTION '[PT_FREE_PCT] Welcome commission must be between 0%% and 30%% (got %)', free_pct USING ERRCODE = '22023';
  END IF;
  IF low_pct < 0 OR low_pct > 30 THEN
    RAISE EXCEPTION '[PT_LOW_PCT] Reduced commission must be between 0%% and 30%% (got %)', low_pct USING ERRCODE = '22023';
  END IF;
  IF std_pct < 0 OR std_pct > 30 THEN
    RAISE EXCEPTION '[PT_STD_PCT] Standard commission must be between 0%% and 30%% (got %)', std_pct USING ERRCODE = '22023';
  END IF;

  -- Booking thresholds: integers in [0, 500] inclusive.
  IF free_bk < 0 OR free_bk > 500 OR free_bk <> floor(free_bk) THEN
    RAISE EXCEPTION '[PT_FREE_BK] Welcome band end must be a whole number between 0 and 500 (got %)', free_bk USING ERRCODE = '22023';
  END IF;
  IF low_bk < 0 OR low_bk > 500 OR low_bk <> floor(low_bk) THEN
    RAISE EXCEPTION '[PT_LOW_BK] Reduced band end must be a whole number between 0 and 500 (got %)', low_bk USING ERRCODE = '22023';
  END IF;

  -- Strict ladder: Reduced must end strictly after Welcome so the three tiers
  -- (Welcome, Reduced, Standard) cover non-overlapping booking ranges:
  --   Welcome  : [0,                free_bk)
  --   Reduced  : [free_bk,          low_bk)
  --   Standard : [low_bk,           ∞)
  IF low_bk <= free_bk THEN
    RAISE EXCEPTION '[PT_LOW_BK] Reduced band end (%) must be strictly greater than Welcome band end (%) so tiers do not overlap', low_bk, free_bk USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

-- Replace platform_settings validator with code-tagged messages too.
CREATE OR REPLACE FUNCTION public.validate_platform_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.service_fee_percent IS NULL OR NEW.service_fee_percent < 0 OR NEW.service_fee_percent > 30 THEN
    RAISE EXCEPTION '[PS_SVC_PCT] Service fee must be between 0%% and 30%% (got %)', NEW.service_fee_percent USING ERRCODE = '22023';
  END IF;
  IF NEW.host_commission_percent IS NULL OR NEW.host_commission_percent < 0 OR NEW.host_commission_percent > 30 THEN
    RAISE EXCEPTION '[PS_HOST_PCT] Host commission must be between 0%% and 30%% (got %)', NEW.host_commission_percent USING ERRCODE = '22023';
  END IF;
  IF NEW.service_tax_percent IS NULL OR NEW.service_tax_percent < 0 OR NEW.service_tax_percent > 100 THEN
    RAISE EXCEPTION '[PS_SVC_TAX] Service-fee tax must be between 0%% and 100%% (got %)', NEW.service_tax_percent USING ERRCODE = '22023';
  END IF;
  IF NEW.host_tax_percent IS NULL OR NEW.host_tax_percent < 0 OR NEW.host_tax_percent > 100 THEN
    RAISE EXCEPTION '[PS_HOST_TAX] Host-commission tax must be between 0%% and 100%% (got %)', NEW.host_tax_percent USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
