-- Simplify host commission: 0% for first 3 bookings, then platform's host_commission_percent
CREATE OR REPLACE FUNCTION public.calculate_host_tier(_host_id uuid)
 RETURNS TABLE(tier text, commission_pct numeric, completed_bookings integer, avg_rating numeric, response_rate numeric, cancellation_rate numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_completed integer;
  v_total integer;
  v_avg_rating numeric;
  v_cancelled integer;
  v_cancel_rate numeric;
  v_response_rate numeric := 100;
  v_tiers jsonb;
  v_free_bookings integer;
  v_standard_pct numeric;
BEGIN
  SELECT COALESCE(settings, '{}'::jsonb) INTO v_tiers
    FROM public.platform_controls WHERE section = 'payout_tiers' LIMIT 1;

  v_free_bookings := COALESCE((v_tiers->>'starter_free_bookings')::integer, 3);

  -- Use platform-wide host commission as the standard rate
  SELECT COALESCE(host_commission_percent, 8) INTO v_standard_pct
  FROM public.platform_settings LIMIT 1;
  v_standard_pct := COALESCE(v_standard_pct, 8);

  SELECT
    COUNT(*) FILTER (WHERE status IN ('completed','confirmed')),
    COUNT(*) FILTER (WHERE status IN ('confirmed','completed')),
    COUNT(*) FILTER (WHERE status = 'cancelled')
  INTO v_completed, v_total, v_cancelled
  FROM public.bookings WHERE host_id = _host_id;

  SELECT COALESCE(AVG(overall_rating), 0) INTO v_avg_rating
    FROM public.reviews WHERE host_id = _host_id AND is_public = true;

  v_cancel_rate := CASE WHEN v_total > 0 THEN (v_cancelled::numeric / v_total) * 100 ELSE 0 END;

  IF v_completed < v_free_bookings THEN
    tier := 'starter'; commission_pct := 0;
  ELSE
    tier := 'standard'; commission_pct := v_standard_pct;
  END IF;

  completed_bookings := v_completed;
  avg_rating := v_avg_rating;
  response_rate := v_response_rate;
  cancellation_rate := v_cancel_rate;
  RETURN NEXT;
END;
$function$;