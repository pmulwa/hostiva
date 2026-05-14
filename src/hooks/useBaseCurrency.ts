import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Reads the host's base currency from acct_settings.
 * Falls back to 'USD' until loaded.
 */
export function useBaseCurrency(hostId: string | undefined): string {
  const [currency, setCurrency] = useState<string>('USD');

  useEffect(() => {
    if (!hostId) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('acct_settings')
        .select('base_currency')
        .eq('host_id', hostId)
        .maybeSingle();
      if (active && data?.base_currency) setCurrency(data.base_currency);
    })();
    return () => { active = false; };
  }, [hostId]);

  return currency;
}
