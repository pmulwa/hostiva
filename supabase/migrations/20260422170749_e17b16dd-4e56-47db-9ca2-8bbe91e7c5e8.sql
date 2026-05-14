ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS automated_messages jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS quick_replies jsonb NOT NULL DEFAULT '{}'::jsonb;