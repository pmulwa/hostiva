-- ==========================================
-- TRUST, SAFETY & NOTIFICATIONS SCHEMA
-- ==========================================

-- 1. Fraud risk scores (one per booking)
CREATE TABLE public.fraud_risk_scores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id UUID NOT NULL UNIQUE,
  guest_id UUID NOT NULL,
  score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  tier TEXT NOT NULL DEFAULT 'auto_approve' CHECK (tier IN ('auto_approve','flag_review','require_verification','block_review')),
  base_score INTEGER NOT NULL DEFAULT 0,
  payment_signals INTEGER NOT NULL DEFAULT 0,
  geo_signals INTEGER NOT NULL DEFAULT 0,
  behavioural_signals INTEGER NOT NULL DEFAULT 0,
  signals_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_taken TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fraud_risk_scores_guest ON public.fraud_risk_scores(guest_id);
CREATE INDEX idx_fraud_risk_scores_tier ON public.fraud_risk_scores(tier);

ALTER TABLE public.fraud_risk_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage fraud scores"
ON public.fraud_risk_scores FOR ALL TO authenticated
USING (has_role(auth.uid(),'admin'::app_role))
WITH CHECK (has_role(auth.uid(),'admin'::app_role));

CREATE POLICY "Finance officers view fraud scores"
ON public.fraud_risk_scores FOR SELECT TO authenticated
USING (has_role(auth.uid(),'finance_officer'::app_role) OR has_role(auth.uid(),'customer_care'::app_role) OR has_role(auth.uid(),'moderator'::app_role));

-- 2. Manual review queue
CREATE TABLE public.manual_review_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('booking','user','listing','message','payout')),
  entity_id UUID NOT NULL,
  reason TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_review','approved','rejected','escalated')),
  assigned_to UUID,
  fraud_score_id UUID REFERENCES public.fraud_risk_scores(id) ON DELETE SET NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  sla_due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_review_queue_status ON public.manual_review_queue(status);
CREATE INDEX idx_review_queue_entity ON public.manual_review_queue(entity_type, entity_id);
CREATE INDEX idx_review_queue_sla ON public.manual_review_queue(sla_due_at) WHERE status IN ('pending','in_review');

ALTER TABLE public.manual_review_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage review queue"
ON public.manual_review_queue FOR ALL TO authenticated
USING (
  has_role(auth.uid(),'admin'::app_role)
  OR has_role(auth.uid(),'customer_care'::app_role)
  OR has_role(auth.uid(),'moderator'::app_role)
  OR has_role(auth.uid(),'operations'::app_role)
)
WITH CHECK (
  has_role(auth.uid(),'admin'::app_role)
  OR has_role(auth.uid(),'customer_care'::app_role)
  OR has_role(auth.uid(),'moderator'::app_role)
  OR has_role(auth.uid(),'operations'::app_role)
);

-- 3. Anti-circumvention strikes
CREATE TABLE public.anti_circumvention_strikes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  message_id UUID,
  violation_type TEXT NOT NULL CHECK (violation_type IN ('phone','email','url','payment_bypass','off_platform_phrase','other')),
  detected_content TEXT NOT NULL,
  offence_number INTEGER NOT NULL DEFAULT 1,
  action_taken TEXT NOT NULL CHECK (action_taken IN ('warn','block','suspend','ban')),
  reviewed_by UUID,
  appealed BOOLEAN NOT NULL DEFAULT false,
  appeal_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_strikes_user ON public.anti_circumvention_strikes(user_id);
CREATE INDEX idx_strikes_offence ON public.anti_circumvention_strikes(user_id, offence_number);

ALTER TABLE public.anti_circumvention_strikes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own strikes"
ON public.anti_circumvention_strikes FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Staff manage strikes"
ON public.anti_circumvention_strikes FOR ALL TO authenticated
USING (
  has_role(auth.uid(),'admin'::app_role)
  OR has_role(auth.uid(),'moderator'::app_role)
  OR has_role(auth.uid(),'customer_care'::app_role)
)
WITH CHECK (
  has_role(auth.uid(),'admin'::app_role)
  OR has_role(auth.uid(),'moderator'::app_role)
  OR has_role(auth.uid(),'customer_care'::app_role)
);

