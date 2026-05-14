import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { logAdminAction } from '@/lib/audit';
import { Search, AlertTriangle, ShieldOff, Eye, MessageSquareWarning } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

type FlaggedUser = {
  user_id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  is_suspended: boolean | null;
  flagged_count: number;
  latest_flag_at: string;
  recent_messages: Array<{
    id: string;
    content: string;
    created_at: string;
    receiver_id: string;
    booking_id: string | null;
  }>;
};

export default function AdminModerationQueue() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState<FlaggedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [selectedUser, setSelectedUser] = useState<FlaggedUser | null>(null);

  const load = async () => {
    setLoading(true);
    // Pull all flagged_contact messages, group by sender
    const { data: flagged } = await supabase
      .from('messages')
      .select('id, sender_id, receiver_id, content, created_at, booking_id')
      .eq('message_type', 'flagged_contact')
      .order('created_at', { ascending: false })
      .limit(2000);

    const bySender = new Map<string, FlaggedUser['recent_messages']>();
    (flagged || []).forEach((m: any) => {
      if (!bySender.has(m.sender_id)) bySender.set(m.sender_id, []);
      bySender.get(m.sender_id)!.push({
        id: m.id, content: m.content, created_at: m.created_at,
        receiver_id: m.receiver_id, booking_id: m.booking_id,
      });
    });

    // Only surface users with 3+ violations
    const offenderIds = Array.from(bySender.entries())
      .filter(([_, msgs]) => msgs.length >= 3)
      .map(([id]) => id);

    if (offenderIds.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }

    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, full_name, email, avatar_url, is_suspended')
      .in('user_id', offenderIds);

    const enriched: FlaggedUser[] = (profiles || []).map((p: any) => {
      const msgs = bySender.get(p.user_id) || [];
      return {
        ...p,
        flagged_count: msgs.length,
        latest_flag_at: msgs[0]?.created_at || new Date().toISOString(),
        recent_messages: msgs.slice(0, 10),
      };
    });
    enriched.sort((a, b) => b.flagged_count - a.flagged_count);
    setRows(enriched);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let list = rows;
    if (filter === 'active') list = list.filter((r) => !r.is_suspended);
    if (filter === 'suspended') list = list.filter((r) => !!r.is_suspended);
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      list = list.filter((r) =>
        r.email.toLowerCase().includes(s) || (r.full_name || '').toLowerCase().includes(s)
      );
    }
    return list;
  }, [rows, filter, search]);

  const stats = useMemo(() => ({
    total: rows.length,
    active: rows.filter((r) => !r.is_suspended).length,
    suspended: rows.filter((r) => !!r.is_suspended).length,
    totalFlags: rows.reduce((s, r) => s + r.flagged_count, 0),
  }), [rows]);

  const suspendUser = async (user: FlaggedUser) => {
    if (!confirm(`Suspend ${user.full_name || user.email}? They will lose access to the platform until reinstated.`)) return;
    const { error } = await supabase
      .from('profiles')
      .update({
        is_suspended: true,
        suspended_at: new Date().toISOString(),
        suspended_reason: `Repeated contact-info sharing violations (${user.flagged_count} flagged messages)`,
      })
      .eq('user_id', user.user_id);
    if (error) {
      toast({ title: 'Failed to suspend', description: error.message, variant: 'destructive' });
      return;
    }
    await logAdminAction('user_suspended', 'user', user.user_id, {
      reason: 'repeated_policy_violations',
      flagged_count: user.flagged_count,
    });
    toast({ title: 'User suspended', description: `${user.full_name || user.email} has been suspended.` });
    load();
  };

  return (
    <AdminLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <MessageSquareWarning className="w-6 h-6 text-destructive" />
            Moderation Queue
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Users who have sent 3 or more flagged messages attempting to share contact details off-platform.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Repeat Offenders" value={stats.total} accent="warning" />
          <StatCard label="Active (not suspended)" value={stats.active} />
          <StatCard label="Suspended" value={stats.suspended} accent="success" />
          <StatCard label="Total Flagged Messages" value={stats.totalFlags} />
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email…"
              className="pl-9"
            />
          </div>
          <div className="flex gap-2">
            {(['all', 'active', 'suspended'] as const).map((f) => (
              <Button
                key={f}
                variant={filter === f ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter(f)}
                className="capitalize"
              >
                {f}
              </Button>
            ))}
          </div>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-12 text-center text-sm text-muted-foreground">Loading moderation queue…</div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground">
                No users currently meet the violation threshold. 🎉
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="text-center">Flagged Messages</TableHead>
                    <TableHead>Latest Violation</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.user_id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="w-9 h-9">
                            <AvatarImage src={r.avatar_url || ''} />
                            <AvatarFallback className="bg-destructive/10 text-destructive font-bold text-xs">
                              {(r.full_name || r.email)?.[0]?.toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <p className="font-medium text-sm">{r.full_name || '—'}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.email}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          {r.flagged_count}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(r.latest_flag_at), { addSuffix: true })}
                      </TableCell>
                      <TableCell>
                        {r.is_suspended ? (
                          <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive">
                            Suspended
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">Active</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedUser(r)}
                            className="gap-1.5 h-8"
                          >
                            <Eye className="w-3.5 h-3.5" /> Review
                          </Button>
                          {!r.is_suspended && (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => suspendUser(r)}
                              className="gap-1.5 h-8"
                            >
                              <ShieldOff className="w-3.5 h-3.5" /> Suspend
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Review Dialog */}
      <Dialog open={!!selectedUser} onOpenChange={(o) => !o && setSelectedUser(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Flagged messages from {selectedUser?.full_name || selectedUser?.email}
            </DialogTitle>
            <DialogDescription>
              The following messages were automatically hidden from recipients because they contained contact details.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 mt-2">
            {selectedUser?.recent_messages.map((m) => (
              <div key={m.id} className="p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    {format(new Date(m.created_at), 'MMM d, yyyy · HH:mm')}
                  </span>
                  {m.booking_id && (
                    <Badge variant="outline" className="text-[9px] font-mono">
                      Booking: {m.booking_id.slice(0, 8)}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-foreground whitespace-pre-wrap break-words">{m.content}</p>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button
              variant="outline"
              onClick={() => {
                if (selectedUser) navigate(`/user/${selectedUser.user_id}`);
              }}
            >
              View Profile
            </Button>
            {selectedUser && !selectedUser.is_suspended && (
              <Button
                variant="destructive"
                onClick={() => {
                  suspendUser(selectedUser);
                  setSelectedUser(null);
                }}
                className="gap-1.5"
              >
                <ShieldOff className="w-4 h-4" /> Suspend User
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

function StatCard({
  label, value, accent,
}: { label: string; value: string | number; accent?: 'success' | 'warning' }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
        <p
          className={`font-display text-2xl font-bold mt-1 ${
            accent === 'warning' ? 'text-destructive' : accent === 'success' ? 'text-green-600' : 'text-foreground'
          }`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
