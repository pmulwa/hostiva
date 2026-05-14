
ALTER TABLE public.platform_settings
ADD COLUMN booking_id_prefix text NOT NULL DEFAULT 'BK';

ALTER TABLE public.platform_settings
ADD COLUMN booking_id_length integer NOT NULL DEFAULT 8;
