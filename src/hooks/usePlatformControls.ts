import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Centralised reader for the toggle-style sections of `platform_controls`.
 * The matching admin UI lives at /admin/controls. Each section is a flat
 * `Record<string, boolean>` map persisted under its own row in the table.
 *
 * Defaults below mirror the seeded production rows so the platform is never
 * accidentally locked down if a row is briefly missing.
 */
export type ToggleMap = Record<string, boolean>;

export interface PlatformControlsSnapshot {
  guest_rights: ToggleMap;
  host_rights: ToggleMap;
  property_approvals: ToggleMap;
  notifications: ToggleMap;
  platform_settings: ToggleMap;
  security: ToggleMap;
}

const DEFAULTS: PlatformControlsSnapshot = {
  guest_rights: {
    allow_reviews: true,
    cancellation_window: true,
    messaging_before_booking: true,
    require_phone_verification: false,
  },
  host_rights: {
    instant_booking: true,
    cancellation_penalty: true,
    multiple_listings: true,
    respond_to_reviews: true,
  },
  property_approvals: {
    auto_approve_verified: false,
    require_id_verification: false,
  },
  notifications: {
    email_new_bookings: true,
    alert_cancellations: true,
  },
  platform_settings: {
    maintenance_mode: false,
    allow_registrations: true,
  },
  security: {
    force_email_verification: false,
    two_factor_auth: false,
  },
};

const SECTIONS = Object.keys(DEFAULTS) as (keyof PlatformControlsSnapshot)[];

let cache: PlatformControlsSnapshot | null = null;
let inflight: Promise<PlatformControlsSnapshot> | null = null;

async function fetchAll(): Promise<PlatformControlsSnapshot> {
  if (inflight) return inflight;
  inflight = (async () => {
    const { data } = await supabase
      .from('platform_controls' as any)
      .select('section, settings')
      .in('section', SECTIONS as unknown as string[]);
    const merged: PlatformControlsSnapshot = JSON.parse(JSON.stringify(DEFAULTS));
    if (data) {
      for (const row of (data as unknown as Array<{ section: string; settings: ToggleMap }>)) {
        const key = row.section as keyof PlatformControlsSnapshot;
        if (key in merged) {
          merged[key] = { ...merged[key], ...(row.settings || {}) };
        }
      }
    }
    cache = merged;
    inflight = null;
    return merged;
  })();
  return inflight;
}

export function usePlatformControls() {
  const [controls, setControls] = useState<PlatformControlsSnapshot>(cache ?? DEFAULTS);
  const [loading, setLoading] = useState(!cache);

  const refresh = useCallback(async () => {
    cache = null;
    const next = await fetchAll();
    setControls(next);
  }, []);

  useEffect(() => {
    let mounted = true;
    fetchAll().then((next) => {
      if (mounted) {
        setControls(next);
        setLoading(false);
      }
    });
    return () => { mounted = false; };
  }, []);

  return { controls, loading, refresh };
}

/** Direct, non-hook accessor for one-shot checks (e.g. in handlers). */
export async function getPlatformControls(): Promise<PlatformControlsSnapshot> {
  return cache ?? fetchAll();
}