-- Add columns for admin-defined automated message timings & custom templates
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS auto_message_timings jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS custom_auto_messages jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.platform_settings.auto_message_timings IS
  'Per-reminder timing overrides keyed by ReminderKey: { startHrs:number, endHrs?:number }';
COMMENT ON COLUMN public.platform_settings.custom_auto_messages IS
  'Admin-defined extra automated messages: array of { id, label, anchor (check_in|check_out), direction (host_to_guest|guest_to_host), startHrs, endHrs?, template, enabled }';