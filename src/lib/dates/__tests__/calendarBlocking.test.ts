import { describe, it, expect } from 'vitest';
import {
  bookingBlockedKeys,
  viewerLocalKey,
  dateKeyInTz,
} from '../propertyTz';

/**
 * Calendar blocking spec.
 *
 * Reality being tested: a confirmed booking 23 → 25 April blocks the nights
 * of the 23rd and 24th. The 25th (check-out) stays bookable as the next
 * guest's check-in. The same keys must surface for every viewer regardless
 * of where on Earth they (or the property) sit.
 */
describe('bookingBlockedKeys', () => {
  it('blocks check-in night through the day before check-out', () => {
    expect(bookingBlockedKeys('2026-04-23', '2026-04-25')).toEqual([
      '2026-04-23',
      '2026-04-24',
    ]);
  });

  it('does not block the check-out date', () => {
    const keys = bookingBlockedKeys('2026-04-23', '2026-04-25');
    expect(keys).not.toContain('2026-04-25');
  });

  it('handles single-night bookings', () => {
    expect(bookingBlockedKeys('2026-04-23', '2026-04-24')).toEqual(['2026-04-23']);
  });

  it('returns an empty list when check-in equals check-out (degenerate)', () => {
    expect(bookingBlockedKeys('2026-04-23', '2026-04-23')).toEqual([]);
  });

  it('crosses month boundaries correctly', () => {
    expect(bookingBlockedKeys('2026-04-29', '2026-05-02')).toEqual([
      '2026-04-29',
      '2026-04-30',
      '2026-05-01',
    ]);
  });

  it('crosses DST spring-forward (US/Eastern, March 8 2026) without skipping a day', () => {
    const keys = bookingBlockedKeys('2026-03-07', '2026-03-10');
    expect(keys).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
  });

  it('crosses DST fall-back (US/Eastern, November 1 2026) without duplicating a day', () => {
    const keys = bookingBlockedKeys('2026-10-31', '2026-11-03');
    expect(keys).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('handles year boundary', () => {
    expect(bookingBlockedKeys('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
    ]);
  });
});

/**
 * Viewer-vs-property timezone equivalence: the literal day shown on the
 * react-day-picker calendar (e.g. "April 23") must always match the
 * `YYYY-MM-DD` stored against the booking, no matter which timezone the
 * viewer's browser is in or which timezone the property is anchored to.
 */
describe('viewerLocalKey vs property TZ', () => {
  // Construct a Date that the BROWSER will see as midnight on the given local
  // calendar day — react-day-picker emits exactly this kind of value when a
  // user clicks a day cell.
  const localMidnight = (y: number, m: number, d: number) =>
    new Date(y, m - 1, d, 0, 0, 0, 0);

  it('produces the same key as the booking record for clicked days (April 23 case)', () => {
    const clicked = localMidnight(2026, 4, 23);
    expect(viewerLocalKey(clicked)).toBe('2026-04-23');
  });

  it('matches blocked keys for all nights in 23 → 25 April booking', () => {
    const blocked = new Set(bookingBlockedKeys('2026-04-23', '2026-04-25'));
    const clickedCheckIn = viewerLocalKey(localMidnight(2026, 4, 23));
    const clickedMid = viewerLocalKey(localMidnight(2026, 4, 24));
    const clickedCheckout = viewerLocalKey(localMidnight(2026, 4, 25));
    expect(blocked.has(clickedCheckIn)).toBe(true);
    expect(blocked.has(clickedMid)).toBe(true);
    expect(blocked.has(clickedCheckout)).toBe(false);
  });

  it('dateKeyInTz preserves YYYY-MM-DD strings as-is for any property tz', () => {
    for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Auckland', 'Africa/Lagos']) {
      expect(dateKeyInTz('2026-04-23', tz)).toBe('2026-04-23');
    }
  });

  it('dateKeyInTz of a real Date in property tz matches the property calendar day', () => {
    // 2026-04-23 13:00 UTC — that is still April 23 in Tokyo (22:00) and in LA
    // (06:00). The property tz key should reflect the property calendar day.
    const instant = new Date('2026-04-23T13:00:00Z');
    expect(dateKeyInTz(instant, 'Asia/Tokyo')).toBe('2026-04-23');
    expect(dateKeyInTz(instant, 'America/Los_Angeles')).toBe('2026-04-23');
    expect(dateKeyInTz(instant, 'UTC')).toBe('2026-04-23');
  });
});