import { describe, it, expect } from 'vitest';
import { shouldShowModifyButton } from '@/lib/modifyBookingVisibility';

const NOW = new Date('2026-05-01T12:00:00Z');

describe('shouldShowModifyButton — guest modify regression guard', () => {
  it('shows for a guest on a confirmed upcoming booking', () => {
    expect(
      shouldShowModifyButton({
        status: 'confirmed',
        isHost: false,
        checkInDate: '2026-06-10',
        now: NOW,
      }),
    ).toBe(true);
  });

  it('hides when the viewer is the host', () => {
    expect(
      shouldShowModifyButton({
        status: 'confirmed',
        isHost: true,
        checkInDate: '2026-06-10',
        now: NOW,
      }),
    ).toBe(false);
  });

  it('hides when the booking is still pending (draft)', () => {
    expect(
      shouldShowModifyButton({
        status: 'pending',
        isHost: false,
        checkInDate: '2026-06-10',
        now: NOW,
      }),
    ).toBe(false);
  });

  it('hides when the booking has been cancelled', () => {
    expect(
      shouldShowModifyButton({
        status: 'cancelled',
        isHost: false,
        checkInDate: '2026-06-10',
        now: NOW,
      }),
    ).toBe(false);
  });

  it('hides once the check-in date has passed (in-progress / past)', () => {
    expect(
      shouldShowModifyButton({
        status: 'confirmed',
        isHost: false,
        checkInDate: '2026-04-20',
        now: NOW,
      }),
    ).toBe(false);
  });

  it('hides on the day of check-in (no longer "upcoming")', () => {
    expect(
      shouldShowModifyButton({
        status: 'confirmed',
        isHost: false,
        checkInDate: '2026-05-01',
        now: NOW,
      }),
    ).toBe(false);
  });

  it('shows for any guest — does not depend on guest identity', () => {
    // Regression guard: we want every guest viewing their own confirmed
    // upcoming booking to see the button. The helper has no concept of
    // "guest id" — visibility is purely role + status + date.
    for (const _ of ['guest-a', 'guest-b', 'guest-c']) {
      expect(
        shouldShowModifyButton({
          status: 'confirmed',
          isHost: false,
          checkInDate: '2026-12-25',
          now: NOW,
        }),
      ).toBe(true);
    }
  });

  it('handles malformed check-in dates safely', () => {
    expect(
      shouldShowModifyButton({
        status: 'confirmed',
        isHost: false,
        checkInDate: 'not-a-date',
        now: NOW,
      }),
    ).toBe(false);
  });
});