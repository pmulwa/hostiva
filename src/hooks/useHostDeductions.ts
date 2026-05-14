import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface HostDeduction {
  id: string;
  amount: number;
  currency: string;
  reason_code: string;
  reason_detail: string | null;
  status: 'pending' | 'settled' | 'waived';
  booking_id: string | null;
  created_at: string;
}

/**
 * Tracks pending deductions owed by the host (e.g. cancellation fines).
 * The total `pending` is automatically deducted from the host's next payout.
 */
export function useHostDeductions() {
  const { user, isHost } = useAuth();
  const [pending, setPending] = useState<HostDeduction[]>([]);
  const [history, setHistory] = useState<HostDeduction[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDeductions = useCallback(async () => {
    if (!user || !isHost) {
      setPending([]); setHistory([]); setLoading(false); return;
    }
    const { data } = await supabase
      .from('host_deductions' as any)
      .select('id, amount, currency, reason_code, reason_detail, status, booking_id, created_at')
      .eq('host_id', user.id)
      .order('created_at', { ascending: false });
    const rows = ((data as any) || []) as HostDeduction[];
    setPending(rows.filter(r => r.status === 'pending'));
    setHistory(rows.filter(r => r.status !== 'pending'));
    setLoading(false);
  }, [user, isHost]);

  useEffect(() => {
    fetchDeductions();
    if (!user || !isHost) return;
    const channel = supabase
      .channel(`host-deductions-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'host_deductions', filter: `host_id=eq.${user.id}` },
        () => fetchDeductions(),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, isHost, fetchDeductions]);

  const totalPending = pending.reduce((s, d) => s + Number(d.amount || 0), 0);

  return { pending, history, totalPending, loading, refetch: fetchDeductions };
}