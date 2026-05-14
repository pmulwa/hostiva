import { describe, it, expect } from 'vitest';
import {
  bookingBlockedKeys,
  dateKeyInTz,
  isSameDayCheckInOpen,
  todayInTz,
} from '../propertyTz';

/**
 * Integration spec for the availability decision used by the booking
 * calendar (PropertyDetail). The "API" here is the composition of:
 *   - `bookingBlockedKeys`  → which YYYY-MM-DD keys are occupied by
 *                              confirmed bookings
 *   - `todayInTz`           → today's calendar key in the property's zone
 *   - `isSameDayCheckInOpen`→ has the check-out cutoff passed in the
 *                              property's zone
 *
 * Together they decide whether "today" is offered as a same-day
 * check-in cell on the calendar. This must hold strictly across the
 * cutoff boundary AND must not depend on the viewer's browser zone.
 */

/** Build a UTC instant for a wall-clock time in `tz` (DST-safe). */
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

/**
 * Mirrors the calendar's per-cell decision for "today":
 *   - if today is part of any confirmed booking's blocked keys → not selectable
 *   - else if same-day check-in window has not yet opened → not selectable
 *   - else → selectable as a same-day check-in
 */
function isTodayBookableForSameDay(opts: {
  tz: string;
  checkOutTime: string;
  now: Date;
  /** Confirmed bookings (raw YYYY-MM-DD ranges from the bookings table). */
  confirmedBookings: { check_in_date: string; check_out_date: string }[];
}): boolean {
  const todayKey = todayInTz(opts.tz);
  const blocked = new Set<string>();
  for (const b of opts.confirmedBookings) {
    for (const key of bookingBlockedKeys(b.check_in_date, b.check_out_date)) {
      blocked.add(key);
    }
  }
  if (blocked.has(todayKey)) return false;
  return isSameDayCheckInOpen(opts.checkOutTime, opts.tz, opts.now);
}

describe('availability API — same-day check-in around the cutoff', () => {
  const tz = 'America/New_York';
  const checkOutTime = '11:00:00';

  it('today is NOT bookable at 09:30 (before 11:00 cutoff)', () => {
    const now = instantAtWallTime(tz, 2026, 4, 22, 9, 30);
    expect(
      isTodayBookableForSameDay({ tz, checkOutTime, now, confirmedBookings: [] }),
    ).toBe(false);
  });

  it('today is NOT bookable exactly at 11:00:00 (cutoff still belongs to prior night)', () => {
    const now = instantAtWallTime(tz, 2026, 4, 22, 11, 0, 0);
    expect(
      isTodayBookableForSameDay({ tz, checkOutTime, now, confirmedBookings: [] }),
    ).toBe(false);
  });

  it('today flips to bookable one second past the cutoff (11:00:01)', () => {
    const now = instantAtWallTime(tz, 2026, 4, 22, 11, 0, 1);
    expect(
      isTodayBookableForSameDay({ tz, checkOutTime, now, confirmedBookings: [] }),
    ).toBe(true);
  });

  it('today stays bookable through the rest of the day (e.g. 18:00)', () => {
    const now = instantAtWallTime(tz, 2026, 4, 22, 18, 0);
    expect(
      isTodayBookableForSameDay({ tz, checkOutTime, now, confirmedBookings: [] }),
    ).toBe(true);
  });
});

