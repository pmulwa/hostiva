// Pure helpers for the stay-lifecycle cron.
//
// Extracted into their own module so they can be unit-tested with vitest
// (no Deno runtime, no Supabase client). The edge function in `index.ts`
// imports from here at runtime via Deno's TS resolver — vitest imports
// directly via the project's tsconfig.

export type ReminderKey =
  | "pre_24h"
  | "pre_12h"
  | "host_no_confirm"
  | "post_review_guest"
  | "post_review_host"
  | "no_show";

/** All reminder keys exposed to admins for visibility + per-key disable. */
export const REMINDER_KEYS: ReminderKey[] = [
  "pre_24h",
  "pre_12h",
  "host_no_confirm",
  "post_review_guest",
  "post_review_host",
  "no_show",
];

export interface BookingForLifecycle {
  id: string;
  status: string;
  check_in_date: string;
  check_out_date: string;
  actual_check_in_at: string | null;
  no_show_marked_at: string | null;
  last_reminder_sent: Record<string, string> | null;
  properties?: {
    check_in_time: string | null;
    check_out_time: string | null;
    latitude?: number | null;
    longitude?: number | null;
    address?: string | null;
    city?: string | null;
    title?: string | null;
  } | null;
}

export function checkInDateTime(b: BookingForLifecycle): Date {
  const t = b.properties?.check_in_time || "15:00:00";
  return new Date(`${b.check_in_date}T${t}Z`);
}

export function checkOutDateTime(b: BookingForLifecycle): Date {
  const t = b.properties?.check_out_time || "11:00:00";
  return new Date(`${b.check_out_date}T${t}Z`);
}

export function hoursUntil(target: Date, now: Date): number {
  return (target.getTime() - now.getTime()) / 36e5;
}

/**
 * Default timing windows per reminder key, expressed in hours relative to
 * a key-specific anchor:
 *   - pre_24h, pre_12h, host_no_confirm, no_show: anchor = check-in time.
 *     Negative hoursFromAnchor = before check-in, positive = after.
 *   - post_review_*: anchor = check-out time, positive = after check-out.
 * `startHrs` is inclusive lower bound, `endHrs` is exclusive upper bound
 * (or omitted for open-ended).
 */
export interface TimingWindow {
  startHrs: number;
  endHrs?: number;
}

export const DEFAULT_TIMINGS: Record<ReminderKey, TimingWindow> = {
  pre_24h: { startHrs: -24, endHrs: -12 },
  pre_12h: { startHrs: -12, endHrs: 0 },
  host_no_confirm: { startHrs: 24 },
  no_show: { startHrs: 24 },
  post_review_guest: { startHrs: 1 },
  post_review_host: { startHrs: 1 },
};

/**
 * Resolve the effective timing window for a key, preferring the admin
 * override stored in `platform_settings.auto_message_timings`. Falls back
 * to {@link DEFAULT_TIMINGS}. Invalid overrides are ignored.
 */
export function effectiveTiming(
  key: ReminderKey,
  overrides:
    | Record<string, { startHrs?: number; endHrs?: number } | undefined | null>
    | null
    | undefined,
): TimingWindow {
  const o = overrides?.[key];
  if (o && typeof o.startHrs === "number" && Number.isFinite(o.startHrs)) {
    const win: TimingWindow = { startHrs: o.startHrs };
    if (typeof o.endHrs === "number" && Number.isFinite(o.endHrs)) {
      win.endHrs = o.endHrs;
    }
    return win;
  }
  return DEFAULT_TIMINGS[key];
}

/**
 * Decide which reminder keys are due for this booking at `now`, given which
 * ones have already been sent (`last_reminder_sent`) and which keys are
 * globally disabled by an admin.
 *
 * CRITICAL: A key already present in `last_reminder_sent` is NEVER returned
 * again. This is the dedup contract that the cron relies on.
 */
