ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS pending_modification jsonb,
  ADD COLUMN IF NOT EXISTS modification_payment_session_id text,
  ADD COLUMN IF NOT EXISTS last_modified_at timestamp with time zone;