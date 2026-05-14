
-- Add scheduled_at for scheduled messages (NULL = send immediately)
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS scheduled_at timestamp with time zone DEFAULT NULL;

-- Add delivery_status: 'sent', 'delivered', 'read'
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'sent';

-- Add message_type: 'text', 'quick_reply', 'scheduled'
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'text';

-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- Update the SELECT policy to hide scheduled messages until their time arrives
DROP POLICY IF EXISTS "Users can view own messages" ON public.messages;
CREATE POLICY "Users can view own messages"
  ON public.messages FOR SELECT
  USING (
    (auth.uid() = sender_id OR auth.uid() = receiver_id)
    AND (
      scheduled_at IS NULL 
      OR scheduled_at <= now() 
      OR auth.uid() = sender_id
    )
  );
