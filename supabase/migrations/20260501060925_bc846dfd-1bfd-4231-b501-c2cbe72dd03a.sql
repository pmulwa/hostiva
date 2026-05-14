-- 1) Expand the refund_status CHECK constraint to include 'refunded',
--    which is the value used by confirm-booking-payment when auto-refunding
--    overlap losers. Without this, the cancelled-status UPDATE silently
--    fails the CHECK and the row stays 'pending', stranding it in "Drafts".
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_refund_status_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_refund_status_check
  CHECK (refund_status = ANY (ARRAY[
    'none','pending','processing','partial','full','refunded','completed','failed'
  ]));

-- 2) Heal already-stuck rows: any 'pending' booking whose dates overlap an
--    already-confirmed/in-progress booking on the same property should be
--    cancelled with refund metadata set.
UPDATE public.bookings b
SET status = 'cancelled',
    cancellation_reason = COALESCE(NULLIF(b.cancellation_reason, ''),
      'Dates already booked by another guest — payment refunded automatically.'),
    refund_status = CASE WHEN b.refund_status IS NULL OR b.refund_status = 'none'
                         THEN 'refunded' ELSE b.refund_status END,
    refund_amount = COALESCE(b.refund_amount, b.total_price),
    refund_date   = COALESCE(b.refund_date, now()),
    updated_at = now()
WHERE b.status = 'pending'
  AND EXISTS (
    SELECT 1 FROM public.bookings other
    WHERE other.property_id = b.property_id
      AND other.id <> b.id
      AND other.status IN ('confirmed', 'in_progress', 'pending_host_approval')
      AND other.check_in_date < b.check_out_date
      AND b.check_in_date < other.check_out_date
  );