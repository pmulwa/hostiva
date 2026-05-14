
-- Add lifecycle tracking columns to bookings
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS actual_check_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS no_show_marked_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_reminder_sent jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_bookings_checkin_status
  ON public.bookings (check_in_date, status);

-- Issue reporting table
CREATE TABLE IF NOT EXISTS public.booking_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL,
  property_id uuid NOT NULL,
  guest_id uuid NOT NULL,
  host_id uuid NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  category text NOT NULL,
  description text NOT NULL,
  photos text[] NOT NULL DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'open',
  host_response text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_issues_booking ON public.booking_issues (booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_issues_host ON public.booking_issues (host_id, status);

ALTER TABLE public.booking_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Guests create own issues"
  ON public.booking_issues FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = guest_id);

CREATE POLICY "Guests view own issues"
  ON public.booking_issues FOR SELECT
  TO authenticated
  USING (auth.uid() = guest_id OR auth.uid() = host_id OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Guests update own issues"
  ON public.booking_issues FOR UPDATE
  TO authenticated
  USING (auth.uid() = guest_id)
  WITH CHECK (auth.uid() = guest_id);

CREATE POLICY "Hosts respond to issues"
  ON public.booking_issues FOR UPDATE
  TO authenticated
  USING (auth.uid() = host_id)
  WITH CHECK (auth.uid() = host_id);

CREATE POLICY "Admins manage all issues"
  ON public.booking_issues FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_booking_issues_updated_at
  BEFORE UPDATE ON public.booking_issues
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
