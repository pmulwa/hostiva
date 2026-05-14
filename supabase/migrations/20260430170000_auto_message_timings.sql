-- Add per-key timing overrides for automated messages.
-- Shape: { "<key>": { "startHrs": number, "endHrs": number } }
-- Hours are RELATIVE to the anchor for each key (negative = before check-in,
-- positive = after check-in for pre/arrival; for post_review_* relative to
-- check-out). NULL means use the built-in default.
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS auto_message_timings jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.platform_settings.auto_message_timings IS
  'Per-key admin overrides for automated message timing windows. See src/lib/autoMessageTemplates.ts for default windows.';
