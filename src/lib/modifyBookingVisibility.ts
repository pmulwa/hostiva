/**
 * Pure helper that mirrors the JSX guard used in BookingConfirmation.tsx
 * (and the /bookings list) for surfacing the "Modify booking" button.
 *
 * Rules — extracted so they can be unit-tested without rendering React:
 *   • Booking must be confirmed (status === 'confirmed').
 *   • Viewer must be the guest (not the host).
 *   • Check-in date must still be in the future relative to `now`.
 *
 * The dialog itself enforces the stricter "24h before check-in" rule;
 * this helper only governs button visibility.
 */
export function shouldShowModifyButton(params: {
  status: string | null | undefined;
  isHost: boolean;
  checkInDate: string; // ISO date "YYYY-MM-DD"
  now?: Date;
}): boolean {
  const { status, isHost, checkInDate } = params;
  const now = params.now ?? new Date();
  if (status !== 'confirmed') return false;
  if (isHost) return false;
  const checkInTs = new Date(`${checkInDate}T00:00:00`).getTime();
  if (!Number.isFinite(checkInTs)) return false;
  return checkInTs > now.getTime();
}