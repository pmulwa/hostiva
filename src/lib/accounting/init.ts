import { supabase } from '@/integrations/supabase/client';

/**
 * Ensures the host's accounting foundation is seeded.
 * Idempotent - calls the SQL seeding function only when needed.
 */
export async function ensureAccountingSeeded(hostId: string): Promise<void> {
  const { data: settings } = await supabase
    .from('acct_settings')
    .select('seeded')
    .eq('host_id', hostId)
    .maybeSingle();

  if (settings?.seeded) return;

  // Call the SQL seed function via RPC
  const { error } = await (supabase.rpc as any)('acct_seed_defaults', { _host_id: hostId });
  if (error) {
    // Fallback: insert settings row to trigger via app
    await supabase.from('acct_settings').upsert(
      { host_id: hostId },
      { onConflict: 'host_id' }
    );
    // retry
    await (supabase.rpc as any)('acct_seed_defaults', { _host_id: hostId });
  }
}

export async function getAccountByCode(hostId: string, code: string): Promise<string | null> {
  const { data } = await supabase
    .from('acct_chart_of_accounts')
    .select('id')
    .eq('host_id', hostId)
    .eq('code', code)
    .maybeSingle();
  return data?.id ?? null;
}
