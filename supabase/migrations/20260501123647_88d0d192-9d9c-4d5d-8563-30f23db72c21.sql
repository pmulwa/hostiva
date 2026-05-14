-- Enforce DB-level prevention of double auto-posting per Hostly booking
-- The auto-post trigger tags external bookings with notes = 'AUTO:HOSTLY:<booking_id>'.
-- A unique partial index makes a duplicate post impossible even under race conditions.
CREATE UNIQUE INDEX IF NOT EXISTS uq_acct_external_bookings_auto_hostly
  ON public.acct_external_bookings (host_id, notes)
  WHERE notes LIKE 'AUTO:HOSTLY:%';