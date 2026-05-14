/**
 * Generates a stable, increasing per-host short identifier (L_001, L_002, …)
 * based on the order each property was listed (created_at ascending).
 *
 * Used for admin UI display and for the Settings → Property Management list,
 * where hosts need a quick reference number that does not depend on the UUID.
 */
export type PropertyForIdentifier = {
  id: string;
  host_id: string;
  created_at: string;
};

const PROPERTY_ID_FORMAT_KEY = 'admin_property_id_format';

export type PropertyIdFormat = {
  prefix: string;
  length: number;
};

const DEFAULT_FORMAT: PropertyIdFormat = { prefix: 'L', length: 3 };

export function getPropertyIdFormat(): PropertyIdFormat {
  if (typeof window === 'undefined') return DEFAULT_FORMAT;
  try {
    const raw = window.localStorage.getItem(PROPERTY_ID_FORMAT_KEY);
    if (!raw) return DEFAULT_FORMAT;
    const parsed = JSON.parse(raw);
    return {
      prefix: typeof parsed.prefix === 'string' && parsed.prefix ? parsed.prefix : DEFAULT_FORMAT.prefix,
      length: Number.isFinite(parsed.length) ? Math.max(2, Math.min(8, Number(parsed.length))) : DEFAULT_FORMAT.length,
    };
  } catch {
    return DEFAULT_FORMAT;
  }
}

export function setPropertyIdFormat(fmt: PropertyIdFormat) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PROPERTY_ID_FORMAT_KEY, JSON.stringify(fmt));
}

export function buildPropertyIdentifierMap<T extends PropertyForIdentifier>(
  properties: T[],
): Map<string, string> {
  const byHost = new Map<string, T[]>();
  for (const p of properties) {
    const list = byHost.get(p.host_id) ?? [];
    list.push(p);
    byHost.set(p.host_id, list);
  }
  const { prefix, length } = getPropertyIdFormat();
  const map = new Map<string, string>();
  for (const [, list] of byHost) {
    list
      .slice()
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .forEach((p, idx) => {
        map.set(p.id, `${prefix}_${String(idx + 1).padStart(length, '0')}`);
      });
  }
  return map;
}

export function formatPropertyShortId(index: number, fmt?: PropertyIdFormat): string {
  const { prefix, length } = fmt ?? getPropertyIdFormat();
  return `${prefix}_${String(index + 1).padStart(length, '0')}`;
}