describe('availability API — confirmed bookings veto same-day check-in', () => {
  const tz = 'America/New_York';
  const checkOutTime = '11:00:00';

  it('today is NOT bookable when a confirmed booking blocks tonight even if cutoff has passed', () => {
    const now = instantAtWallTime(tz, 2026, 4, 22, 14, 0); // past cutoff
    const todayKey = todayInTz(tz);
    // A booking that includes today's night
    const [y, m, d] = todayKey.split('-').map(Number);
    const tomorrow = new Date(Date.UTC(y, m - 1, d + 2));
    const tomorrowKey = `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth() + 1).padStart(2, '0')}-${String(tomorrow.getUTCDate()).padStart(2, '0')}`;
    const blocking = [
      { check_in_date: todayKey, check_out_date: tomorrowKey },
    ];
    expect(
      isTodayBookableForSameDay({ tz, checkOutTime, now, confirmedBookings: blocking }),
    ).toBe(false);
  });

  it('today IS bookable when a confirmed booking only blocks future nights', () => {
    const now = instantAtWallTime(tz, 2026, 4, 22, 14, 0);
    const todayKey = todayInTz(tz);
    const [y, m, d] = todayKey.split('-').map(Number);
    const future1 = new Date(Date.UTC(y, m - 1, d + 7));
    const future2 = new Date(Date.UTC(y, m - 1, d + 9));
    const k = (dt: Date) =>
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    expect(
      isTodayBookableForSameDay({
        tz,
        checkOutTime,
        now,
        confirmedBookings: [{ check_in_date: k(future1), check_out_date: k(future2) }],
      }),
    ).toBe(true);
  });

  it('today IS bookable on a turnover day where the previous booking checks out at the cutoff', () => {
    // Previous booking 21st → 22nd. The 22nd (check-out day) is NOT blocked.
    // Once the cutoff passes today opens up for the next same-day check-in.
    const now = instantAtWallTime(tz, 2026, 4, 22, 11, 30);
    const todayKey = todayInTz(tz);
    const [y, m, d] = todayKey.split('-').map(Number);
    const yesterday = new Date(Date.UTC(y, m - 1, d - 1));
    const yKey = `${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth() + 1).padStart(2, '0')}-${String(yesterday.getUTCDate()).padStart(2, '0')}`;
    expect(
      isTodayBookableForSameDay({
        tz,
        checkOutTime,
        now,
        confirmedBookings: [{ check_in_date: yKey, check_out_date: todayKey }],
      }),
    ).toBe(true);
  });
});

describe('availability API — independent of viewer timezone', () => {
  it('the same UTC instant gives different answers for properties in different zones', () => {
    // 2026-04-22 12:00 UTC:
    //  - Tokyo  (UTC+9): 21:00 on the 22nd → past 11:00 cutoff → OPEN
    //  - LA    (UTC-7): 05:00 on the 22nd → before 11:00 cutoff → CLOSED
    const instant = new Date('2026-04-22T12:00:00Z');
    expect(
      isTodayBookableForSameDay({
        tz: 'Asia/Tokyo',
        checkOutTime: '11:00:00',
        now: instant,
        confirmedBookings: [],
      }),
    ).toBe(true);
    expect(
      isTodayBookableForSameDay({
        tz: 'America/Los_Angeles',
        checkOutTime: '11:00:00',
        now: instant,
        confirmedBookings: [],
      }),
    ).toBe(false);
  });

  it('today key is computed in the property zone, not the viewer zone', () => {
    // 2026-04-23 02:00 UTC:
    //  - Tokyo: 11:00 on the 23rd → todayInTz = '2026-04-23'
    //  - LA:    19:00 on the 22nd → todayInTz = '2026-04-22'
    const instant = new Date('2026-04-23T02:00:00Z');
    expect(dateKeyInTz(instant, 'Asia/Tokyo')).toBe('2026-04-23');
    expect(dateKeyInTz(instant, 'America/Los_Angeles')).toBe('2026-04-22');
  });
});

describe('availability API — DST boundaries', () => {
  it('US/Eastern spring-forward (March 8 2026) — cutoff still flips correctly', () => {
    const tz = 'America/New_York';
    expect(
      isTodayBookableForSameDay({
        tz,
        checkOutTime: '11:00:00',
        now: instantAtWallTime(tz, 2026, 3, 8, 10, 59),
        confirmedBookings: [],
      }),
    ).toBe(false);
    expect(
      isTodayBookableForSameDay({
        tz,
        checkOutTime: '11:00:00',
        now: instantAtWallTime(tz, 2026, 3, 8, 11, 1),
        confirmedBookings: [],
      }),
    ).toBe(true);
  });

  it('US/Eastern fall-back (November 1 2026) — cutoff still flips correctly', () => {
    const tz = 'America/New_York';
    expect(
      isTodayBookableForSameDay({
        tz,
        checkOutTime: '11:00:00',
        now: instantAtWallTime(tz, 2026, 11, 1, 10, 59),
        confirmedBookings: [],
      }),
    ).toBe(false);
    expect(
      isTodayBookableForSameDay({
        tz,
        checkOutTime: '11:00:00',
        now: instantAtWallTime(tz, 2026, 11, 1, 11, 1),
        confirmedBookings: [],
      }),
    ).toBe(true);
  });
});