import { describe, it, expect } from 'vitest';
import { isSameDayCheckInOpen } from '../propertyTz';

/**
 * Same-day check-in availability spec.
 *
 * Reality being tested: a guest can book "today" as a same-day check-in
 * once the property's configured check-out time has passed in the
 * property's local zone. The cutoff is strict — 11:00 sharp is still
 * occupied by the previous night, 11:01 opens the day.
 *
 * All assertions are anchored to the property timezone, never the
 * viewer's browser zone, so the same instant produces different
 * answers for properties in different cities — exactly as it should.
 */

/** Build a UTC instant for a given wall-clock time in `tz` (DST-safe). */
function instantAtWallTime(
  tz: string,
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number,
  ss = 0,
): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  // Compute tz offset for the candidate instant
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(guess));
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) === 24 ? 0 : Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  const offsetMin = Math.round((asUtc - guess) / 60_000);
  return new Date(guess - offsetMin * 60_000);
}

describe('isSameDayCheckInOpen — strict cutoff vs check-out time', () => {
  const tz = 'America/New_York';

  it('is closed before the check-out time', () => {
    const now = instantAtWallTime(tz, 2026, 4, 22, 9, 30);
    expect(isSameDayCheckInOpen('11:00:00', tz, now)).toBe(false);
  });

  it('is closed exactly at the check-out time (11:00:00 sharp belongs to prior night)', () => {
    const now = instantAtWallTime(tz, 2026, 4, 22, 11, 0, 0);
    expect(isSameDayCheckInOpen('11:00:00', tz, now)).toBe(false);
  });

  it('opens one second after the check-out time', () => {
    const now = instantAtWallTime(tz, 2026, 4, 22, 11, 0, 1);
    expect(isSameDayCheckInOpen('11:00:00', tz, now)).toBe(true);
  });

  it('is open well after the check-out time (e.g. 18:00)', () => {
    const now = instantAtWallTime(tz, 2026, 4, 22, 18, 0);
    expect(isSameDayCheckInOpen('11:00:00', tz, now)).toBe(true);
  });

  it('is open right up to midnight', () => {
    const now = instantAtWallTime(tz, 2026, 4, 22, 23, 59, 59);
    expect(isSameDayCheckInOpen('11:00:00', tz, now)).toBe(true);
  });
});

describe('isSameDayCheckInOpen — uses property timezone, not the viewer', () => {
  it('the same UTC instant gives different answers for Tokyo vs Los Angeles', () => {
    // 2026-04-22 12:00 UTC is:
    //   - 21:00 in Tokyo on the 22nd  → past 11:00 cutoff → OPEN
    //   - 05:00 in Los Angeles on the 22nd → before 11:00 cutoff → CLOSED
    const instant = new Date('2026-04-22T12:00:00Z');
    expect(isSameDayCheckInOpen('11:00:00', 'Asia/Tokyo', instant)).toBe(true);
    expect(isSameDayCheckInOpen('11:00:00', 'America/Los_Angeles', instant)).toBe(false);
  });

  it('honours non-default cutoffs (e.g. 10:00 vs 14:00 vs 23:00)', () => {
    const tz = 'Europe/London';
    const at = (h: number, m: number) => instantAtWallTime(tz, 2026, 6, 15, h, m);
    // 13:00 in London
    expect(isSameDayCheckInOpen('10:00:00', tz, at(13, 0))).toBe(true);
    expect(isSameDayCheckInOpen('14:00:00', tz, at(13, 0))).toBe(false);
    expect(isSameDayCheckInOpen('23:00:00', tz, at(13, 0))).toBe(false);
    // 23:30 in London — still before a 23:00? No, 23:30 > 23:00 → open
    expect(isSameDayCheckInOpen('23:00:00', tz, at(23, 30))).toBe(true);
  });
});

describe('isSameDayCheckInOpen — defaults and DST edges', () => {
  it('defaults to 11:00 cutoff when no check-out time configured', () => {
    const tz = 'UTC';
    expect(isSameDayCheckInOpen(null, tz, instantAtWallTime(tz, 2026, 4, 22, 10, 59))).toBe(false);
    expect(isSameDayCheckInOpen(undefined, tz, instantAtWallTime(tz, 2026, 4, 22, 11, 1))).toBe(true);
    expect(isSameDayCheckInOpen('', tz, instantAtWallTime(tz, 2026, 4, 22, 11, 1))).toBe(true);
  });

  it('accepts HH:MM (no seconds) check-out times', () => {
    const tz = 'UTC';
    expect(isSameDayCheckInOpen('11:00', tz, instantAtWallTime(tz, 2026, 4, 22, 11, 0, 0))).toBe(false);
    expect(isSameDayCheckInOpen('11:00', tz, instantAtWallTime(tz, 2026, 4, 22, 11, 0, 1))).toBe(true);
  });

  it('handles DST spring-forward day in US/Eastern (March 8 2026)', () => {
    const tz = 'America/New_York';
    // 02:30 local doesn't exist; we use 09:00 / 11:30 which both exist post-jump
    expect(isSameDayCheckInOpen('11:00:00', tz, instantAtWallTime(tz, 2026, 3, 8, 9, 0))).toBe(false);
    expect(isSameDayCheckInOpen('11:00:00', tz, instantAtWallTime(tz, 2026, 3, 8, 11, 30))).toBe(true);
  });

  it('handles DST fall-back day in US/Eastern (November 1 2026)', () => {
    const tz = 'America/New_York';
    // Pre-cutoff and post-cutoff still resolve correctly across the repeated 1-2am hour
    expect(isSameDayCheckInOpen('11:00:00', tz, instantAtWallTime(tz, 2026, 11, 1, 10, 59))).toBe(false);
    expect(isSameDayCheckInOpen('11:00:00', tz, instantAtWallTime(tz, 2026, 11, 1, 11, 1))).toBe(true);
  });
});