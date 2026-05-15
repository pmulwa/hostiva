import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type PlatformBranding = {
  platform_name: string;
  support_email: string;
  support_phone: string;
};

export const DEFAULT_BRANDING: PlatformBranding = {
  platform_name: 'Hostiva',
  support_email: 'support@host-iva.com',
  support_phone: '+254792895225',
};

let cached: PlatformBranding | null = null;
const listeners = new Set<(b: PlatformBranding) => void>();

export async function fetchPlatformBranding(): Promise<PlatformBranding> {
  const { data } = await supabase
    .from('platform_settings')
    .select('platform_name, support_email, support_phone')
    .limit(1)
    .maybeSingle();
  const next: PlatformBranding = {
    platform_name: (data as any)?.platform_name || DEFAULT_BRANDING.platform_name,
    support_email: (data as any)?.support_email || DEFAULT_BRANDING.support_email,
    support_phone: (data as any)?.support_phone || DEFAULT_BRANDING.support_phone,
  };
  cached = next;
  listeners.forEach((l) => l(next));
  return next;
}

export function setPlatformBrandingCache(b: PlatformBranding) {
  cached = b;
  listeners.forEach((l) => l(b));
}

export function usePlatformBranding(): PlatformBranding {
  const [branding, setBranding] = useState<PlatformBranding>(cached ?? DEFAULT_BRANDING);
  useEffect(() => {
    listeners.add(setBranding);
    if (!cached) fetchPlatformBranding().catch(() => {});
    return () => {
      listeners.delete(setBranding);
    };
  }, []);
  return branding;
}

/** E.164-ish digits (with leading +) for tel: and WhatsApp links. */
export function phoneToE164(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return '+' + digits.slice(1).replace(/\D/g, '');
  return '+' + digits.replace(/\D/g, '');
}