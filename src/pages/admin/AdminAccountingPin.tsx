import { useEffect, useState } from 'react';
import { Layout } from '@/components/layout/Layout';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { KeyRound, ShieldAlert, ShieldCheck, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface LockoutRow {
  host_id: string;
  failed_count: number;
  first_failed_at: string | null;
  last_failed_at: string | null;
  locked_until: string | null;
  full_name?: string | null;
  email?: string | null;
}

export default function AdminAccountingPin() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [rows, setRows] = useState<LockoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('acct_pin_attempts')
      .select('host_id, failed_count, first_failed_at, last_failed_at, locked_until')
      .order('locked_until', { ascending: false, nullsFirst: false });
    if (error) {
      toast({ title: 'Could not load lockouts', description: error.message, variant: 'destructive' });
      setLoading(false);
      return;
    }
    const list = (data ?? []) as LockoutRow[];
    // Enrich with host name/email
    const ids = list.map((r) => r.host_id);
    if (ids.length) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('user_id, full_name, email')
        .in('user_id', ids);
      const map = new Map((profs ?? []).map((p: any) => [p.user_id, p]));
      list.forEach((r) => {
        const p = map.get(r.host_id) as any;
        r.full_name = p?.full_name ?? null;
        r.email = p?.email ?? null;
      });
    }
    setRows(list);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const clearLockout = async (hostId: string) => {
    if (!user) return;
    setBusy(hostId);
    const { error } = await (supabase as any).rpc('acct_admin_unlock_host', {
      p_host_id: hostId,
      p_reason: reason.trim() || null,
    });
    setBusy(null);
    if (error) {
      toast({ title: 'Override failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Lockout cleared', description: 'Host can attempt their PIN again.' });
    setReason('');
    load();
  };

  const filtered = rows.filter((r) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return (
      r.host_id.toLowerCase().includes(f) ||
      (r.full_name ?? '').toLowerCase().includes(f) ||
      (r.email ?? '').toLowerCase().includes(f)
    );
  });

  return (
    <Layout>
      <div className="container mx-auto px-4 py-6 max-w-5xl">
        <div className="flex items-center gap-3 mb-6">
          <KeyRound className="w-7 h-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Accounting PIN — admin override</h1>
            <p className="text-sm text-muted-foreground">
              Clear a host's failed-attempt lockout so they can try their PIN again.
              You cannot view or change a host's PIN.
            </p>
          </div>
        </div>

        <Alert className="mb-4">
          <ShieldCheck className="h-4 w-4" />
          <AlertDescription className="text-xs">
            This override <strong>does not unlock the host's accounting</strong> for you and
            does not reveal their PIN. It only resets the failed-attempt counter so the host
            can enter their PIN again. Every override is recorded in the audit log.
          </AlertDescription>
        </Alert>

        <Card className="mb-4">
          <CardContent className="pt-4 space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search by host name, email or ID…"
                className="pl-9"
              />
            </div>
            <div>
              <Label className="text-xs">Reason (recorded in audit log)</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Host called support and verified identity by phone"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Hosts with PIN failures ({rows.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No hosts currently have failed PIN attempts.
              </p>
            ) : (
              <div className="space-y-2">
                {filtered.map((r) => {
                  const isLocked = r.locked_until && new Date(r.locked_until) > new Date();
                  return (
                    <div key={r.host_id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{r.full_name || r.email || 'Unknown host'}</div>
                        <div className="text-xs text-muted-foreground font-mono truncate">{r.host_id}</div>
                        <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-2 items-center">
                          <Badge variant={isLocked ? 'destructive' : 'secondary'}>
                            {isLocked ? 'Locked' : `${r.failed_count} failed`}
                          </Badge>
                          {isLocked && r.locked_until && (
                            <span>Until {new Date(r.locked_until).toLocaleString()}</span>
                          )}
                          {r.last_failed_at && (
                            <span>Last attempt: {new Date(r.last_failed_at).toLocaleString()}</span>
                          )}
                        </div>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="outline" disabled={busy === r.host_id}>
                            <ShieldAlert className="w-4 h-4 mr-1" />
                            Clear lockout
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Clear PIN lockout?</AlertDialogTitle>
                            <AlertDialogDescription asChild>
                              <div className="text-sm space-y-2">
                                <p>
                                  The host will be able to enter their PIN again immediately.
                                  You will <strong>not</strong> see or set their PIN.
                                </p>
                                {!reason.trim() && (
                                  <p className="text-destructive text-xs">
                                    Tip: add a reason above for the audit log.
                                  </p>
                                )}
                              </div>
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => clearLockout(r.host_id)}>
                              Clear lockout
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}