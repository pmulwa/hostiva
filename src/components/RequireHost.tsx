import { ReactNode, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Route guard for /host/* pages. Ensures the current viewer is signed in
 * AND has the 'host' role. Guests who somehow land on a host URL are
 * redirected home; signed-out viewers are sent to the auth page.
 *
 * This pairs with the host-mode toggle: a host who is in guest (Travelling)
 * mode can still navigate to host pages — the toggle is a *browsing*
 * preference, not a permission. The role check lives in the database via
 * `has_role(user_id, 'host')` and is mirrored here for UX so non-hosts
 * never see host-only screens flicker.
 */
export function RequireHost({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { user, isHost, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      navigate('/auth', { replace: true });
      return;
    }
    if (!isHost) {
      navigate('/', { replace: true });
    }
  }, [user, isHost, isLoading, navigate]);

  if (isLoading) return null;
  if (!user || !isHost) return null;
  return <>{children}</>;
}
