import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface CancellationPolicyConfig {
  tier3_cash_refund_pct: number;
  tier3_credit_pct: number;
  tier3_host_comp_pct: number;
  tier4_cash_refund_pct: number;
  tier4_credit_pct: number;
  tier4_host_comp_pct: number;
  /** Tier 7 — buffer nights charged to host beyond nights stayed (default 1) */
  tier7_buffer_nights: number;
  /** Tier 7 — additional unused nights deducted from guest refund (default 1, "minus 1") */
  tier7_refund_deduction_nights: number;
  tier8_unused_refund_pct: number;
  tier8_stayed_refund_pct: number;
  tier9_unused_refund_pct: number;
  tier9_stayed_refund_pct: number;
  host_cancel_fine_30plus: number;
  host_cancel_fine_7_30: number;
  host_cancel_fine_under_7: number;
  host_cancel_fine_under_24h: number;
  host_cancel_credit_30plus: number;
  host_cancel_credit_7_30: number;
  host_cancel_credit_under_7: number;
  host_cancel_credit_under_24h: number;
  goodwill_full_refund_enabled: boolean;
}

export const DEFAULT_CANCELLATION_POLICY: CancellationPolicyConfig = {
  tier3_cash_refund_pct: 70,
  tier3_credit_pct: 90,
  tier3_host_comp_pct: 30,
  tier4_cash_refund_pct: 40,
  tier4_credit_pct: 70,
  tier4_host_comp_pct: 60,
  tier7_buffer_nights: 1,
  tier7_refund_deduction_nights: 1,
  tier8_unused_refund_pct: 100,
  tier8_stayed_refund_pct: 50,
  tier9_unused_refund_pct: 100,
  tier9_stayed_refund_pct: 25,
  host_cancel_fine_30plus: 0,
  host_cancel_fine_7_30: 100,
  host_cancel_fine_under_7: 200,
  host_cancel_fine_under_24h: 300,
  host_cancel_credit_30plus: 50,
  host_cancel_credit_7_30: 100,
  host_cancel_credit_under_7: 200,
  host_cancel_credit_under_24h: 300,
  goodwill_full_refund_enabled: true,
};

export function useCancellationPolicy() {
  const [policy, setPolicy] = useState<CancellationPolicyConfig>(DEFAULT_CANCELLATION_POLICY);
  const [loading, setLoading] = useState(true);

  const fetchPolicy = useCallback(async () => {
    const { data } = await supabase
      .from('platform_controls' as any)
      .select('settings')
      .eq('section', 'cancellation_policy')
      .maybeSingle();
    if (data && (data as any).settings) {
      setPolicy({ ...DEFAULT_CANCELLATION_POLICY, ...((data as any).settings as Partial<CancellationPolicyConfig>) });
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchPolicy(); }, [fetchPolicy]);

  return { policy, loading, refetch: fetchPolicy };
}
