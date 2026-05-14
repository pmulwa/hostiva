import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface TrustSafetySettings {
  risk_threshold_auto_approve: number;
  risk_threshold_flag_review: number;
  risk_threshold_require_verification: number;
  risk_threshold_block: number;
  high_value_booking_usd: number;
  new_account_days: number;
  rapid_booking_seconds: number;
  strike_warn_after: number;
  strike_block_after: number;
  strike_suspend_after: number;
  sanctions_screening_enabled: boolean;
  sanctions_auto_freeze: boolean;
  guest_id_verification_required: boolean;
  host_id_verification_required: boolean;
  host_tax_id_required: boolean;
  rebooking_guarantee_enabled: boolean;
  rebooking_unresponsive_minutes: number;
  rebooking_unresolved_hours: number;
  chargeback_absorbed_by_platform: boolean;
  force_majeure_host_compensation_pct: number;
  force_majeure_property_unavailable_pct: number;
}

export const DEFAULT_TRUST_SAFETY: TrustSafetySettings = {
  risk_threshold_auto_approve: 30,
  risk_threshold_flag_review: 60,
  risk_threshold_require_verification: 80,
  risk_threshold_block: 100,
  high_value_booking_usd: 2000,
  new_account_days: 30,
  rapid_booking_seconds: 60,
  strike_warn_after: 1,
  strike_block_after: 2,
  strike_suspend_after: 3,
  sanctions_screening_enabled: true,
  sanctions_auto_freeze: true,
  guest_id_verification_required: true,
  host_id_verification_required: true,
  host_tax_id_required: true,
  rebooking_guarantee_enabled: true,
  rebooking_unresponsive_minutes: 60,
  rebooking_unresolved_hours: 3,
  chargeback_absorbed_by_platform: true,
  force_majeure_host_compensation_pct: 50,
  force_majeure_property_unavailable_pct: 50,
};

export function useTrustSafetySettings() {
  const [settings, setSettings] = useState<TrustSafetySettings>(DEFAULT_TRUST_SAFETY);
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    const { data } = await supabase
      .from('platform_controls' as any)
      .select('settings')
      .eq('section', 'trust_safety')
      .maybeSingle();
    if (data && (data as any).settings) {
      setSettings({ ...DEFAULT_TRUST_SAFETY, ...((data as any).settings as Partial<TrustSafetySettings>) });
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  return { settings, loading, refetch: fetchSettings };
}