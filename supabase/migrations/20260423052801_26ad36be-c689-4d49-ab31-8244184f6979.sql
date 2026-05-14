-- Server-side validation for Commission by Package tiers and platform fee/tax settings.
-- Mirrors the client-side rules in AdminControls so invalid configs cannot be persisted via API.

CREATE OR REPLACE FUNCTION public.validate_platform_controls()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s jsonb;
  starter_free_pct numeric;
  starter_low_pct numeric;
  standard_pct numeric;
  starter_free_bookings numeric;
  starter_low_bookings numeric;
BEGIN
  IF NEW.section <> 'payout_tiers' THEN
    RETURN NEW;
  END IF;

  s := COALESCE(NEW.settings, '{}'::jsonb);

  -- Coerce values; missing keys are treated as the documented defaults so partial
  -- updates from the UI continue to work.
  starter_free_pct       := COALESCE((s->>'starter_free_pct')::numeric, 0);
  starter_low_pct        := COALESCE((s->>'starter_low_pct')::numeric, 6);
  standard_pct           := COALESCE((s->>'standard_pct')::numeric, 8);
  starter_free_bookings  := COALESCE((s->>'starter_free_bookings')::numeric, 3);
  starter_low_bookings   := COALESCE((s->>'starter_low_bookings')::numeric, 10);

  -- Commission percentages must sit inside the published 0–30% band (host rate only).
  IF starter_free_pct < 0 OR starter_free_pct > 30 THEN
    RAISE EXCEPTION 'starter_free_pct must be between 0 and 30 (got %)', starter_free_pct
      USING ERRCODE = '22023';
  END IF;
  IF starter_low_pct < 0 OR starter_low_pct > 30 THEN
    RAISE EXCEPTION 'starter_low_pct must be between 0 and 30 (got %)', starter_low_pct
      USING ERRCODE = '22023';
  END IF;
  IF standard_pct < 0 OR standard_pct > 30 THEN
    RAISE EXCEPTION 'standard_pct must be between 0 and 30 (got %)', standard_pct
      USING ERRCODE = '22023';
  END IF;

  -- Booking thresholds must be sane integers and the Reduced band must end strictly
  -- after the Welcome band so the ladder cannot overlap.
  IF starter_free_bookings < 0 OR starter_free_bookings > 500
     OR starter_free_bookings <> floor(starter_free_bookings) THEN
    RAISE EXCEPTION 'starter_free_bookings must be a whole number between 0 and 500 (got %)', starter_free_bookings
      USING ERRCODE = '22023';
  END IF;
  IF starter_low_bookings < 0 OR starter_low_bookings > 500
     OR starter_low_bookings <> floor(starter_low_bookings) THEN
    RAISE EXCEPTION 'starter_low_bookings must be a whole number between 0 and 500 (got %)', starter_low_bookings
      USING ERRCODE = '22023';
  END IF;
  IF starter_low_bookings <= starter_free_bookings THEN
    RAISE EXCEPTION 'starter_low_bookings (%) must be greater than starter_free_bookings (%)',
      starter_low_bookings, starter_free_bookings
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_platform_controls_trg ON public.platform_controls;
CREATE TRIGGER validate_platform_controls_trg
BEFORE INSERT OR UPDATE ON public.platform_controls
FOR EACH ROW
EXECUTE FUNCTION public.validate_platform_controls();


-- Companion validation for platform_settings: keep service fee (guest), host
-- commission (host), and both tax percentages within sane ranges, and keep the
-- standard_pct in payout_tiers in sync with host_commission_percent.
CREATE OR REPLACE FUNCTION public.validate_platform_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.service_fee_percent IS NULL OR NEW.service_fee_percent < 0 OR NEW.service_fee_percent > 30 THEN
    RAISE EXCEPTION 'service_fee_percent must be between 0 and 30 (got %)', NEW.service_fee_percent
      USING ERRCODE = '22023';
  END IF;
  IF NEW.host_commission_percent IS NULL OR NEW.host_commission_percent < 0 OR NEW.host_commission_percent > 30 THEN
    RAISE EXCEPTION 'host_commission_percent must be between 0 and 30 (got %)', NEW.host_commission_percent
      USING ERRCODE = '22023';
  END IF;
  IF NEW.service_tax_percent IS NULL OR NEW.service_tax_percent < 0 OR NEW.service_tax_percent > 100 THEN
    RAISE EXCEPTION 'service_tax_percent must be between 0 and 100 (got %)', NEW.service_tax_percent
      USING ERRCODE = '22023';
  END IF;
  IF NEW.host_tax_percent IS NULL OR NEW.host_tax_percent < 0 OR NEW.host_tax_percent > 100 THEN
    RAISE EXCEPTION 'host_tax_percent must be between 0 and 100 (got %)', NEW.host_tax_percent
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_platform_settings_trg ON public.platform_settings;
CREATE TRIGGER validate_platform_settings_trg
BEFORE INSERT OR UPDATE ON public.platform_settings
FOR EACH ROW
EXECUTE FUNCTION public.validate_platform_settings();


-- Keep the Standard tier rate in payout_tiers in lockstep with the platform-wide
-- host_commission_percent so saving one always reflects in the other server-side.
CREATE OR REPLACE FUNCTION public.sync_standard_tier_with_host_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.host_commission_percent IS DISTINCT FROM OLD.host_commission_percent THEN
    UPDATE public.platform_controls
       SET settings = COALESCE(settings, '{}'::jsonb)
                      || jsonb_build_object('standard_pct', NEW.host_commission_percent),
           updated_at = now()
     WHERE section = 'payout_tiers';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_standard_tier_trg ON public.platform_settings;
CREATE TRIGGER sync_standard_tier_trg
AFTER UPDATE ON public.platform_settings
FOR EACH ROW
EXECUTE FUNCTION public.sync_standard_tier_with_host_commission();
