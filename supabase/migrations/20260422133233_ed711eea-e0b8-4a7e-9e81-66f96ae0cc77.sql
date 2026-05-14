-- Admin messaging: thread resolution + participant muting
-- Tracks whether a particular conversation thread has been marked resolved by an admin
CREATE TABLE public.message_thread_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a UUID NOT NULL,
  user_b UUID NOT NULL,
  booking_id UUID,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Pair is stored canonically: user_a < user_b lexicographically
  CONSTRAINT user_a_lt_user_b CHECK (user_a < user_b)
);

CREATE UNIQUE INDEX message_thread_states_unique_idx
  ON public.message_thread_states (user_a, user_b, COALESCE(booking_id, '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE public.message_thread_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage thread states"
  ON public.message_thread_states FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Participants can view thread state"
  ON public.message_thread_states FOR SELECT
  USING (auth.uid() = user_a OR auth.uid() = user_b);

CREATE TRIGGER message_thread_states_updated_at
  BEFORE UPDATE ON public.message_thread_states
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Per-user messaging mute applied by admins. Muted users cannot send messages.
CREATE TABLE public.messaging_mutes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  muted_by UUID NOT NULL,
  reason TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.messaging_mutes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage mutes"
  ON public.messaging_mutes FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can see their own mute"
  ON public.messaging_mutes FOR SELECT
  USING (auth.uid() = user_id);

CREATE TRIGGER messaging_mutes_updated_at
  BEFORE UPDATE ON public.messaging_mutes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Block muted users from inserting messages at the database level so the
-- restriction is enforced regardless of which client is used.
CREATE OR REPLACE FUNCTION public.enforce_messaging_mute()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_muted BOOLEAN;
BEGIN
  -- Admins are exempt so they can still moderate
  IF public.has_role(NEW.sender_id, 'admin'::app_role) THEN
    RETURN NEW;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.messaging_mutes
    WHERE user_id = NEW.sender_id
      AND (expires_at IS NULL OR expires_at > now())
  ) INTO is_muted;
  IF is_muted THEN
    RAISE EXCEPTION 'You are currently muted from sending messages. Please contact support.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_messaging_mute_trigger
  BEFORE INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_messaging_mute();