-- 4. Notification log
CREATE TABLE public.notification_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('in_app','push','email','sms','whatsapp')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','delivered','failed','skipped','opened','clicked')),
  subject TEXT,
  body TEXT,
  related_entity_type TEXT,
  related_entity_id UUID,
  external_id TEXT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notif_log_user ON public.notification_log(user_id, created_at DESC);
CREATE INDEX idx_notif_log_unread ON public.notification_log(user_id, is_read) WHERE is_read = false;
CREATE INDEX idx_notif_log_event ON public.notification_log(event_type);

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own notifications"
ON public.notification_log FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users update own notifications"
ON public.notification_log FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admins view all notifications"
ON public.notification_log FOR SELECT TO authenticated
USING (has_role(auth.uid(),'admin'::app_role));

-- 5. Extended notification preferences
CREATE TABLE public.notification_preferences_extended (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  whatsapp_opted_in BOOLEAN NOT NULL DEFAULT false,
  whatsapp_phone TEXT,
  sms_phone TEXT,
  push_token TEXT,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  timezone TEXT DEFAULT 'UTC',
  channel_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_preferences_extended ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own extended prefs"
ON public.notification_preferences_extended FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins view extended prefs"
ON public.notification_preferences_extended FOR SELECT TO authenticated
USING (has_role(auth.uid(),'admin'::app_role));

-- 6. Force majeure events
CREATE TABLE public.force_majeure_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('natural_disaster','pandemic','armed_conflict','travel_ban','government_order','other')),
  affected_country TEXT NOT NULL,
  affected_region TEXT,
  affected_cities TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  starts_at DATE NOT NULL,
  ends_at DATE NOT NULL,
  host_compensation_pct NUMERIC NOT NULL DEFAULT 50,
  is_active BOOLEAN NOT NULL DEFAULT true,
  declared_by UUID,
  source_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fm_active ON public.force_majeure_events(is_active, affected_country) WHERE is_active = true;
CREATE INDEX idx_fm_window ON public.force_majeure_events(starts_at, ends_at);

ALTER TABLE public.force_majeure_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active force majeure"
ON public.force_majeure_events FOR SELECT
USING (true);

CREATE POLICY "Admins manage force majeure"
ON public.force_majeure_events FOR ALL TO authenticated
USING (has_role(auth.uid(),'admin'::app_role))
WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- 7. Sanctions screening
CREATE TABLE public.sanctions_list (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  list_source TEXT NOT NULL CHECK (list_source IN ('OFAC','UN','EU','custom')),
  full_name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  country TEXT,
  date_added DATE,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sanctions_name ON public.sanctions_list(full_name) WHERE is_active = true;

ALTER TABLE public.sanctions_list ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage sanctions list"
ON public.sanctions_list FOR ALL TO authenticated
USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'finance_officer'::app_role))
WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'finance_officer'::app_role));

CREATE TABLE public.sanctions_screening_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  matched_sanction_id UUID REFERENCES public.sanctions_list(id) ON DELETE SET NULL,
  match_score NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','clear','potential_match','confirmed_match','false_positive')),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_screening_user ON public.sanctions_screening_results(user_id);
CREATE INDEX idx_screening_status ON public.sanctions_screening_results(status);

ALTER TABLE public.sanctions_screening_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage screening results"
ON public.sanctions_screening_results FOR ALL TO authenticated
USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'finance_officer'::app_role))
WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'finance_officer'::app_role));

-- ==========================================
-- TRIGGERS
-- ==========================================
CREATE TRIGGER trg_fraud_scores_updated
BEFORE UPDATE ON public.fraud_risk_scores
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_review_queue_updated
BEFORE UPDATE ON public.manual_review_queue
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_notif_prefs_ext_updated
BEFORE UPDATE ON public.notification_preferences_extended
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_fm_updated
BEFORE UPDATE ON public.force_majeure_events
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();