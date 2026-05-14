import { useEffect, useState } from 'react';

export type ViewMode = 'grid' | 'list' | 'card' | 'row';

const STORAGE_KEY = 'hostly_view_mode';

function readStored(): Partial<Record<string, ViewMode>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Persist the user's preferred view mode (grid / list / card / row) per scope.
 * Scope lets different pages keep separate preferences (e.g. "search", "favorites", "host_properties").
 */
export function useViewMode<T extends ViewMode>(
  scope: string,
  defaultMode: T,
  allowed: readonly T[],
): [T, (m: T) => void] {
  const [mode, setMode] = useState<T>(() => {
    const stored = readStored()[scope];
    return stored && (allowed as readonly string[]).includes(stored) ? (stored as T) : defaultMode;
  });

  useEffect(() => {
    const all = readStored();
    all[scope] = mode;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch { /* ignore quota errors */ }
  }, [scope, mode]);

  return [mode, setMode];
}
