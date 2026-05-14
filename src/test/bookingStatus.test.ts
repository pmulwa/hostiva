import { describe, it, expect } from 'vitest';
import { effectiveBookingStatus, bookingBucket } from '@/lib/bookingStatus';

const TODAY = '2026-05-01';

describe('effectiveBookingStatus — confirmed → upcoming/in_progress mapping', () => {
  it('keeps non-confirmed statuses untouched', () => {
    for (const status of ['pending', 'pending_host_approval', 'cancelled', 'completed', 'rejected', 'expired']) {
      expect(
        effectiveBookingStatus(
          { status, check_in_date: '2026-06-01', check_out_date: '2026-06-05' },
          TODAY,
        ),
      ).toBe(status);
    }
  });

  it('maps confirmed + future check-in → upcoming', () => {
    expect(
      effectiveBookingStatus(
        { status: 'confirmed', check_in_date: '2026-05-10', check_out_date: '2026-05-12' },
        TODAY,
      ),
    ).toBe('upcoming');
  });

  it('maps confirmed + check-in today (mid-stay) → in_progress', () => {
    expect(
      effectiveBookingStatus(
        { status: 'confirmed', check_in_date: '2026-05-01', check_out_date: '2026-05-04' },
        TODAY,
      ),
    ).toBe('in_progress');
  });

  it('maps confirmed + check-in yesterday + check-out tomorrow → in_progress', () => {
    expect(
      effectiveBookingStatus(
        { status: 'confirmed', check_in_date: '2026-04-30', check_out_date: '2026-05-02' },
        TODAY,
      ),
    ).toBe('in_progress');
  });

  it('on the day of check-out (check_out === today) is no longer in_progress', () => {
    expect(
      effectiveBookingStatus(
        { status: 'confirmed', check_in_date: '2026-04-28', check_out_date: '2026-05-01' },
        TODAY,
      ),
    ).toBe('confirmed'); // lifecycle cron will promote to completed
  });
});

describe('bookingBucket — Drafts vs Upcoming regression guard', () => {
  it('confirmed upcoming booking lands in Upcoming, not Drafts', () => {
    // Regression: this is the bug the user reported — a paid/confirmed
    // booking was appearing under Drafts. The bucket function MUST send
    // confirmed bookings to 'upcoming'.
    expect(
      bookingBucket(
        { status: 'confirmed', check_in_date: '2026-05-02', check_out_date: '2026-05-04' },
        TODAY,
      ),
    ).toBe('upcoming');
  });

  it('pending booking with future stay → Drafts (guest mode)', () => {
    expect(
      bookingBucket(
        { status: 'pending', check_in_date: '2026-05-02', check_out_date: '2026-05-04' },
        TODAY,
      ),
    ).toBe('drafts');
  });

  it('pending booking is hidden from hosts (not a draft for them)', () => {
    expect(
      bookingBucket(
        { status: 'pending', check_in_date: '2026-05-02', check_out_date: '2026-05-04' },
        TODAY,
        { isHostMode: true },
      ),
    ).toBe('past');
  });

  it('cancelled booking → Cancelled tab regardless of dates', () => {
    expect(
      bookingBucket(
        { status: 'cancelled', check_in_date: '2026-05-10', check_out_date: '2026-05-12' },
        TODAY,
      ),
    ).toBe('cancelled');
  });

  it('confirmed in-progress booking still shows under Upcoming (active stays bucket)', () => {
    expect(
      bookingBucket(
        { status: 'in_progress', check_in_date: '2026-04-29', check_out_date: '2026-05-03' },
        TODAY,
      ),
    ).toBe('upcoming');
  });

  it('confirmed booking whose stay is fully in the past → Past', () => {
    expect(
      bookingBucket(
        { status: 'confirmed', check_in_date: '2026-04-20', check_out_date: '2026-04-25' },
        TODAY,
      ),
    ).toBe('past');
  });

  it('completed booking → Past', () => {
    expect(
      bookingBucket(
        { status: 'completed', check_in_date: '2026-04-20', check_out_date: '2026-04-25' },
        TODAY,
      ),
    ).toBe('past');
  });

  it('pending_host_approval (RTB) shows under Upcoming, not Drafts', () => {
    expect(
      bookingBucket(
        { status: 'pending_host_approval', check_in_date: '2026-05-10', check_out_date: '2026-05-12' },
        TODAY,
      ),
    ).toBe('upcoming');
  });
});