export function dueReminders(
  b: BookingForLifecycle,
  now: Date,
  disabled: Set<string> = new Set(),
  timings:
    | Record<string, { startHrs?: number; endHrs?: number } | undefined | null>
    | null = null,
): ReminderKey[] {
  const sent = b.last_reminder_sent || {};
  const due: ReminderKey[] = [];

  const checkInAt = checkInDateTime(b);
  const checkOutAt = checkOutDateTime(b);
  const hoursToCheckIn = hoursUntil(checkInAt, now);
  // hoursFromCheckIn: signed value relative to check-in time.
  //   negative = before check-in, positive = after check-in.
  const hoursFromCheckIn = -hoursToCheckIn;
  const hoursFromCheckOut = (now.getTime() - checkOutAt.getTime()) / 36e5;
  const isLive = b.status === "confirmed" || b.status === "in_progress";
  const isCompleted = b.status === "completed";

  const consider = (k: ReminderKey) => {
    if (disabled.has(k)) return false;
    if (sent[k]) return false;
    return true;
  };

  // Helper: is `value` inside [start, end) (end optional / open-ended).
  const inWindow = (value: number, win: TimingWindow): boolean => {
    if (value < win.startHrs) return false;
    if (typeof win.endHrs === "number" && value >= win.endHrs) return false;
    return true;
  };

  const t = (k: ReminderKey) => effectiveTiming(k, timings);

  if (isLive && inWindow(hoursFromCheckIn, t("pre_24h")) && consider("pre_24h")) {
    due.push("pre_24h");
  }
  if (isLive && inWindow(hoursFromCheckIn, t("pre_12h")) && consider("pre_12h")) {
    due.push("pre_12h");
  }
  if (
    isLive &&
    inWindow(hoursFromCheckIn, t("host_no_confirm")) &&
    !b.actual_check_in_at &&
    consider("host_no_confirm")
  ) {
    due.push("host_no_confirm");
  }
  if (
    isLive &&
    inWindow(hoursFromCheckIn, t("no_show")) &&
    !b.actual_check_in_at &&
    !b.no_show_marked_at &&
    consider("no_show")
  ) {
    due.push("no_show");
  }

  // Post-checkout reviews — anchored on check-out time.
  const reviewBaseEligible =
    (isCompleted || (isLive && now > checkOutAt)) && !b.no_show_marked_at;
  if (
    reviewBaseEligible &&
    inWindow(hoursFromCheckOut, t("post_review_guest")) &&
    consider("post_review_guest")
  ) {
    due.push("post_review_guest");
  }
  if (
    reviewBaseEligible &&
    inWindow(hoursFromCheckOut, t("post_review_host")) &&
    consider("post_review_host")
  ) {
    due.push("post_review_host");
  }

  return due;
}

/**
 * Catalog of automated message keys exposed to the admin UI: human label,
 * timing description, sender → recipient, and channel.
 */
export interface ReminderMeta {
  key: ReminderKey;
  label: string;
  timing: string;
  flow: string;
  channel: "thread" | "notification";
  /**
   * Human-readable template of the message that gets sent. Uses
   * `{code}` for the booking code, `{title}` for the property title,
   * and `{maps}` for the directions URL. Shown in the admin Messages
   * settings panel so admins can audit exactly what guests/hosts see.
   */
  template: string;
}

