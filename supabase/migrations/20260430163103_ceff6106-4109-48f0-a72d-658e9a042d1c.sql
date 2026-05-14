ALTER TABLE public.platform_settings
ADD COLUMN IF NOT EXISTS auto_message_templates jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.platform_settings.auto_message_templates IS
'Map of automated-message key -> overridden template string. Keys: pre_24h, pre_12h, arrival_nudge, host_no_confirm, no_show, post_review_guest, post_review_host, booking_confirmed, booking_cancelled. Placeholders supported: {code}, {title}, {maps}, {check_in}, {check_out}, {guests}, {initiator}.';