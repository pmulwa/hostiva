/**
 * Notification dispatcher — routes a single event to all configured channels.
 *
 * Currently logs every send into `notification_log` with status='pending'.
 * Email/SMS/WhatsApp delivery will be wired up once those connectors are
 * configured (Resend/Lovable Email + Twilio). The schema, audit trail, and
 * channel routing are all production-ready today.
 */
import { supabase } from '@/integrations/supabase/client';

export type Channel = 'in_app' | 'push' | 'email' | 'sms' | 'whatsapp';

export type EventType =
  | 'booking_confirmed' | 'booking_request_pending' | 'booking_approved' | 'booking_declined'
  | 'payment_succeeded' | 'payment_failed' | 'check_in_unlocked' | 'guest_checked_in'
  | 'payout_released' | 'review_request' | 'cancellation' | 'dispute_opened'
  | 'force_majeure_declared' | 'strike_warning' | 'strike_blocked' | 'strike_suspended'
  | 'new_message';

export interface NotificationPayload {
  userId: string;
  eventType: EventType;
  subject?: string;
  body: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  metadata?: Record<string, unknown>;
  /** Override the default channels from the matrix */
  channels?: Channel[];
  /** Recipient role to look up in the matrix ('guest' | 'host' | 'user' | 'affected') */
  role?: string;
}

async function loadMatrix(): Promise<Record<string, Record<string, Channel[]>>> {
  const { data } = await supabase
    .from('platform_controls' as any)
    .select('settings')
    .eq('section', 'notification_matrix')
    .maybeSingle();
  return ((data as any)?.settings ?? {}) as Record<string, Record<string, Channel[]>>;
}

/**
 * Dispatch a notification. Inserts one row per channel into notification_log.
 * Returns the number of rows inserted.
 */
export async function dispatchNotification(payload: NotificationPayload): Promise<number> {
  const matrix = await loadMatrix();
  const eventConfig = matrix[payload.eventType] ?? {};
  const role = payload.role ?? 'user';
  const channels: Channel[] = payload.channels ?? eventConfig[role] ?? ['in_app'];

  if (channels.length === 0) return 0;

  // notification_log has no INSERT policy for end users — route through the
  // SECURITY DEFINER RPC so a guest can notify a host (and vice versa).
  let inserted = 0;
  for (const channel of channels) {
    const { error } = await supabase.rpc('create_notification' as any, {
      _recipient_id: payload.userId,
      _event_type: payload.eventType,
      _channel: channel,
      _subject: payload.subject ?? null,
      _body: payload.body,
      _related_entity_type: payload.relatedEntityType ?? null,
      _related_entity_id: payload.relatedEntityId ?? null,
      _metadata: payload.metadata ?? {},
    });
    if (error) {
      console.error('[notifications] dispatch failed:', error);
      continue;
    }
    inserted += 1;
  }
  return inserted;
}

/**
 * Dispatch the same event to multiple recipients (e.g. notify both guest and host).
 */
export async function dispatchToRoles(
  baseEvent: Omit<NotificationPayload, 'userId' | 'role'>,
  recipients: { userId: string; role: string }[],
): Promise<number> {
  let total = 0;
  for (const r of recipients) {
    total += await dispatchNotification({ ...baseEvent, userId: r.userId, role: r.role });
  }
  return total;
}

/**
 * Notify every active platform admin. Used by Admin Controls toggles like
 * `notifications.email_new_bookings` and `notifications.alert_cancellations`.
 * Returns the number of channel rows inserted across all admins.
 */
export async function notifyAdmins(
  event: Omit<NotificationPayload, 'userId' | 'role'>,
): Promise<number> {
  const { data, error } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('role', 'admin');
  if (error || !data) return 0;
  const ids = Array.from(new Set(data.map((r: { user_id: string }) => r.user_id)));
  let total = 0;
  for (const id of ids) {
    total += await dispatchNotification({ ...event, userId: id, role: 'admin' });
  }
  return total;
}