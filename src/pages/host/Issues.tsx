import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format, formatDistanceToNow } from 'date-fns';
import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  LifeBuoy,
  Reply,
  Send,
  ShieldAlert,
  Sparkles,
  Wrench,
  ThermometerSun,
  Wifi,
  KeyRound,
  HelpCircle,
  Filter,
} from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';

type Issue = Database['public']['Tables']['booking_issues']['Row'];
type Profile = Database['public']['Tables']['profiles']['Row'];

type IssueWithMeta = Issue & {
  guest?: Pick<Profile, 'full_name' | 'avatar_url' | 'email'> | null;
  property_title?: string | null;
};

const SEVERITY_ORDER = ['emergency', 'high', 'medium', 'low'] as const;
type Severity = (typeof SEVERITY_ORDER)[number];

const SEVERITY_META: Record<Severity, { label: string; badge: string; ring: string; icon: typeof AlertTriangle }> = {
  emergency: {
    label: 'Emergency',
    badge: 'bg-destructive text-destructive-foreground',
    ring: 'border-destructive/40 bg-destructive/5',
    icon: AlertTriangle,
  },
  high: {
    label: 'High',
    badge: 'bg-orange-500 text-white',
    ring: 'border-orange-500/30 bg-orange-500/5',
    icon: ShieldAlert,
  },
  medium: {
    label: 'Medium',
    badge: 'bg-yellow-500 text-white',
    ring: 'border-yellow-500/30 bg-yellow-500/5',
    icon: Wrench,
  },
  low: {
    label: 'Low',
    badge: 'bg-muted text-muted-foreground',
    ring: 'border-border bg-muted/30',
    icon: HelpCircle,
  },
};

const CATEGORY_ICON: Record<string, typeof Wrench> = {
  safety: ShieldAlert,
  cleanliness: Sparkles,
  maintenance: Wrench,
  utilities: ThermometerSun,
  wifi: Wifi,
  access: KeyRound,
  other: HelpCircle,
};

const STATUS_FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'all', label: 'All' },
  { value: 'resolved', label: 'Resolved' },
] as const;

