ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS platform_name text NOT NULL DEFAULT 'Hostiva',
  ADD COLUMN IF NOT EXISTS support_email text NOT NULL DEFAULT 'support@hostly.co.ke',
  ADD COLUMN IF NOT EXISTS support_phone text NOT NULL DEFAULT '+1 872 221 7881';