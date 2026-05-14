import { supabase } from '@/integrations/supabase/client';

export async function logAdminAction(
  action: string,
  entityType: string,
  entityId?: string,
  details?: Record<string, any>
) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from('audit_logs' as any).insert({
    admin_id: user.id,
    action,
    entity_type: entityType,
    entity_id: entityId || null,
    details: details || {},
  });
}
