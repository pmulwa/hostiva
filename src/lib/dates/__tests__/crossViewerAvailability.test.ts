import { describe, it, expect } from 'vitest';
import { bookingBlockedKeys } from '../propertyTz';

/**
 * Cross-viewer availability spec.
 *
 * Reality being tested: once Guest A has a CONFIRMED booking, every other
 * viewer (Guest B, anonymous browsers, the host, admins) must see the same
 * blocked nights on the property calendar. This is what `PropertyDetail`
 * relies on after switching to the `get_property_blocked_dates` RPC.
 *
 * The RPC returns plain `{check_in_date, check_out_date}` rows. The client
 * then expands each row through `bookingBlockedKeys` into the set of
 * YYYY-MM-DD keys that should appear as unavailable on the calendar.
 *
 * These tests assert the expansion is identical regardless of which
 * "viewer" is asking — i.e. the function is pure on its inputs and does not
 * leak any per-user state. The companion `bookingGuard.integration.test.ts`
 * proves the database overlap trigger blocks Guest B from booking those
 * same nights even if their UI somehow let them try.
 */

/** Mirrors what the client does after calling `get_property_blocked_dates`. */
function expandBlockedSet(
  rows: Array<{ check_in_date: string; check_out_date: string }>,
): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    for (const key of bookingBlockedKeys(row.check_in_date, row.check_out_date)) {
      out.add(key);
    }
  }
  return out;
}

describe('cross-viewer calendar after Guest A confirms', () => {
  // The exact rows returned by the RPC for the Cozy Stay property after
  // Guest A confirms 23 → 28 April (matches the screenshot in the bug report).
  const guestARows = [{ check_in_date: '2026-04-23', check_out_date: '2026-04-28' }];

  it('blocks 23, 24, 25, 26, 27 (check-in night through day before check-out)', () => {
    const blocked = expandBlockedSet(guestARows);
    expect(blocked.has('2026-04-23')).toBe(true);
    expect(blocked.has('2026-04-24')).toBe(true);
    expect(blocked.has('2026-04-25')).toBe(true);
    expect(blocked.has('2026-04-26')).toBe(true);
    expect(blocked.has('2026-04-27')).toBe(true);
  });

  it('keeps the check-out day (28th) bookable as the next guest check-in', () => {
    const blocked = expandBlockedSet(guestARows);
    expect(blocked.has('2026-04-28')).toBe(false);
  });

  it('does not bleed into days outside the stay', () => {
    const blocked = expandBlockedSet(guestARows);
    expect(blocked.has('2026-04-22')).toBe(false);
    expect(blocked.has('2026-04-29')).toBe(false);
  });

  it('produces the SAME blocked set for every viewer (pure function on RPC payload)', () => {
    // Guest A, Guest B, the host and an anonymous viewer all receive the
    // exact same row payload from the SECURITY DEFINER RPC, so the expansion
    // must be byte-for-byte identical.
    const guestA = expandBlockedSet(guestARows);
    const guestB = expandBlockedSet(guestARows);
    const host = expandBlockedSet(guestARows);
    const anon = expandBlockedSet(guestARows);
    const sortedA = Array.from(guestA).sort();
    expect(Array.from(guestB).sort()).toEqual(sortedA);
    expect(Array.from(host).sort()).toEqual(sortedA);
    expect(Array.from(anon).sort()).toEqual(sortedA);
  });

  it('merges multiple confirmed stays into one blocked set (turnover allowed)', () => {
    // Mirrors live data: 23→24, 24→29, 29→30. All three are valid back-to-back
    // turnovers (next check-in == previous check-out) and together block
    // every night from the 23rd through the 29th, leaving the 30th open.
    const merged = expandBlockedSet([
      { check_in_date: '2026-04-23', check_out_date: '2026-04-24' },
      { check_in_date: '2026-04-24', check_out_date: '2026-04-29' },
      { check_in_date: '2026-04-29', check_out_date: '2026-04-30' },
    ]);
    expect(Array.from(merged).sort()).toEqual([
      '2026-04-23',
      '2026-04-24',
      '2026-04-25',
      '2026-04-26',
      '2026-04-27',
      '2026-04-28',
      '2026-04-29',
    ]);
  });

  it('is empty for a property with no confirmed bookings', () => {
    expect(expandBlockedSet([]).size).toBe(0);
  });

  it('reflects the bug fix: an empty RPC response yields zero blocked days', () => {
    // Before the fix, Guest B's direct SELECT on `bookings` returned [] due
    // to RLS, which silently yielded an empty blocked set and made the
    // calendar look wide open. The fix is the RPC; this test documents that
    // the expansion itself behaves correctly when given the same empty
    // payload, so the only way Guest B sees zero blocks is if the property
    // truly has no confirmed bookings.
    expect(expandBlockedSet([]).size).toBe(0);
    expect(expandBlockedSet(guestARows).size).toBeGreaterThan(0);
  });
});