export default function HostIssues() {
  const { user, isHost } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [issues, setIssues] = useState<IssueWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]['value']>('open');

  const [replyTarget, setReplyTarget] = useState<IssueWithMeta | null>(null);
  const [replyText, setReplyText] = useState('');
  const [busy, setBusy] = useState(false);

  const [resolveTarget, setResolveTarget] = useState<IssueWithMeta | null>(null);
  const [escalateTarget, setEscalateTarget] = useState<IssueWithMeta | null>(null);
  const [escalateNote, setEscalateNote] = useState('');

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    if (!isHost) {
      navigate('/become-host');
      return;
    }
    import('@/hooks/useHostModeGuard').then(m => m.setHostMode('host'));
    fetchIssues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isHost]);

  const fetchIssues = async () => {
    if (!user) return;
    setLoading(true);

    const { data: rows, error } = await supabase
      .from('booking_issues')
      .select('*')
      .eq('host_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      toast({ title: 'Could not load issues', description: error.message, variant: 'destructive' });
      setLoading(false);
      return;
    }

    const list = (rows ?? []) as Issue[];
    const guestIds = Array.from(new Set(list.map((r) => r.guest_id)));
    const propertyIds = Array.from(new Set(list.map((r) => r.property_id)));

    const [guestsRes, propsRes] = await Promise.all([
      guestIds.length
        ? supabase.from('profiles').select('user_id, full_name, avatar_url, email').in('user_id', guestIds)
        : Promise.resolve({ data: [] as any[] }),
      propertyIds.length
        ? supabase.from('properties').select('id, title').in('id', propertyIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const guestMap = new Map<string, any>((guestsRes.data ?? []).map((g: any) => [g.user_id, g]));
    const propMap = new Map<string, string>((propsRes.data ?? []).map((p: any) => [p.id, p.title]));

    setIssues(
      list.map((r) => ({
        ...r,
        guest: guestMap.get(r.guest_id) ?? null,
        property_title: propMap.get(r.property_id) ?? null,
      })),
    );
    setLoading(false);
  };

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return issues;
    if (statusFilter === 'open') return issues.filter((i) => i.status !== 'resolved');
    return issues.filter((i) => i.status === 'resolved');
  }, [issues, statusFilter]);

  const grouped = useMemo(() => {
    const map = new Map<Severity, IssueWithMeta[]>();
    SEVERITY_ORDER.forEach((s) => map.set(s, []));
    filtered.forEach((i) => {
      const sev = (SEVERITY_ORDER as readonly string[]).includes(i.severity)
        ? (i.severity as Severity)
        : 'medium';
      map.get(sev)!.push(i);
    });
    return map;
  }, [filtered]);

  const counts = useMemo(() => {
    const c: Record<Severity, number> = { emergency: 0, high: 0, medium: 0, low: 0 };
    issues
      .filter((i) => i.status !== 'resolved')
      .forEach((i) => {
        if ((SEVERITY_ORDER as readonly string[]).includes(i.severity)) {
          c[i.severity as Severity]++;
        }
      });
    return c;
  }, [issues]);

  const submitReply = async () => {
    if (!replyTarget || !user) return;
    if (replyText.trim().length < 3) {
      toast({ title: 'Reply too short', description: 'Write at least a few words.', variant: 'destructive' });
      return;
    }
    setBusy(true);

    const { error: upErr } = await supabase
      .from('booking_issues')
      .update({ host_response: replyText.trim(), status: 'in_progress', updated_at: new Date().toISOString() })
      .eq('id', replyTarget.id);

    if (upErr) {
      toast({ title: 'Could not save reply', description: upErr.message, variant: 'destructive' });
      setBusy(false);
      return;
    }

    await supabase.from('messages').insert({
      booking_id: replyTarget.booking_id,
      sender_id: user.id,
      receiver_id: replyTarget.guest_id,
      content: `🛠️ Host reply on reported issue:\n\n${replyText.trim()}`,
      message_type: 'system',
    });

    toast({ title: 'Reply sent', description: 'Your guest has been notified.' });
    setReplyText('');
    setReplyTarget(null);
    setBusy(false);
    fetchIssues();
  };

  const markResolved = async () => {
    if (!resolveTarget || !user) return;
    setBusy(true);
    const { error } = await supabase
      .from('booking_issues')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .eq('id', resolveTarget.id);

    if (error) {
      toast({ title: 'Could not resolve', description: error.message, variant: 'destructive' });
      setBusy(false);
      return;
    }

    await supabase.from('messages').insert({
      booking_id: resolveTarget.booking_id,
      sender_id: user.id,
      receiver_id: resolveTarget.guest_id,
      content: `✅ Your host has marked the reported issue as resolved. If anything is still not right, please reply here.`,
      message_type: 'system',
    });

    toast({ title: 'Marked as resolved' });
    setResolveTarget(null);
    setBusy(false);
    fetchIssues();
  };

  const submitEscalation = async () => {
    if (!escalateTarget || !user) return;
    setBusy(true);

    const note = escalateNote.trim();
    const { error } = await supabase
      .from('booking_issues')
      .update({
        status: 'escalated',
        host_response: note
          ? `${escalateTarget.host_response ? escalateTarget.host_response + '\n\n' : ''}[Escalated to Hostiva] ${note}`
          : escalateTarget.host_response,
        updated_at: new Date().toISOString(),
      })
      .eq('id', escalateTarget.id);

    if (error) {
      toast({ title: 'Could not escalate', description: error.message, variant: 'destructive' });
      setBusy(false);
      return;
    }

    // Notify guest in the booking thread that the host has escalated to Hostiva support.
    await supabase.from('messages').insert({
      booking_id: escalateTarget.booking_id,
      sender_id: user.id,
      receiver_id: escalateTarget.guest_id,
      content: `🚀 Your host has escalated this issue to Hostiva Support. A team member will reach out shortly.${note ? `\n\nNote from host: ${note}` : ''}`,
      message_type: 'system',
    });

    toast({
      title: 'Escalated to Hostiva Support',
      description: 'Our team has been notified and will follow up directly.',
    });
    setEscalateNote('');
    setEscalateTarget(null);
    setBusy(false);
    fetchIssues();
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Inbox className="w-7 h-7 text-primary" /> Issues Inbox
            </h1>
            <p className="text-muted-foreground mt-1">
              Reported by guests on your bookings. Emergencies appear first.
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-border p-1 bg-card">
            <Filter className="w-4 h-4 text-muted-foreground ml-2" />
            {STATUS_FILTERS.map((f) => (
              <Button
                key={f.value}
                size="sm"
                variant={statusFilter === f.value ? 'default' : 'ghost'}
                onClick={() => setStatusFilter(f.value)}
              >
                {f.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Severity counters */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {SEVERITY_ORDER.map((sev) => {
            const meta = SEVERITY_META[sev];
            const Icon = meta.icon;
            return (
              <Card key={sev} className={meta.ring}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="w-5 h-5" />
                    <span className="font-medium">{meta.label}</span>
                  </div>
                  <span className="text-2xl font-bold">{counts[sev]}</span>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Loading */}
        {loading ? (
          <div className="text-center py-16 text-muted-foreground">Loading issues…</div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
              <h3 className="text-lg font-semibold">All clear</h3>
              <p className="text-muted-foreground">No {statusFilter === 'all' ? '' : statusFilter} issues right now.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-10">
            {SEVERITY_ORDER.map((sev) => {
              const list = grouped.get(sev) ?? [];
              if (list.length === 0) return null;
              const meta = SEVERITY_META[sev];
              return (
                <section key={sev}>
                  <div className="flex items-center gap-2 mb-3">
                    <Badge className={meta.badge}>{meta.label}</Badge>
                    <span className="text-sm text-muted-foreground">
                      {list.length} {list.length === 1 ? 'issue' : 'issues'}
                    </span>
                  </div>

                  <div className="space-y-3">
                    {list.map((issue) => {
                      const CatIcon = CATEGORY_ICON[issue.category] ?? HelpCircle;
                      const guestName = issue.guest?.full_name || issue.guest?.email || 'Guest';
                      const isResolved = issue.status === 'resolved';
                      const isEscalated = issue.status === 'escalated';
                      return (
                        <Card key={issue.id} className={`${meta.ring} border`}>
                          <CardContent className="p-5">
                            <div className="flex flex-col lg:flex-row gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2 mb-1">
                                  <CatIcon className="w-4 h-4 text-muted-foreground" />
                                  <span className="font-medium capitalize">{issue.category}</span>
                                  <span className="text-muted-foreground">·</span>
                                  <span className="text-sm text-muted-foreground">
                                    {guestName}
                                    {issue.property_title ? ` · ${issue.property_title}` : ''}
                                  </span>
                                  {isResolved && (
                                    <Badge variant="outline" className="border-green-500/40 text-green-600">
                                      Resolved
                                    </Badge>
                                  )}
                                  {isEscalated && (
                                    <Badge variant="outline" className="border-primary/40 text-primary">
                                      Escalated to Hostiva
                                    </Badge>
                                  )}
                                  {!isResolved && !isEscalated && issue.status === 'in_progress' && (
                                    <Badge variant="outline">In progress</Badge>
                                  )}
                                </div>

                                <p className="text-sm whitespace-pre-wrap mb-3">{issue.description}</p>

                                {issue.host_response && (
                                  <div className="rounded-md bg-background/60 border border-border p-3 text-sm mb-3">
                                    <div className="text-xs font-medium text-muted-foreground mb-1">Your reply</div>
                                    <div className="whitespace-pre-wrap">{issue.host_response}</div>
                                  </div>
                                )}

                                <div className="text-xs text-muted-foreground">
                                  Reported {formatDistanceToNow(new Date(issue.created_at), { addSuffix: true })}
                                  {issue.resolved_at &&
                                    ` · resolved ${format(new Date(issue.resolved_at), 'MMM d, yyyy')}`}
                                </div>
                              </div>

                              <div className="flex flex-row lg:flex-col gap-2 lg:w-44 shrink-0">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="flex-1 lg:flex-none"
                                  onClick={() => {
                                    setReplyTarget(issue);
                                    setReplyText(issue.host_response ?? '');
                                  }}
                                  disabled={isResolved}
                                >
                                  <Reply className="w-4 h-4" /> Reply
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="flex-1 lg:flex-none"
                                  onClick={() => setResolveTarget(issue)}
                                  disabled={isResolved}
                                >
                                  <CheckCircle2 className="w-4 h-4" /> Resolve
                                </Button>
                                <Button
                                  size="sm"
                                  variant={sev === 'emergency' ? 'destructive' : 'secondary'}
                                  className="flex-1 lg:flex-none"
                                  onClick={() => setEscalateTarget(issue)}
                                  disabled={isResolved || isEscalated}
                                >
                                  <LifeBuoy className="w-4 h-4" /> Escalate
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {/* Reply dialog */}
      <Dialog open={!!replyTarget} onOpenChange={(o) => !o && setReplyTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Reply className="w-5 h-5" /> Reply to guest
            </DialogTitle>
            <DialogDescription>
              Your reply is saved on the issue and posted into the booking message thread.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Acknowledge, share next steps, and a timeline if you can…"
            rows={5}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplyTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submitReply} disabled={busy}>
              <Send className="w-4 h-4" /> {busy ? 'Sending…' : 'Send reply'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resolve confirm */}
      <AlertDialog open={!!resolveTarget} onOpenChange={(o) => !o && setResolveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark this issue as resolved?</AlertDialogTitle>
            <AlertDialogDescription>
              The guest will be notified in the booking thread. They can reply if anything is still wrong.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={markResolved} disabled={busy}>
              {busy ? 'Saving…' : 'Mark resolved'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Escalate dialog */}
      <Dialog open={!!escalateTarget} onOpenChange={(o) => !o && setEscalateTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LifeBuoy className="w-5 h-5 text-primary" /> Escalate to Hostiva Support
            </DialogTitle>
            <DialogDescription>
              Use this when you need Hostiva to step in — refunds, safety, disputes, or anything you can't resolve directly.
              Our team will review the booking, the guest's report, and contact both sides.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Textarea
              value={escalateNote}
              onChange={(e) => setEscalateNote(e.target.value)}
              placeholder="Optional context for Hostiva Support (what you've tried, why you need help)…"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEscalateTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submitEscalation} disabled={busy}>
              <LifeBuoy className="w-4 h-4" /> {busy ? 'Escalating…' : 'Escalate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}