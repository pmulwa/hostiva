CREATE POLICY "Hosts can update host_response on own reviews"
ON public.reviews
FOR UPDATE
TO authenticated
USING (auth.uid() = host_id)
WITH CHECK (auth.uid() = host_id);