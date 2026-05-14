import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PayoutTiersConfig {
  starter_free_bookings: number;
  starter_low_bookings: number;
  starter_free_pct: number;
  starter_low_pct: number;
  standard_pct: number;
  long_stay_threshold_nights: number;
  hold_sla_fraud_hours: number;
  hold_sla_dispute_days: number;
  hold_sla_bank_days: number;
  hold_sla_sanctions_days: number;
}

export const DEFAULT_PAYOUT_TIERS: PayoutTiersConfig = {
  starter_free_bookings: 3,
  starter_low_bookings: 10,
  starter_free_pct: 0,
  starter_low_pct: 6,
  standard_pct: 8,
  long_stay_threshold_nights: 28,
  hold_sla_fraud_hours: 72,
  hold_sla_dispute_days: 14,
  hold_sla_bank_days: 5,
  hold_sla_sanctions_days: 3,
};

export function usePayoutTiers() {
  const [config, setConfig] = useState<PayoutTiersConfig>(DEFAULT_PAYOUT_TIERS);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    const [{ data: ctrl }, { data: psettings }] = await Promise.all([
      supabase
        .from('platform_controls' as any)
        .select('settings')
        .eq('section', 'payout_tiers')
        .maybeSingle(),
      supabase
        .from('platform_settings' as any)
        .select('host_commission_percent')
        .maybeSingle(),
    ]);
    const merged: PayoutTiersConfig = {
      ...DEFAULT_PAYOUT_TIERS,
      ...((ctrl as any)?.settings as Partial<PayoutTiersConfig> | undefined),
    };
    // Standard rate is the platform-wide host commission (admin-editable)
    if (psettings && (psettings as any).host_commission_percent != null) {
      merged.standard_pct = Number((psettings as any).host_commission_percent);
    }
    setConfig(merged);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { config, loading, refetch };
}