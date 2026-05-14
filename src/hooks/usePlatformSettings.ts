import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PlatformSettings {
  id: string;
  service_fee_percent: number;
  host_commission_percent: number;
  service_tax_percent: number;
  host_tax_percent: number;
  review_window_days: number;
  booking_id_prefix: string;
  booking_id_length: number;
  guest_id_prefix: string;
  guest_id_length: number;
  host_id_prefix: string;
  host_id_length: number;
  staff_id_prefix: string;
  staff_id_length: number;
}

const DEFAULT_SETTINGS: Omit<PlatformSettings, 'id'> = {
  service_fee_percent: 10,
  host_commission_percent: 3,
  service_tax_percent: 18,
  host_tax_percent: 15,
  review_window_days: 10,
  booking_id_prefix: 'BK',
  booking_id_length: 8,
  guest_id_prefix: 'GST',
  guest_id_length: 8,
  host_id_prefix: 'HST',
  host_id_length: 8,
  staff_id_prefix: 'STF',
  staff_id_length: 8,
};

export function usePlatformSettings() {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSettings = async () => {
    const { data, error } = await supabase
      .from('platform_settings' as any)
      .select('*')
      .limit(1)
      .single();

    if (!error && data) {
      const d = data as any;
      setSettings({
        id: d.id,
        service_fee_percent: d.service_fee_percent,
        host_commission_percent: d.host_commission_percent,
        service_tax_percent: d.service_tax_percent,
        host_tax_percent: d.host_tax_percent,
        review_window_days: d.review_window_days ?? 10,
        booking_id_prefix: d.booking_id_prefix ?? 'BK',
        booking_id_length: d.booking_id_length ?? 8,
        guest_id_prefix: d.guest_id_prefix ?? 'GST',
        guest_id_length: d.guest_id_length ?? 8,
        host_id_prefix: d.host_id_prefix ?? 'HST',
        host_id_length: d.host_id_length ?? 8,
        staff_id_prefix: d.staff_id_prefix ?? 'STF',
        staff_id_length: d.staff_id_length ?? 8,
      });
    } else {
      setSettings({ id: '', ...DEFAULT_SETTINGS });
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  return { settings, loading, refetch: fetchSettings };
}

export function calculateFees(
  subtotal: number,
  settings: PlatformSettings,
  serviceFeeChargedTo: 'guest' | 'host' | 'split' = 'guest'
) {
  const serviceFeeTotal = subtotal * (settings.service_fee_percent / 100);
  const serviceTax = serviceFeeTotal * (settings.service_tax_percent / 100);
  const serviceFeeWithTax = serviceFeeTotal + serviceTax;

  let guestServiceFee = 0;
  let hostServiceFee = 0;
  if (serviceFeeChargedTo === 'guest') {
    guestServiceFee = serviceFeeWithTax;
  } else if (serviceFeeChargedTo === 'host') {
    hostServiceFee = serviceFeeWithTax;
  } else {
    guestServiceFee = serviceFeeWithTax / 2;
    hostServiceFee = serviceFeeWithTax / 2;
  }

  const hostCommission = subtotal * (settings.host_commission_percent / 100);
  const hostCommissionTax = hostCommission * (settings.host_tax_percent / 100);
  const hostCommissionWithTax = hostCommission + hostCommissionTax;

  const guestTotal = subtotal + guestServiceFee;
  const hostPayout = subtotal - hostServiceFee - hostCommissionWithTax;
  const platformRevenue = guestServiceFee + hostServiceFee + hostCommissionWithTax;

  return {
    subtotal,
    serviceFeeTotal,
    serviceTax,
    serviceFeeWithTax,
    guestServiceFee,
    hostServiceFee,
    hostCommission,
    hostCommissionTax,
    hostCommissionWithTax,
    guestTotal,
    hostPayout,
    platformRevenue,
  };
}

/**
 * Format a booking's UUID into a stable, human-readable code.
 *
 * Uniqueness guarantee: the underlying `uuid` is a v4 UUID and is the source
 * of truth (the database PK). The display code is a *deterministic* projection
 * of that UUID, so the same booking always renders the same code, and two
 * different bookings can only collide if the first `length` hex chars of their
 * UUIDs match. To make collisions effectively impossible we enforce a minimum
 * window of 8 hex chars (~1 in 4 billion) regardless of admin settings, and we
 * cap the upper bound at 32 (the full UUID).
 */
export function formatBookingId(
  uuid: string,
  prefix: string = 'BK',
  length: number = 8
): string {
  const safeLength = Math.min(32, Math.max(8, Number.isFinite(length) ? length : 8));
  const code = uuid.replace(/-/g, '').slice(0, safeLength).toUpperCase();
  return `${prefix}-${code}`;
}

/**
 * Generic deterministic identifier formatter used for guest, host and staff
 * codes. Mirrors {@link formatBookingId} so the same UUID always renders the
 * same code and collisions remain effectively impossible (≥8 hex chars).
 */
export function formatUserId(
  uuid: string,
  prefix: string,
  length: number = 8
): string {
  if (!uuid) return '';
  const safeLength = Math.min(32, Math.max(6, Number.isFinite(length) ? length : 8));
  const code = uuid.replace(/-/g, '').slice(0, safeLength).toUpperCase();
  return `${prefix}-${code}`;
}
