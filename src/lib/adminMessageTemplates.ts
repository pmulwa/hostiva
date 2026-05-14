import { supabase } from '@/integrations/supabase/client';
import { AUTOMATED_MESSAGE_CATALOG, type AutomatedMessageType } from '@/lib/automatedMessages';

/**
 * Admin-editable template overrides for the automated messages
 * defined in {@link AUTOMATED_MESSAGE_CATALOG}.
 *
 * Templates are stored in `platform_controls` under section
 * `message_templates` as a `{ [type]: string }` map. Anything missing
 * falls back to the catalog's `example` text.
 */
export type MessageTemplatesMap = Partial<Record<AutomatedMessageType, string>>;

export function defaultTemplatesFromCatalog(): Record<AutomatedMessageType, string> {
  return AUTOMATED_MESSAGE_CATALOG.reduce((acc, def) => {
    acc[def.type] = def.example;
    return acc;
  }, {} as Record<AutomatedMessageType, string>);
}

export async function fetchMessageTemplates(): Promise<MessageTemplatesMap> {
  const { data } = await supabase
    .from('platform_controls')
    .select('settings')
    .eq('section', 'message_templates')
    .maybeSingle();
  return ((data?.settings ?? {}) as MessageTemplatesMap) || {};
}

export async function saveMessageTemplates(map: MessageTemplatesMap): Promise<{ error: string | null }> {
  const { data: existing } = await supabase
    .from('platform_controls')
    .select('id')
    .eq('section', 'message_templates')
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase
      .from('platform_controls')
      .update({ settings: map as any, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    return { error: error?.message ?? null };
  }
  const { error } = await supabase
    .from('platform_controls')
    .insert({ section: 'message_templates', settings: map as any } as any);
  return { error: error?.message ?? null };
}