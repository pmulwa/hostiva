import { supabase } from '@/integrations/supabase/client';

/**
 * Catalog of automated/system messages the platform sends on the user's behalf.
 *
 * The product currently exposes ONLY THREE automated messages, all of which
 * are tied to the booking lifecycle:
 *
 *   1. booking_confirmed  — guest → host, sent immediately after Stripe
 *      successfully authorises payment.
 *   2. booking_cancelled  — sent in either direction when a host or guest
 *      cancels the booking.
 *   3. stay_lifecycle     — umbrella toggle for the time-based messages
 *      sent by `process-stay-lifecycle` (24h pre check-in directions, 12h
 *      pre check-in details request, post-checkout review prompt, etc.).
 *
 * Every other "system" message in the codebase (issue replies, goodwill
 * requests, admin-closed notices, free-cancellation request approval/decline)
 * is now sent unconditionally — those are user-triggered courtesy messages,
 * not background automation, so they don't get a toggle.
 */
export type AutomatedMessageType =
  | 'booking_confirmed'
  | 'booking_cancelled'
  | 'stay_lifecycle';

export type QuickReplyKey =
  | 'checkin'
  | 'dates'
  | 'location'
  | 'amenities'
  | 'confirmed';

export interface AutomatedMessageDef {
  type: AutomatedMessageType;
  group: 'lifecycle';
  label: string;
  description: string;
  example: string;
}

export const AUTOMATED_MESSAGE_CATALOG: AutomatedMessageDef[] = [
  {
    type: 'booking_confirmed',
    group: 'lifecycle',
    label: 'Booking confirmed',
    description: 'Sent from the guest to the host the moment their booking is confirmed after payment.',
    example:
      '🎉 Booking HTL-XXXXXXXX has been confirmed. I have booked Cozy Stay from 2026-05-10 (check-in) to 2026-05-15 (check-out) for one guest. Looking forward to my stay.',
  },
  {
    type: 'booking_cancelled',
    group: 'lifecycle',
    label: 'Booking cancelled',
    description: 'Sent to the other party whenever a host or guest cancels a confirmed booking.',
    example:
      '🚫 Booking HTL-XXXXXXXX was cancelled by the host. The stay from 2026-05-10 (check-in) to 2026-05-15 (check-out) for one guest will no longer proceed. Thank you for your understanding.',
  },
  {
    type: 'stay_lifecycle',
    group: 'lifecycle',
    label: 'Stay lifecycle reminders',
    description:
      'Time-based reminders sent automatically as the stay approaches and ends: directions 24h before check-in, a check-in details request 12h before, the check-in confirmation nudge during the stay, and the post-checkout review prompt.',
    example:
      '📍 Booking HTL-XXXXXXXX. Welcome and we look forward to your stay. Please use the link below to find directions to the property: https://www.google.com/maps?q=…',
  },
];

export const QUICK_REPLY_CATALOG: { key: QuickReplyKey; label: string; text: string }[] = [
  { key: 'checkin', label: 'Check-in instructions', text: "Hi! Could you please share the check-in instructions and any access codes I'll need?" },
  { key: 'dates', label: 'Dates available?', text: "Are the dates I selected still available? I'd love to confirm my booking." },
  { key: 'location', label: 'Location & nearby', text: "Could you share more details about the location, nearby attractions, and transportation options?" },
  { key: 'amenities', label: 'Amenities', text: "Could you tell me more about the amenities available at the property?" },
  { key: 'confirmed', label: 'Thanks for confirming', text: "Thank you for confirming! I'm looking forward to my stay. Please let me know if there's anything I should prepare." },
];

/** Default = enabled for everything. */
export function defaultAutomatedMessages(): Record<AutomatedMessageType, boolean> {
  return AUTOMATED_MESSAGE_CATALOG.reduce((acc, def) => {
    acc[def.type] = true;
    return acc;
  }, {} as Record<AutomatedMessageType, boolean>);
}

export function defaultQuickReplies(): Record<QuickReplyKey, boolean> {
  return QUICK_REPLY_CATALOG.reduce((acc, def) => {
    acc[def.key] = true;
    return acc;
  }, {} as Record<QuickReplyKey, boolean>);
}

/**
 * Look up a sender's preference for a given automated message type.
 * Defaults to `true` (enabled) if the user has no record yet or the
 * specific key has never been toggled.
 */
export async function isAutomatedMessageEnabled(
  senderId: string,
  type: AutomatedMessageType,
): Promise<boolean> {
  if (!senderId) return true;
  const { data } = await supabase
    .from('user_preferences')
    .select('automated_messages')
    .eq('user_id', senderId)
    .maybeSingle();
  const map = (data?.automated_messages ?? {}) as Partial<Record<AutomatedMessageType, boolean>>;
  return map[type] !== false;
}
