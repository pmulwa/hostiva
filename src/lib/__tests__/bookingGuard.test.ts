import { describe, it, expect } from 'vitest';

/**
 * Mirrors the guard used in PropertyDetail.handleBooking and the booking widget:
 *   if (property.status !== 'active') -> block new bookings
 * Existing reservations keep messaging access (handled separately via /messages),
 * so this guard intentionally only governs the booking action.
 */
function canCreateNewBooking(status: string): boolean {
  return status === 'active';
}

describe('booking guard by property status', () => {
  it('allows bookings only when status is active', () => {
    expect(canCreateNewBooking('active')).toBe(true);
  });

  it.each(['suspended', 'pending_approval', 'draft', 'inactive', 'rejected'])(
    'blocks new bookings when status is %s',
    (status) => {
      expect(canCreateNewBooking(status)).toBe(false);
    },
  );
});