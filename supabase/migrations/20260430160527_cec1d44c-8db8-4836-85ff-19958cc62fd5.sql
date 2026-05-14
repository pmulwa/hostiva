
-- 1) Global disabled auto-message keys (admin override)
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS disabled_auto_messages text[] NOT NULL DEFAULT '{}'::text[];

-- 2) Per-booking check-in details shared by host with guest
CREATE TABLE IF NOT EXISTS public.booking_check_in_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE,
  host_id uuid NOT NULL,
  guest_id uuid NOT NULL,
  access_code text,
  key_location text,
  wifi_name text,
  wifi_password text,
  parking_info text,
  special_instructions text,
  shared_at timestamptz,
  guest_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.booking_check_in_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Host manages own check-in details" ON public.booking_check_in_details;
CREATE POLICY "Host manages own check-in details"
ON public.booking_check_in_details
FOR ALL
TO authenticated
USING (auth.uid() = host_id)
WITH CHECK (auth.uid() = host_id);

DROP POLICY IF EXISTS "Guest views own check-in details" ON public.booking_check_in_details;
CREATE POLICY "Guest views own check-in details"
ON public.booking_check_in_details
FOR SELECT
TO authenticated
USING (auth.uid() = guest_id);

DROP POLICY IF EXISTS "Guest confirms own check-in details" ON public.booking_check_in_details;
CREATE POLICY "Guest confirms own check-in details"
ON public.booking_check_in_details
FOR UPDATE
TO authenticated
USING (auth.uid() = guest_id)
WITH CHECK (auth.uid() = guest_id);

DROP POLICY IF EXISTS "Admins manage all check-in details" ON public.booking_check_in_details;
CREATE POLICY "Admins manage all check-in details"
ON public.booking_check_in_details
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS booking_check_in_details_booking_idx
  ON public.booking_check_in_details(booking_id);

DROP TRIGGER IF EXISTS update_booking_check_in_details_updated_at ON public.booking_check_in_details;
CREATE TRIGGER update_booking_check_in_details_updated_at
  BEFORE UPDATE ON public.booking_check_in_details
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
