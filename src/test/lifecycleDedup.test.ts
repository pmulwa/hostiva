import { describe, it, expect } from "vitest";
import {
  dueReminders,
  type BookingForLifecycle,
} from "../../supabase/functions/process-stay-lifecycle/lifecycle-helpers";

/**
 * These tests guard the dedup contract of `process-stay-lifecycle`:
 *   • A reminder key already present in `last_reminder_sent` MUST NOT be
 *     returned a second time.
 *   • Two consecutive ticks 15 minutes apart inside the same window must
 *     produce the reminder once and only once.
 *   • A globally disabled key must never appear, regardless of state.
 */

function bookingAt(
  checkInAt: Date,
  overrides: Partial<BookingForLifecycle> = {},
): BookingForLifecycle {
  // Encode an ISO date+time pair the helper can re-parse.
  const date = checkInAt.toISOString().slice(0, 10);
  const time = checkInAt.toISOString().slice(11, 19);
  const checkOutDate = new Date(checkInAt.getTime() + 5 * 24 * 36e5)
    .toISOString()
    .slice(0, 10);
  return {
    id: "b1",
    status: "confirmed",
    check_in_date: date,
    check_out_date: checkOutDate,
    actual_check_in_at: null,
    no_show_marked_at: null,
    last_reminder_sent: {},
    properties: {
      check_in_time: time,
      check_out_time: "11:00:00",
      title: "Test stay",
    },
    ...overrides,
  };
}

describe("dueReminders dedup", () => {
  it("returns pre_24h inside the 24h–12h window", () => {
    const now = new Date("2026-05-01T00:00:00Z");
    const checkIn = new Date("2026-05-01T20:00:00Z"); // 20h away
    const due = dueReminders(bookingAt(checkIn), now);
    expect(due).toContain("pre_24h");
  });

  it("does NOT return pre_24h again once last_reminder_sent.pre_24h is set", () => {
    const now = new Date("2026-05-01T00:00:00Z");
    const checkIn = new Date("2026-05-01T20:00:00Z");
    const b = bookingAt(checkIn, {
      last_reminder_sent: { pre_24h: "2026-04-30T23:45:00Z" },
    });
    expect(dueReminders(b, now)).not.toContain("pre_24h");
  });

  it("simulates two cron ticks 15min apart and never duplicates", () => {
    const checkIn = new Date("2026-05-01T20:00:00Z");
    const tick1 = new Date("2026-05-01T00:00:00Z");
    const tick2 = new Date("2026-05-01T00:15:00Z");

    let b = bookingAt(checkIn);
    const due1 = dueReminders(b, tick1);
    expect(due1).toContain("pre_24h");

    // Cron writes the timestamps it just sent, exactly like index.ts.
    const newSent = { ...(b.last_reminder_sent ?? {}) };
    for (const k of due1) newSent[k] = tick1.toISOString();
    b = { ...b, last_reminder_sent: newSent };

    const due2 = dueReminders(b, tick2);
    for (const k of due1) expect(due2).not.toContain(k);
  });

  it("respects the global disabled-keys set", () => {
    const now = new Date("2026-05-01T00:00:00Z");
    const checkIn = new Date("2026-05-01T20:00:00Z");
    const due = dueReminders(bookingAt(checkIn), now, new Set(["pre_24h"]));
    expect(due).not.toContain("pre_24h");
  });

  it("emits host_no_confirm only once across many post-check-in ticks", () => {
    const checkIn = new Date("2026-05-01T15:00:00Z");
    let b = bookingAt(checkIn);
    let firedCount = 0;

    // Tick every hour from +24h to +48h after check-in.
    for (let h = 24; h <= 48; h++) {
      const now = new Date(checkIn.getTime() + h * 36e5);
      const due = dueReminders(b, now);
      if (due.includes("host_no_confirm")) {
        firedCount += 1;
        const newSent = { ...(b.last_reminder_sent ?? {}) };
        for (const k of due) newSent[k] = now.toISOString();
        b = { ...b, last_reminder_sent: newSent };
      }
    }
    expect(firedCount).toBe(1);
  });

  it("emits no_show only once even on subsequent ticks", () => {
    const checkIn = new Date("2026-05-01T15:00:00Z");
    let b = bookingAt(checkIn);
    let count = 0;
    // Tick every hour from +24h to +48h.
    for (let h = 24; h <= 48; h++) {
      const now = new Date(checkIn.getTime() + h * 36e5);
      const due = dueReminders(b, now);
      if (due.includes("no_show")) {
        count += 1;
        const newSent = { ...(b.last_reminder_sent ?? {}) };
        for (const k of due) newSent[k] = now.toISOString();
        b = { ...b, last_reminder_sent: newSent };
      }
    }
    expect(count).toBe(1);
  });

  it("does not return reminders that are already fully sent", () => {
    const now = new Date("2026-05-10T13:00:00Z");
    const b: BookingForLifecycle = {
      id: "b2",
      status: "completed",
      check_in_date: "2026-05-05",
      check_out_date: "2026-05-10",
      actual_check_in_at: "2026-05-05T16:00:00Z",
      no_show_marked_at: null,
      last_reminder_sent: {
        pre_24h: "2026-05-04T15:00:00Z",
        pre_12h: "2026-05-05T03:00:00Z",
        post_review_guest: "2026-05-10T12:00:00Z",
        post_review_host: "2026-05-10T12:00:00Z",
      },
      properties: { check_in_time: "15:00:00", check_out_time: "11:00:00" },
    };
    expect(dueReminders(b, now)).toEqual([]);
  });

  it("respects admin timing overrides", () => {
    // Override pre_24h to fire only 6h–4h before check-in.
    const checkIn = new Date("2026-05-01T20:00:00Z");
    const tooEarly = new Date("2026-05-01T00:00:00Z"); // 20h before — default would fire
    const inWindow = new Date("2026-05-01T15:00:00Z"); // 5h before — override should fire
    const overrides = { pre_24h: { startHrs: -6, endHrs: -4 } };

    const dueEarly = dueReminders(bookingAt(checkIn), tooEarly, new Set(), overrides);
    expect(dueEarly).not.toContain("pre_24h");

    const dueIn = dueReminders(bookingAt(checkIn), inWindow, new Set(), overrides);
    expect(dueIn).toContain("pre_24h");
  });
});