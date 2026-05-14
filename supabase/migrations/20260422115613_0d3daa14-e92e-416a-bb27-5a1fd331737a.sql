
-- Allow authenticated users to insert notifications for any other user,
-- but only via this safe wrapper that restricts the event types.
CREATE OR REPLACE FUNCTION public.create_notification(
  _recipient_id uuid,
  _event_type text,
  _channel text,
  _subject text,
  _body text,
  _related_entity_type text DEFAULT NULL,
  _related_entity_id uuid DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_allowed_events text[] := ARRAY[
    'new_message',
    'booking_request_pending',
    'booking_confirmed',
    'booking_approved',
    'booking_declined',
    'cancellation',
    'payment_succeeded',
    'payment_failed',
    'check_in_unlocked',
    'guest_checked_in',
    'review_request',
    'strike_warning',
    'strike_blocked',
    'strike_suspended'
  ];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (_event_type = ANY (v_allowed_events)) THEN
    RAISE EXCEPTION 'Event type % is not allowed via this function', _event_type;
  END IF;

  INSERT INTO public.notification_log (
    user_id, event_type, channel, status,
    subject, body, related_entity_type, related_entity_id,
    metadata, sent_at, is_read
  ) VALUES (
    _recipient_id, _event_type, _channel,
    CASE WHEN _channel = 'in_app' THEN 'sent' ELSE 'pending' END,
    _subject, _body, _related_entity_type, _related_entity_id,
    COALESCE(_metadata, '{}'::jsonb),
    CASE WHEN _channel = 'in_app' THEN now() ELSE NULL END,
    false
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text, text, text, uuid, jsonb) TO authenticated;
