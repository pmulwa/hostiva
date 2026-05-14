-- Persist receipt download (cancellation lock) on bookings
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS receipt_downloaded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bookings_receipt_downloaded_at
  ON public.bookings (receipt_downloaded_at)
  WHERE receipt_downloaded_at IS NOT NULL;