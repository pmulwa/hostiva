import { supabase } from '@/integrations/supabase/client';
import { detectContactInfo } from '@/lib/contactDetection';
import type { TrustSafetySettings } from '@/hooks/useTrustSafetySettings';

export type StrikeAction = 'warn' | 'block' | 'suspend' | 'ban';

export interface StrikeCheckResult {
  shouldBlock: boolean;
  shouldSuspend: boolean;
  action: StrikeAction | null;
  offenceNumber: number;
  reasons: string[];
}

/**
 * Detect anti-circumvention violations in a message and decide the action
 * based on configured strike thresholds. Records the strike to the database.
 */
export async function checkAndRecordStrike(params: {
  userId: string;
  messageId?: string;
  content: string;
  settings: Pick<TrustSafetySettings, 'strike_warn_after' | 'strike_block_after' | 'strike_suspend_after'>;
}): Promise<StrikeCheckResult> {
  const { userId, messageId, content, settings } = params;

  const detection = detectContactInfo(content);
  if (!detection.detected) {
    return { shouldBlock: false, shouldSuspend: false, action: null, offenceNumber: 0, reasons: [] };
  }

  // Count prior strikes for this user
  const { count } = await supabase
    .from('anti_circumvention_strikes' as any)
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  const offenceNumber = (count ?? 0) + 1;

  // Decide action based on configured thresholds
  let action: StrikeAction = 'warn';
  let shouldBlock = false;
  let shouldSuspend = false;

  if (offenceNumber >= settings.strike_suspend_after) {
    action = 'suspend';
    shouldBlock = true;
    shouldSuspend = true;
  } else if (offenceNumber >= settings.strike_block_after) {
    action = 'block';
    shouldBlock = true;
  } else if (offenceNumber >= settings.strike_warn_after) {
    action = 'warn';
  }

  const violationType = detection.reasons[0]?.includes('phone') ? 'phone'
    : detection.reasons[0]?.includes('email') ? 'email'
    : detection.reasons[0]?.includes('link') || detection.reasons[0]?.includes('website') ? 'url'
    : detection.reasons[0]?.includes('app') ? 'off_platform_phrase'
    : 'other';

  await supabase.from('anti_circumvention_strikes' as any).insert({
    user_id: userId,
    message_id: messageId ?? null,
    violation_type: violationType,
    detected_content: content.slice(0, 500),
    offence_number: offenceNumber,
    action_taken: action,
  });

  // Suspend the account if threshold reached
  if (shouldSuspend) {
    await supabase
      .from('profiles')
      .update({
        is_suspended: true,
        suspended_at: new Date().toISOString(),
        suspended_reason: `Auto-suspended: anti-circumvention strike #${offenceNumber}`,
      })
      .eq('user_id', userId);
  }

  return { shouldBlock, shouldSuspend, action, offenceNumber, reasons: detection.reasons };
}