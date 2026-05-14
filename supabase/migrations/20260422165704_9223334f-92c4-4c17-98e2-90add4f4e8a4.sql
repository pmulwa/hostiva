DROP POLICY IF EXISTS "Admins can update custom roles" ON public.custom_roles;

CREATE POLICY "Admins can update custom roles"
ON public.custom_roles
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));