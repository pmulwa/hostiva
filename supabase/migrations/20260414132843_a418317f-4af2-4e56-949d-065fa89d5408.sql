
CREATE TABLE IF NOT EXISTS public.platform_controls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL UNIQUE,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.platform_controls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage platform controls" ON public.platform_controls
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Anyone can view platform controls" ON public.platform_controls
  FOR SELECT TO authenticated
  USING (true);

INSERT INTO public.platform_controls (section, settings) VALUES
  ('guest_rights', '{"allow_reviews": true, "cancellation_window": true, "messaging_before_booking": true, "require_phone_verification": false}'::jsonb),
  ('host_rights', '{"instant_booking": true, "cancellation_penalty": true, "multiple_listings": true, "respond_to_reviews": true}'::jsonb),
  ('property_approvals', '{"auto_approve_verified": false, "require_id_verification": false}'::jsonb),
  ('notifications', '{"email_new_bookings": true, "alert_cancellations": true}'::jsonb),
  ('platform_settings', '{"maintenance_mode": false, "allow_registrations": true}'::jsonb),
  ('security', '{"force_email_verification": true, "two_factor_auth": false}'::jsonb)
ON CONFLICT (section) DO NOTHING;
