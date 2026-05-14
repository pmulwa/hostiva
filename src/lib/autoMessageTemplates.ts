/**
 * Browser-side re-exports of the pure template helpers that live with the
 * stay-lifecycle edge function. Keeping them in one place means the cron,
 * `confirm-booking-payment`, the cancel flow in Bookings.tsx, and the admin
 * settings panel all render the same wording from the same source.
 */
export {
  renderTemplate,
  effectiveTemplate,
  DEFAULT_TEMPLATES,
  DEFAULT_TIMINGS,
  effectiveTiming,
  ALL_AUTO_META,
  REMINDER_META,
  EXTRA_AUTO_META,
  REMINDER_KEYS,
  type AnyAutoKey,
  type AutoMessageMeta,
  type ReminderMeta,
  type ReminderKey,
  type TimingWindow,
} from '../../supabase/functions/_shared/automated-messages';