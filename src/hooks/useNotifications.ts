import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface NotificationItem {
  id: string;
  event_type: string;
  channel: string;
  subject: string | null;
  body: string;
  is_read: boolean;
  created_at: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
}

export function useNotifications() {
  const { user } = useAuth();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    if (!user) { setItems([]); setUnreadCount(0); setLoading(false); return; }
    const { data } = await supabase
      .from('notification_log' as any)
      .select('id,event_type,channel,subject,body,is_read,created_at,related_entity_type,related_entity_id')
      .eq('user_id', user.id)
      .eq('channel', 'in_app')
      .order('created_at', { ascending: false })
      .limit(50);
    const list = (data ?? []) as unknown as NotificationItem[];
    setItems(list);
    setUnreadCount(list.filter((n) => !n.is_read).length);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchNotifications();
    if (!user) return;
    const channel = supabase
      .channel('notif-' + user.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notification_log', filter: `user_id=eq.${user.id}` }, fetchNotifications)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, fetchNotifications]);

  const markRead = async (id: string) => {
    await supabase.from('notification_log' as any).update({ is_read: true, read_at: new Date().toISOString() }).eq('id', id);
    fetchNotifications();
  };

  const markAllRead = async () => {
    if (!user) return;
    await supabase.from('notification_log' as any).update({ is_read: true, read_at: new Date().toISOString() }).eq('user_id', user.id).eq('is_read', false);
    fetchNotifications();
  };

  return { items, unreadCount, loading, markRead, markAllRead, refetch: fetchNotifications };
}