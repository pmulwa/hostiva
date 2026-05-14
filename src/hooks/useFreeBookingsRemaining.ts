import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePayoutTiers } from '@/hooks/usePayoutTiers';

/**
 * Tracks how many "first 3 free" (0% commission) bookings the current host
 * has remaining. Counts bookings with status 'confirmed' or 'completed'.
 * Updates in realtime via Supabase subscription on the bookings table.
 */
export function useFreeBookingsRemaining() {
  const { user, isHost } = useAuth();
  const { config } = usePayoutTiers();
  const [eligibleCount, setEligibleCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchCount = useCallback(async () => {
    if (!user || !isHost) {
      setEligibleCount(0);
      setLoading(false);
      return;
    }
    const { count } = await supabase
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('host_id', user.id)
      .in('status', ['confirmed', 'completed']);
    setEligibleCount(count || 0);
    setLoading(false);
  }, [user, isHost]);

  useEffect(() => {
    fetchCount();
    if (!user || !isHost) return;
    const channel = supabase
      .channel(`free-bookings-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `host_id=eq.${user.id}` },
        () => fetchCount()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, isHost, fetchCount]);

  const free = config.starter_free_bookings;
  const remaining = Math.max(0, free - eligibleCount);
  const isActive = isHost && eligibleCount < free;

  return { remaining, used: eligibleCount, total: free, isActive, loading, refetch: fetchCount };
}