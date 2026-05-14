
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS host_approval_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS host_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS host_declined_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_check_out_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bookings_pending_approval_deadline
  ON public.bookings (host_approval_deadline)
  WHERE status = 'pending_host_approval';
