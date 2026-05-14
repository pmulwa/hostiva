ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pronouns text,
  ADD COLUMN IF NOT EXISTS property_relation text,
  ADD COLUMN IF NOT EXISTS fun_fact text,
  ADD COLUMN IF NOT EXISTS languages text;