/**
 * Pure helper that computes the *display* status of a booking in the
 * guest/host bookings list. Mirrors the logic embedded in Bookings.tsx so
 * unit tests can exercise the upcoming → in-progress → past transition
 * without rendering React or hitting the database.
 *
 * Rules:
 *   • Only `confirmed` bookings get re-mapped. Everything else (pending,
 *     cancelled, completed, …) passes through unchanged.
 *   • `confirmed` + check-in still in the future → 'upcoming'.
 *   • `confirmed` + today is between check-in (inclusive) and check-out
 *     (exclusive) → 'in_progress'.
 *   • `confirmed` + check-out date already past → keep 'confirmed' (the
 *     lifecycle cron is responsible for promoting to 'completed').
 *
 * Dates are compared as YYYY-MM-DD strings against `today` (also YYYY-MM-DD)
 * so timezone differences between viewer and property never bump a booking
 * between buckets.
 */
export type BookingForStatus = {
  status: string;
  check_in_date: string;
  check_out_date: string;
};

export function effectiveBookingStatus(
  booking: BookingForStatus,
  todayYmd: string,
): string {
  if (booking.status !== 'confirmed') return booking.status;
  if (booking.check_in_date <= todayYmd && booking.check_out_date > todayYmd) {
    return 'in_progress';
  }
  if (booking.check_in_date > todayYmd) return 'upcoming';
  return booking.status;
}

/**
 * Tab-bucket classifier — mirrors the filter predicates that drive the
 * Upcoming / Drafts / Past / Cancelled tabs in Bookings.tsx.
 *
 *   • cancelled / rejected / expired  → 'cancelled'
 *   • completed / closed / no_show    → 'past'
 *   • pending (guest-side)            → 'drafts' if stay window not past,
 *                                       'past' otherwise
 *   • pending_host_approval / confirmed / in_progress
 *                                     → 'upcoming' if stay window not past,
 *                                       'past' otherwise
 *   • anything else                   → 'past'
 */
export type BookingBucket = 'upcoming' | 'drafts' | 'past' | 'cancelled';

export function bookingBucket(
  booking: BookingForStatus,
  todayYmd: string,
  opts: { isHostMode?: boolean } = {},
): BookingBucket {
  const { status } = booking;
  if (['cancelled', 'rejected', 'expired'].includes(status)) return 'cancelled';
  if (['completed', 'closed', 'no_show'].includes(status)) return 'past';
  const stillActive = booking.check_out_date >= todayYmd;
  if (status === 'pending') {
    if (opts.isHostMode) return 'past'; // hosts never see other guests' drafts
    return stillActive ? 'drafts' : 'past';
  }
  if (['pending_host_approval', 'confirmed', 'in_progress'].includes(status)) {
    return stillActive ? 'upcoming' : 'past';
  }
  return 'past';
}