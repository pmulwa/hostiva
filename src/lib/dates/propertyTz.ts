/**
 * Property-timezone-aware date helpers.
 *
 * Bookings store `check_in_date` / `check_out_date` as plain `YYYY-MM-DD`
 * calendar days that belong to the property's local zone. The browser's
 * `new Date('YYYY-MM-DD')` parses those strings as UTC midnight, which then
 * shifts back a day for any viewer west of UTC. These helpers anchor every
 * date to the property's IANA timezone so guests, hosts and admins all see
 * the same calendar day no matter where they are.
 */
import tzlookup from 'tz-lookup';

/** Fallback when a property has no timezone set (older rows, no coords). */
export const DEFAULT_TZ = 'UTC';

/** Detect IANA timezone from coordinates. Returns null if lookup fails. */
export function timezoneFromCoords(
  lat: number | null | undefined,
  lng: number | null | undefined,
): string | null {
  if (lat == null || lng == null) return null;
  const latN = Number(lat);
  const lngN = Number(lng);
  if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return null;
  try {
    return tzlookup(latN, lngN);
  } catch {
    return null;
  }
}

/**
 * Parse a `YYYY-MM-DD` (optionally with time) value as midnight in the given
 * IANA zone. Returns a real `Date` (UTC instant) that, when displayed in any
 * format/formatInTimeZone using the same `tz`, yields the original calendar
 * day. Use this everywhere we currently do `new Date(check_in_date)`.
 */
export function parseDateInTz(value: string, tz: string = DEFAULT_TZ): Date {
  const datePart = value.length >= 10 ? value.slice(0, 10) : value;
  const [y, m, d] = datePart.split('-').map(Number);
  if (!y || !m || !d) return new Date(value);
  // Build a UTC instant for the wall-clock midnight in `tz` by computing
  // that zone's offset for the candidate instant (DST-safe).
  const utcGuess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offsetMin = tzOffsetMinutes(utcGuess, tz);
  return new Date(utcGuess - offsetMin * 60_000);
}

/**
 * Format a `YYYY-MM-DD` (or Date) using `Intl` in the property's zone.
 * Default is `'MMM d, yyyy'`-style short format; pass `Intl.DateTimeFormatOptions`
 * for custom layouts.
 */
export function formatDateInTz(
  value: string | Date,
  tz: string = DEFAULT_TZ,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' },
): string {
  const date = typeof value === 'string' ? parseDateInTz(value, tz) : value;
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: tz }).format(date);
}

/**
 * Stable `YYYY-MM-DD` key for a Date/value when interpreted in the property
 * timezone. Useful for comparing calendar cells without leaking the viewer's
 * browser timezone into booking logic.
 */
export function dateKeyInTz(
  value: string | Date,
  tz: string = DEFAULT_TZ,
): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const date = typeof value === 'string' ? parseDateInTz(value, tz) : value;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Compute calendar-day difference between two `YYYY-MM-DD` values when both
 * are anchored to the same property timezone.
 */
export function daysBetweenInTz(
  start: string,
  end: string,
  tz: string = DEFAULT_TZ,
): number {
  const s = parseDateInTz(start, tz).getTime();
  const e = parseDateInTz(end, tz).getTime();
  return Math.round((e - s) / 86_400_000);
}

/**
 * Hours until check-in from "now", in the property's zone. Negative when the
 * stay has already started. Used by cancellation policy windows.
 */
export function hoursUntilCheckInInTz(
  checkInDate: string,
  checkInTime: string | null | undefined,
  tz: string = DEFAULT_TZ,
): number {
  const time = (checkInTime || '15:00:00').slice(0, 8);
  const [y, m, d] = checkInDate.slice(0, 10).split('-').map(Number);
  const [hh, mm, ss] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0, ss || 0);
  const offsetMin = tzOffsetMinutes(guess, tz);
  const checkInUtc = guess - offsetMin * 60_000;
  return (checkInUtc - Date.now()) / 3_600_000;
}

/**
 * Today as `YYYY-MM-DD` in the property timezone — for "is the stay over?"
 * comparisons that must use the property's calendar, not the viewer's.
 */
export function todayInTz(tz: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Same-day check-in availability.
 *
 * A guest can book "today" as a same-day check-in once the property's
 * configured check-out time has passed in the property's local zone.
 * Example: if the property's check-out time is 11:00, then on the 22nd
 * the day opens up for same-day check-in from 11:01 onwards (any later
 * time is fine — the guest just arrives whenever they like and the
 * checkout falls on the next morning at the property's check-out time).
 *
 * Returns `true` when the current instant in `tz` is strictly after the
 * property's check-out time on today's calendar day.
 */
export function isSameDayCheckInOpen(
  checkOutTime: string | null | undefined,
  tz: string = DEFAULT_TZ,
  now: Date = new Date(),
): boolean {
  const time = (checkOutTime || '11:00:00').slice(0, 8);
  const [hh, mm, ss] = time.split(':').map(Number);
  // Current wall-clock parts in the property zone
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(now);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
  const nowSecs =
    Number(map.hour) * 3600 + Number(map.minute) * 60 + Number(map.second);
  const cutoffSecs = (hh || 0) * 3600 + (mm || 0) * 60 + (ss || 0);
  return nowSecs > cutoffSecs;
}

/**
 * Compute the set of `YYYY-MM-DD` calendar keys that a confirmed booking
 * blocks on the availability calendar: from check-in (inclusive) up to the
 * day BEFORE check-out (the check-out day itself stays bookable as the next
 * guest's check-in).
 *
 * Iteration is purely string-based (no Date instants) so DST shifts and
 * UTC-vs-local parsing can never desync a key. This is the single source of
 * truth for blocked-day computation and is unit-tested across timezones.
 */
export function bookingBlockedKeys(
  checkIn: string,
  checkOut: string,
): string[] {
  const start = checkIn.slice(0, 10);
  const end = checkOut.slice(0, 10);
  const out: string[] = [];
  let cursor = start;
  let safety = 0;
  while (cursor < end && safety++ < 366 * 5) {
    out.push(cursor);
    const [y, m, d] = cursor.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    cursor = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  }
  return out;
}

/**
 * Local-Y-M-D key for a `Date` instance as it appears on the viewer's
 * calendar (matching the literal day shown by react-day-picker). This is
 * the key the calendar uses to look up blocked nights — see PropertyDetail.
 */
export function viewerLocalKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns the offset (in minutes; positive east of UTC) for the given UTC
 * instant when expressed in `tz`. Internal helper, DST-safe.
 */
function tzOffsetMinutes(utcMs: number, tz: string): number {
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
  const parts = dtf.formatToParts(new Date(utcMs));
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
  return Math.round((asUtc - utcMs) / 60_000);
}