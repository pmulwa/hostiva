import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

const HOST_MODE_KEY = 'hostly_mode';
const HOST_MODE_EVENT = 'hostly-mode-change';

/**
 * Reactive view of the persistent host-mode flag stored in localStorage.
 *
 * Plain `localStorage.getItem(...)` only reads once per render and never
 * notifies React when another component flips the flag. This hook subscribes
 * to:
 *   - the native `storage` event (cross-tab),
 *   - a custom `hostly-mode-change` event we dispatch from `setHostMode`
 *     (same-tab — `storage` does NOT fire in the tab that wrote the value).
 * Combined with `isHost` from auth, this is the single source of truth for
 * "is the viewer currently wearing the host hat?".
 */
export function useIsHostMode(): boolean {
  const { isHost } = useAuth();
  const [flag, setFlag] = useState<string | null>(() => {
    try { return localStorage.getItem(HOST_MODE_KEY); } catch { return null; }
  });

  useEffect(() => {
    const sync = () => {
      try { setFlag(localStorage.getItem(HOST_MODE_KEY)); } catch { /* ignore */ }
    };
    window.addEventListener('storage', sync);
    window.addEventListener(HOST_MODE_EVENT, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(HOST_MODE_EVENT, sync);
    };
  }, []);

  return isHost && flag === 'host';
}

/** Persist + broadcast the host-mode flag so every listener re-renders. */
export function setHostMode(next: 'host' | 'guest') {
  try {
    if (next === 'host') localStorage.setItem(HOST_MODE_KEY, 'host');
    else localStorage.removeItem(HOST_MODE_KEY);
  } catch { /* ignore quota */ }
  try { window.dispatchEvent(new Event(HOST_MODE_EVENT)); } catch { /* ignore */ }
}

/**
 * Persistent enforcement of the Host/Guest mode separation.
 *
 * - When `mode === 'guest-only'` and the user is currently in Hostly host mode,
 *   they are redirected to the host dashboard. Used on guest-only pages like
 *   /favorites and /search so an active host can't browse other listings
 *   while wearing the host hat.
 * - When `mode === 'host-only'` and the user is NOT a host, they are sent
 *   home. Used to protect /host/* routes from guest accounts.
 */
export function useHostModeGuard(mode: 'guest-only' | 'host-only') {
  const navigate = useNavigate();
  const { user, isHost } = useAuth();
  const inHostMode = useIsHostMode();

  useEffect(() => {
    if (mode === 'guest-only' && inHostMode) {
      navigate('/host/dashboard', { replace: true });
      return;
    }
    if (mode === 'host-only') {
      if (!user) {
        navigate('/auth', { replace: true });
        return;
      }
      if (!isHost) {
        navigate('/', { replace: true });
      }
    }
  }, [mode, user, isHost, inHostMode, navigate]);
}
