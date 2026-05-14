-- ============ HOST PAYOUT SETTINGS ============
CREATE TABLE public.host_payout_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL UNIQUE,
  release_mode text NOT NULL DEFAULT 'standard' CHECK (release_mode IN ('standard','instant','batched')),
  payout_method text NOT NULL DEFAULT 'bank_swift' CHECK (payout_method IN ('bank_swift','bank_local','mpesa','mtn_momo','airtel_money','wise','payoneer','paypal')),
  payout_account jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_tier text NOT NULL DEFAULT 'starter' CHECK (current_tier IN ('starter','standard','preferred','elite')),
  starter_bookings_used integer NOT NULL DEFAULT 0,
  tier_locked_until date,
  long_stay_installments_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.host_payout_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hosts manage own payout settings"
  ON public.host_payout_settings FOR ALL TO authenticated
  USING (auth.uid() = host_id) WITH CHECK (auth.uid() = host_id);

CREATE POLICY "Admins finance view all payout settings"
  ON public.host_payout_settings FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'finance_officer'::app_role));

CREATE POLICY "Admins manage all payout settings"
  ON public.host_payout_settings FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_host_payout_settings_updated_at
  BEFORE UPDATE ON public.host_payout_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ PAYOUT HOLDS ============
CREATE TABLE public.payout_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL,
  host_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  reason_code text NOT NULL CHECK (reason_code IN ('FRAUD_REVIEW','DISPUTE_PENDING','BANK_VERIFICATION','SANCTIONS_CHECK','CHARGEBACK_REVIEW')),
  reason_detail text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','escalated','cancelled')),
  placed_at timestamptz NOT NULL DEFAULT now(),
  sla_due_at timestamptz NOT NULL,
  released_at timestamptz,
  manual_override_by uuid,
  override_reason text,
  status_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payout_holds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hosts view own holds"
  ON public.payout_holds FOR SELECT TO authenticated
  USING (auth.uid() = host_id);

CREATE POLICY "Staff manage all holds"
  ON public.payout_holds FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'finance_officer'::app_role) OR has_role(auth.uid(),'customer_care'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'finance_officer'::app_role) OR has_role(auth.uid(),'customer_care'::app_role));

CREATE TRIGGER update_payout_holds_updated_at
  BEFORE UPDATE ON public.payout_holds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_payout_holds_host_status ON public.payout_holds(host_id, status);
CREATE INDEX idx_payout_holds_sla ON public.payout_holds(sla_due_at) WHERE status = 'active';

-- ============ PAYOUT INSTALLMENTS ============
CREATE TABLE public.payout_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL,
  host_id uuid NOT NULL,
  installment_number integer NOT NULL,
  total_installments integer NOT NULL,
  nights_covered integer NOT NULL,
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  scheduled_release_date date NOT NULL,
  released_at timestamptz,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','released','held','cancelled')),
  payout_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, installment_number)
);

ALTER TABLE public.payout_installments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hosts view own installments"
  ON public.payout_installments FOR SELECT TO authenticated
  USING (auth.uid() = host_id);

CREATE POLICY "Staff manage installments"
  ON public.payout_installments FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'finance_officer'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'finance_officer'::app_role));

CREATE TRIGGER update_payout_installments_updated_at
  BEFORE UPDATE ON public.payout_installments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ TIER CALCULATION FUNCTION ============
CREATE OR REPLACE FUNCTION public.calculate_host_tier(_host_id uuid)
RETURNS TABLE (
  tier text,
  commission_pct numeric,
  completed_bookings integer,
  avg_rating numeric,
  response_rate numeric,
  cancellation_rate numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_completed integer;
  v_total integer;
  v_avg_rating numeric;
  v_cancelled integer;
  v_cancel_rate numeric;
  v_response_rate numeric := 100; -- placeholder until message-response tracking is added
  v_tiers jsonb;
  v_starter_free_count integer;
  v_starter_low_count integer;
  v_preferred_min_rating numeric;
  v_preferred_min_stays integer;
  v_preferred_max_cancel numeric;
  v_preferred_min_response numeric;
  v_elite_min_rating numeric;
  v_elite_min_stays integer;
  v_starter_pct numeric;
  v_starter_low_pct numeric;
  v_standard_pct numeric;
  v_preferred_pct numeric;
  v_elite_pct numeric;
BEGIN
  SELECT COALESCE(settings, '{}'::jsonb) INTO v_tiers
    FROM public.platform_controls WHERE section = 'payout_tiers' LIMIT 1;

  v_starter_free_count := COALESCE((v_tiers->>'starter_free_bookings')::integer, 3);
  v_starter_low_count  := COALESCE((v_tiers->>'starter_low_bookings')::integer, 10);
  v_starter_pct        := COALESCE((v_tiers->>'starter_free_pct')::numeric, 0);
  v_starter_low_pct    := COALESCE((v_tiers->>'starter_low_pct')::numeric, 6);
  v_standard_pct       := COALESCE((v_tiers->>'standard_pct')::numeric, 8);
  v_preferred_pct      := COALESCE((v_tiers->>'preferred_pct')::numeric, 6);
  v_elite_pct          := COALESCE((v_tiers->>'elite_pct')::numeric, 5);
  v_preferred_min_rating := COALESCE((v_tiers->>'preferred_min_rating')::numeric, 4.7);
  v_preferred_min_stays  := COALESCE((v_tiers->>'preferred_min_stays')::integer, 25);
  v_preferred_max_cancel := COALESCE((v_tiers->>'preferred_max_cancel_rate')::numeric, 2);
  v_preferred_min_response := COALESCE((v_tiers->>'preferred_min_response_rate')::numeric, 90);
  v_elite_min_rating := COALESCE((v_tiers->>'elite_min_rating')::numeric, 4.9);
  v_elite_min_stays  := COALESCE((v_tiers->>'elite_min_stays')::integer, 50);

  SELECT
    COUNT(*) FILTER (WHERE status IN ('completed')),
    COUNT(*) FILTER (WHERE status IN ('confirmed','completed')),
    COUNT(*) FILTER (WHERE status = 'cancelled')
  INTO v_completed, v_total, v_cancelled
  FROM public.bookings WHERE host_id = _host_id;

  SELECT COALESCE(AVG(overall_rating), 0) INTO v_avg_rating
    FROM public.reviews WHERE host_id = _host_id AND is_public = true;

  v_cancel_rate := CASE WHEN v_total > 0 THEN (v_cancelled::numeric / v_total) * 100 ELSE 0 END;

  IF v_completed >= v_elite_min_stays AND v_avg_rating >= v_elite_min_rating THEN
    tier := 'elite'; commission_pct := v_elite_pct;
  ELSIF v_completed >= v_preferred_min_stays
    AND v_avg_rating >= v_preferred_min_rating
    AND v_cancel_rate < v_preferred_max_cancel
    AND v_response_rate >= v_preferred_min_response THEN
    tier := 'preferred'; commission_pct := v_preferred_pct;
  ELSIF v_completed > v_starter_low_count THEN
    tier := 'standard'; commission_pct := v_standard_pct;
  ELSIF v_completed > v_starter_free_count THEN
    tier := 'starter'; commission_pct := v_starter_low_pct;
  ELSE
    tier := 'starter'; commission_pct := v_starter_pct;
  END IF;

  completed_bookings := v_completed;
  avg_rating := v_avg_rating;
  response_rate := v_response_rate;
  cancellation_rate := v_cancel_rate;
  RETURN NEXT;
END;
$$;