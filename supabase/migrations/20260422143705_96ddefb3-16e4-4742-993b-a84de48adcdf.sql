-- Allow assigning custom roles (defined in custom_roles) to users.
-- This complements user_roles which only supports the built-in app_role enum.

CREATE TABLE IF NOT EXISTS public.user_custom_role_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  custom_role_id UUID NOT NULL REFERENCES public.custom_roles(id) ON DELETE CASCADE,
  assigned_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, custom_role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_custom_role_assignments_user
  ON public.user_custom_role_assignments(user_id);

ALTER TABLE public.user_custom_role_assignments ENABLE ROW LEVEL SECURITY;

-- Only admins can read or modify assignments.
CREATE POLICY "Admins read custom role assignments"
ON public.user_custom_role_assignments
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins insert custom role assignments"
ON public.user_custom_role_assignments
FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins delete custom role assignments"
ON public.user_custom_role_assignments
FOR DELETE
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins update custom role assignments"
ON public.user_custom_role_assignments
FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Users can view their own assignments (so usePermissions can resolve them).
CREATE POLICY "Users view own custom role assignments"
ON public.user_custom_role_assignments
FOR SELECT
USING (auth.uid() = user_id);