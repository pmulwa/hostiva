import { useEffect, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { ShieldAlert, Clock, CheckCircle2, XCircle, ArrowUpRight, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { logAdminAction } from '@/lib/audit';
import { formatDistanceToNow } from 'date-fns';

type Status = 'pending' | 'in_review' | 'approved' | 'rejected' | 'escalated';

interface QueueItem {
  id: string;
  entity_type: string;
  entity_id: string;
  reason: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: Status;
  context: Record<string, unknown>;
  resolution_notes: string | null;
  sla_due_at: string | null;
  created_at: string;
}

const SEVERITY_STYLES: Record<string, string> = {
  low: 'bg-blue-500/10 text-blue-700 border-blue-500/20',
  medium: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
  high: 'bg-orange-500/10 text-orange-700 border-orange-500/20',
  critical: 'bg-red-500/10 text-red-700 border-red-500/20',
};

export default function AdminReviewQueue() {
  const { toast } = useToast();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Status | 'all'>('pending');
  const [active, setActive] = useState<QueueItem | null>(null);
  const [notes, setNotes] = useState('');

  const fetchItems = async () => {
    setLoading(true);
    let q = supabase.from('manual_review_queue' as any).select('*').order('created_at', { ascending: false }).limit(100);
    if (filter !== 'all') q = q.eq('status', filter);
    const { data } = await q;
    setItems((data ?? []) as unknown as QueueItem[]);
    setLoading(false);
  };

  useEffect(() => { fetchItems(); }, [filter]);

  const resolve = async (status: Status) => {
    if (!active) return;
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('manual_review_queue' as any).update({
      status,
      resolution_notes: notes || null,
      resolved_at: new Date().toISOString(),
      resolved_by: user?.id,
    }).eq('id', active.id);
    await logAdminAction('REVIEW_QUEUE_RESOLVE', 'manual_review_queue', active.id, { status, notes });
    toast({ title: 'Resolved', description: `Marked as ${status.replace('_', ' ')}.` });
    setActive(null); setNotes('');
    fetchItems();
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-display font-bold flex items-center gap-2">
            <ShieldAlert className="w-7 h-7 text-primary" /> Manual Review Queue
          </h1>
          <p className="text-muted-foreground mt-1">High-risk bookings, sanctions matches, listing flags, and escalated reports.</p>
        </div>

        <Tabs value={filter} onValueChange={(v) => setFilter(v as Status | 'all')}>
          <TabsList>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="in_review">In Review</TabsTrigger>
            <TabsTrigger value="escalated">Escalated</TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>

        {loading && <div className="text-center text-muted-foreground py-12">Loading…</div>}
        {!loading && items.length === 0 && (
          <Card><CardContent className="py-12 text-center text-muted-foreground"><CheckCircle2 className="w-12 h-12 mx-auto mb-2 text-green-500/50" />Nothing in this queue.</CardContent></Card>
        )}

        <div className="grid gap-3">
          {items.map((it) => (
            <Card key={it.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => { setActive(it); setNotes(it.resolution_notes ?? ''); }}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge variant="outline" className={SEVERITY_STYLES[it.severity]}>{it.severity}</Badge>
                      <Badge variant="secondary">{it.entity_type}</Badge>
                      <Badge variant="outline">{it.status.replace('_', ' ')}</Badge>
                      {it.sla_due_at && new Date(it.sla_due_at) < new Date() && (
                        <Badge variant="destructive" className="gap-1"><AlertTriangle className="w-3 h-3" /> SLA breached</Badge>
                      )}
                    </div>
                    <p className="text-sm font-medium truncate">{it.reason}</p>
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {formatDistanceToNow(new Date(it.created_at), { addSuffix: true })}
                    </p>
                  </div>
                  <ArrowUpRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Review item</DialogTitle>
              <DialogDescription>{active?.reason}</DialogDescription>
            </DialogHeader>
            {active && (
              <div className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">Entity:</span> <span className="font-mono">{active.entity_type}</span></div>
                  <div><span className="text-muted-foreground">ID:</span> <span className="font-mono text-xs">{active.entity_id}</span></div>
                  <div><span className="text-muted-foreground">Severity:</span> <Badge variant="outline" className={SEVERITY_STYLES[active.severity]}>{active.severity}</Badge></div>
                  <div><span className="text-muted-foreground">Status:</span> <Badge variant="outline">{active.status}</Badge></div>
                </div>
                {Object.keys(active.context).length > 0 && (
                  <div className="rounded-lg border p-3 bg-muted/30">
                    <p className="text-xs font-semibold mb-2">Context</p>
                    <pre className="text-xs overflow-x-auto">{JSON.stringify(active.context, null, 2)}</pre>
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Resolution notes</label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Briefly describe your decision…" />
                </div>
              </div>
            )}
            <DialogFooter className="gap-2 flex-wrap">
              <Button variant="outline" onClick={() => resolve('escalated')} className="gap-1.5"><ArrowUpRight className="w-4 h-4" />Escalate</Button>
              <Button variant="destructive" onClick={() => resolve('rejected')} className="gap-1.5"><XCircle className="w-4 h-4" />Reject</Button>
              <Button onClick={() => resolve('approved')} className="gap-1.5"><CheckCircle2 className="w-4 h-4" />Approve</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}