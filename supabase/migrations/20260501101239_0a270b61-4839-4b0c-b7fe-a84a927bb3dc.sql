ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS platform_name text NOT NULL DEFAULT 'Hostiva',
  ADD COLUMN IF NOT EXISTS support_email text NOT NULL DEFAULT 'support@host-iva.com',
  ADD COLUMN IF NOT EXISTS support_phone text NOT NULL DEFAULT '+254792895225';