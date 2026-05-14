-- Allow message senders to delete (unsend) their own messages within 2 minutes of sending.
CREATE POLICY "Users can unsend own recent messages"
ON public.messages
FOR DELETE
TO authenticated
USING (
  auth.uid() = sender_id
  AND created_at > (now() - interval '2 minutes')
);

-- Also enable realtime DELETE events to flow through, and ensure full row data
-- is available on update/delete so partner views can react to unsends.
ALTER TABLE public.messages REPLICA IDENTITY FULL;