import { useEffect, useState, useCallback } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'hostly:theme';

/**
 * Theme is intentionally PER-DEVICE (per-browser): we only read/write
 * `localStorage`. We never sync the choice to the server, so changing the
 * theme on one device never affects another device — even for the same
 * signed-in user — and never leaks across different users sharing a
 * browser profile.
 *
 * Default (when nothing has been chosen on this device) is `light` ("day").
 */

/** Read the saved theme synchronously (used at boot + as initial state). */
export function readStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'light';
}

/** Apply a theme mode to <html> by toggling the `dark` class. */
export function applyTheme(mode: ThemeMode) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const prefersDark =
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const shouldBeDark = mode === 'dark' || (mode === 'system' && prefersDark);
  root.classList.toggle('dark', shouldBeDark);
  root.style.colorScheme = shouldBeDark ? 'dark' : 'light';
}

/**
 * Global theme hook — single source of truth, PER-DEVICE.
 *
 * • Reads from localStorage on init so first paint matches the device choice.
 * • Default (no choice yet) is `light` — "day" mode.
 * • Persists every change to localStorage on this device only.
 * • Reacts to OS preference changes when in "system" mode.
 * • Listens to `storage` events so other tabs in the same browser stay in
 *   sync, but never syncs across devices, accounts, or sessions.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() => readStoredTheme());

  // Apply on every change.
  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {}
  }, [theme]);

  // Sync between tabs of the same browser (per-device only).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = e.newValue;
      if (next === 'light' || next === 'dark' || next === 'system') {
        setThemeState(next);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Listen for OS-level changes when in "system" mode.
  useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mql.addEventListener?.('change', handler);
    return () => mql.removeEventListener?.('change', handler);
  }, [theme]);

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
  }, []);

  return { theme, setTheme };
}