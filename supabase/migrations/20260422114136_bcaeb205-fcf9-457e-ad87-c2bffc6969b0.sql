
CREATE TABLE IF NOT EXISTS public.custom_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  permissions text[] NOT NULL DEFAULT '{}',
  is_builtin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.custom_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view custom roles"
  ON public.custom_roles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert custom roles"
  ON public.custom_roles FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update custom roles"
  ON public.custom_roles FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') AND is_builtin = false);

CREATE POLICY "Admins can delete custom roles"
  ON public.custom_roles FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') AND is_builtin = false);

CREATE OR REPLACE FUNCTION public.touch_custom_roles_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_custom_roles_updated_at ON public.custom_roles;
CREATE TRIGGER trg_custom_roles_updated_at
  BEFORE UPDATE ON public.custom_roles
  FOR EACH ROW EXECUTE FUNCTION public.touch_custom_roles_updated_at();

INSERT INTO public.custom_roles (name, description, permissions, is_builtin) VALUES
  ('Admin', 'Full platform access', ARRAY['view_users','manage_users','view_listings','moderate_listings','view_bookings','manage_bookings','view_disputes','resolve_disputes','view_payouts','manage_payouts','view_reports','manage_platform_settings'], true),
  ('Moderator', 'Content moderation and disputes', ARRAY['view_users','view_listings','moderate_listings','view_disputes','resolve_disputes'], true)
ON CONFLICT (name) DO NOTHING;
