ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';

COMMENT ON COLUMN public.properties.timezone IS
  'IANA timezone for the property (e.g. Africa/Nairobi). All check-in / check-out dates are anchored to this zone.';