export const REMINDER_META: ReminderMeta[] = [
  {
    key: "pre_24h",
    label: "Pre check-in directions",
    timing: "24h–12h before check-in",
    flow: "Host → Guest",
    channel: "thread",
    template:
      "Booking {code}. Welcome and we look forward to your stay at {title}. Please use the link below to find directions to the property: {maps}",
  },
  {
    key: "pre_12h",
    label: "Pre check-in details request",
    timing: "12h–0h before check-in",
    flow: "Guest → Host",
    channel: "thread",
    template:
      "Booking {code}. I am scheduled to check in shortly. Kindly share the check-in details, including the safe lock code or access code, and instructions on where to collect the key.",
  },
  {
    key: "host_no_confirm",
    label: "24h no-confirmation reminder",
    timing: "24h+ after check-in time, no confirmation",
    flow: "Host → Guest",
    channel: "thread",
    template:
      "⏰ Heads up — your guest's scheduled check-in time at {title} was over an hour ago and we don't have a confirmation yet. Open the booking thread and tap \"Confirm check-in\" once they've arrived.",
  },
  {
    key: "no_show",
    label: "No-show notice",
    timing: "24h+ after check-in time, no confirmation",
    flow: "Host → Guest",
    channel: "thread",
    template:
      "⚠️ We've marked this booking as a no-show because we didn't receive arrival confirmation within 24 hours of check-in. Contact the host or support if this is a mistake.",
  },
  {
    key: "post_review_guest",
    label: "Post-checkout review prompt (guest)",
    timing: "1h after scheduled check-out",
    flow: "Host → Guest",
    channel: "thread",
    template:
      "Booking {code}. We hope you enjoyed your stay at {title}. Please leave a review on /bookings to assist future guests.",
  },
  {
    key: "post_review_host",
    label: "Post-checkout review prompt (host)",
    timing: "1h after scheduled check-out",
    flow: "Guest → Host",
    channel: "thread",
    template:
      "Booking {code} has been completed. We hope you enjoyed hosting at {title}. Please leave a review on /bookings to assist future hosts.",
  },
];

/**
 * All non-lifecycle automated message keys that the platform sends and that
 * admins can override in `platform_settings.auto_message_templates`.
 */
export type ExtraAutoKey = "booking_confirmed" | "booking_cancelled";
export type AnyAutoKey = ReminderKey | ExtraAutoKey;

export interface AutoMessageMeta {
  key: AnyAutoKey;
  label: string;
  timing: string;
  flow: string;
  channel: "thread" | "notification";
  template: string;
}

/** Templates for automated messages NOT driven by the cron. */
export const EXTRA_AUTO_META: AutoMessageMeta[] = [
  {
    key: "booking_confirmed",
    label: "Booking confirmed",
    timing: "On successful payment",
    flow: "Guest → Host",
    channel: "thread",
    template:
      "🎉 Booking {code} has been confirmed. I have booked {title} from {check_in} (check-in) to {check_out} (check-out) for {guests}. Looking forward to my stay.",
  },
  {
    key: "booking_cancelled",
    label: "Booking cancelled",
    timing: "On cancellation by host or guest",
    flow: "Initiator → Other party",
    channel: "thread",
    template:
      "🚫 Booking {code} was cancelled by the {initiator}. The stay from {check_in} (check-in) to {check_out} (check-out) for {guests} will no longer proceed. Thank you for your understanding.",
  },
];

/** Combined catalog used by the admin Messages-settings panel. */
export const ALL_AUTO_META: AutoMessageMeta[] = [
  ...REMINDER_META.map((m) => ({
    key: m.key as AnyAutoKey,
    label: m.label,
    timing: m.timing,
    flow: m.flow,
    channel: m.channel,
    template: m.template,
  })),
  ...EXTRA_AUTO_META,
];

/** Built-in default templates keyed by message key. */
export const DEFAULT_TEMPLATES: Record<AnyAutoKey, string> =
  ALL_AUTO_META.reduce((acc, m) => {
    acc[m.key] = m.template;
    return acc;
  }, {} as Record<AnyAutoKey, string>);

/**
 * Render a template by substituting `{placeholder}` tokens. Unknown tokens
 * are left in place so missing data is visible to admins, not silently
 * blanked. Pure function — safe to import from both vitest and Deno.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const v = vars[name];
    if (v === undefined || v === null || v === "") return match;
    return String(v);
  });
}

/**
 * Resolve the effective template for a key, preferring an admin override in
 * `platform_settings.auto_message_templates` and falling back to the built-in
 * default. Trims whitespace and ignores empty overrides.
 */
export function effectiveTemplate(
  key: AnyAutoKey,
  overrides: Record<string, string | undefined | null> | null | undefined,
): string {
  const override = overrides?.[key];
  if (typeof override === "string" && override.trim().length > 0) {
    return override;
  }
  return DEFAULT_TEMPLATES[key];
}