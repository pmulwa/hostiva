
-- Allow admins to read all messages for moderation/support purposes
CREATE POLICY "Admins can view all messages"
ON public.messages
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Allow admins to update any message (mark read, moderate, etc.)
CREATE POLICY "Admins can update any message"
ON public.messages
FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'::app_role));
