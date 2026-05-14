import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { ScrollText, UserCheck, Home, Calendar, Star, Shield, Settings } from 'lucide-react';

const entityIcons: Record<string, any> = {
  user: UserCheck,
  property: Home,
  booking: Calendar,
  review: Star,
  system: Settings,
};

const actionColors: Record<string, string> = {
  approve: 'bg-green-500/10 text-green-500 border-green-500/30',
  reject: 'bg-destructive/10 text-destructive border-destructive/30',
  verify: 'bg-green-500/10 text-green-500 border-green-500/30',
  unverify: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  promote: 'bg-primary/10 text-primary border-primary/30',
  demote: 'bg-muted text-muted-foreground border-border',
  confirm: 'bg-green-500/10 text-green-500 border-green-500/30',
  cancel: 'bg-destructive/10 text-destructive border-destructive/30',
  complete: 'bg-primary/10 text-primary border-primary/30',
  toggle_visibility: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  deactivate: 'bg-muted text-muted-foreground border-border',
  reactivate: 'bg-green-500/10 text-green-500 border-green-500/30',
};

export default function AdminAuditLog() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const [logsRes, profilesRes] = await Promise.all([
        supabase.from('audit_logs' as any).select('*').order('created_at', { ascending: false }).limit(100),
        supabase.from('profiles').select('user_id, full_name, email'),
      ]);
      if (logsRes.data) setLogs(logsRes.data as any[]);
      if (profilesRes.data) {
        const map: Record<string, string> = {};
        profilesRes.data.forEach((p: any) => { map[p.user_id] = p.full_name || p.email; });
        setProfiles(map);
      }
      setIsLoading(false);
    };
    fetchData();
  }, []);

  if (isLoading) return <AdminLayout><div className="animate-pulse h-64 bg-muted rounded-xl" /></AdminLayout>;

  return (
    <AdminLayout>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <ScrollText className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="font-display text-3xl font-bold">Audit Log</h1>
          <p className="text-muted-foreground text-sm">Track all admin actions on the platform</p>
        </div>
      </div>

      <Card className="card-luxury">
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Admin</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log: any) => {
                const Icon = entityIcons[log.entity_type] || Shield;
                const colorClass = actionColors[log.action] || 'bg-muted text-muted-foreground border-border';
                return (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {format(new Date(log.created_at), 'MMM d, HH:mm')}
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {profiles[log.admin_id] || log.admin_id?.slice(0, 8)}
                    </TableCell>
                    <TableCell>
                      <Badge className={colorClass}>{log.action.replace('_', ' ')}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-sm capitalize">{log.entity_type}</span>
                        {log.entity_id && <span className="text-xs text-muted-foreground font-mono">#{log.entity_id.slice(0, 8)}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                      {log.details && Object.keys(log.details).length > 0
                        ? Object.entries(log.details).map(([k, v]) => `${k}: ${v}`).join(', ')
                        : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {logs.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">No audit logs yet. Admin actions will appear here.</div>
          )}
        </CardContent>
      </Card>
    </AdminLayout>
  );
}
