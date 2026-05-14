import { useEffect, useState, useMemo } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import {
  Wallet, Save, AlertCircle, Award, Clock, CalendarDays, Banknote,
  CheckCircle2, ShieldAlert,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import {
  usePayoutTiers, DEFAULT_PAYOUT_TIERS, type PayoutTiersConfig,
} from '@/hooks/usePayoutTiers';
import {
  HOLD_REASON_LABELS, PAYOUT_METHODS, RELEASE_MODES, TIER_COLORS,
} from '@/lib/payouts/tiers';
import { format, formatDistanceToNow } from 'date-fns';

interface Hold {
  id: string;
  booking_id: string;
  host_id: string;
  amount: number;
  currency: string;
  reason_code: string;
  reason_detail: string | null;
  status: string;
  placed_at: string;
  sla_due_at: string;
  override_reason: string | null;
}

function NumberField({
  label, value, onChange, suffix, helper,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  helper?: string;
}) {
  return (
    <div>
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2 mt-1.5">
        <Input
          type="number"
          step="0.1"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-28"
        />
        {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
      </div>
      {helper && <p className="text-[11px] text-muted-foreground mt-1">{helper}</p>}
    </div>
  );
}

export default function AdminPayoutTiers() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { config, refetch } = usePayoutTiers();
  const [draft, setDraft] = useState<PayoutTiersConfig>(DEFAULT_PAYOUT_TIERS);
  const [saving, setSaving] = useState(false);
  const [holds, setHolds] = useState<Hold[]>([]);
  const [holdsLoading, setHoldsLoading] = useState(true);
  const [hostNames, setHostNames] = useState<Record<string, string>>({});

  useEffect(() => { setDraft(config); }, [config]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('payout_holds' as any)
        .select('*')
        .eq('status', 'active')
        .order('sla_due_at', { ascending: true })
        .limit(100);
      const list = (data as unknown as Hold[]) || [];
      setHolds(list);
      setHoldsLoading(false);

      const hostIds = Array.from(new Set(list.map(h => h.host_id)));
      if (hostIds.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('user_id, full_name, email')
          .in('user_id', hostIds);
        const map: Record<string, string> = {};
        (profs || []).forEach((p: any) => {
          map[p.user_id] = p.full_name || p.email || p.user_id.slice(0, 8);
        });
        setHostNames(map);
      }
    })();
  }, []);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(config), [draft, config]);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('platform_controls' as any)
      .upsert(
        {
          section: 'payout_tiers',
          settings: draft as any,
          updated_at: new Date().toISOString(),
          updated_by: user?.id,
        } as any,
        { onConflict: 'section' }
      );
    setSaving(false);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Payout tiers saved', description: 'New thresholds apply on next tier recalculation.' });
      refetch();
    }
  };

  const releaseHold = async (id: string) => {
    const reason = window.prompt('Override reason (required for audit log):');
    if (!reason) return;
    const { error } = await supabase
      .from('payout_holds' as any)
      .update({
        status: 'released',
        released_at: new Date().toISOString(),
        manual_override_by: user?.id,
        override_reason: reason,
      } as any)
      .eq('id', id);
    if (error) {
      toast({ title: 'Release failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Hold released' });
      setHolds((h) => h.filter((x) => x.id !== id));
    }
  };

  const overdueCount = holds.filter(h => new Date(h.sla_due_at) < new Date()).length;

  return (
    <AdminLayout>
      <div className="p-6 max-w-7xl">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
              <Wallet className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-display font-bold">Payouts & Commission</h1>
              <p className="text-sm text-muted-foreground">
                Govern host commission tiers, release timing, hold SLAs and active holds across the platform.
              </p>
            </div>
          </div>
          {dirty && (
            <Button onClick={save} disabled={saving}>
              <Save className="w-4 h-4 mr-2" />
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          )}
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Card>
            <CardContent className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Active holds</p>
              <p className="font-display text-2xl font-bold mt-1">{holds.length}</p>
            </CardContent>
          </Card>
          <Card className={overdueCount > 0 ? 'border-destructive/50 bg-destructive/5' : ''}>
            <CardContent className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">SLA overdue</p>
              <p className={`font-display text-2xl font-bold mt-1 ${overdueCount > 0 ? 'text-destructive' : ''}`}>{overdueCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Standard rate</p>
              <p className="font-display text-2xl font-bold mt-1">{config.standard_pct}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Long-stay threshold</p>
              <p className="font-display text-2xl font-bold mt-1">{config.long_stay_threshold_nights}n</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="tiers" className="space-y-4">
          <TabsList>
            <TabsTrigger value="tiers"><Award className="w-4 h-4 mr-1.5" /> Commission tiers</TabsTrigger>
            <TabsTrigger value="release"><Clock className="w-4 h-4 mr-1.5" /> Release & long-stay</TabsTrigger>
            <TabsTrigger value="methods"><Banknote className="w-4 h-4 mr-1.5" /> Methods reference</TabsTrigger>
            <TabsTrigger value="holds">
              <AlertCircle className="w-4 h-4 mr-1.5" /> Active holds
              {holds.length > 0 && (
                <Badge variant={overdueCount > 0 ? 'destructive' : 'secondary'} className="ml-1.5 h-4 text-[10px]">
                  {holds.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="sla"><ShieldAlert className="w-4 h-4 mr-1.5" /> SLA limits</TabsTrigger>
          </TabsList>

          {/* COMMISSION TIERS */}
          <TabsContent value="tiers" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Commission ladder</CardTitle>
                <CardDescription>
                  Three-band system. Charged on booking subtotal only — never on guest service fees, taxes, security deposits, or cancellations.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Visual tier ladder */}
                <div className="grid md:grid-cols-3 gap-3 mb-6">
                  {[
                    { key: 'starter_free' as const, pct: draft.starter_free_pct, label: 'Starter — Welcome', criteria: `First ${draft.starter_free_bookings} bookings`, assignment: 'Automatic on signup' },
                    { key: 'starter_low' as const, pct: draft.starter_low_pct, label: 'Starter — Reduced', criteria: `Bookings ${draft.starter_free_bookings + 1}–${draft.starter_low_bookings}`, assignment: 'Automatic' },
                    { key: 'standard' as const, pct: draft.standard_pct, label: 'Standard', criteria: `From booking ${draft.starter_low_bookings + 1} onward`, assignment: 'Automatic' },
                  ].map((t) => (
                    <div key={t.key} className="rounded-lg border p-4 bg-card">
                      <Badge variant="outline" className={`${TIER_COLORS[t.key]} text-[10px] uppercase tracking-wider`}>
                        {t.label}
                      </Badge>
                      <div className="font-display text-3xl font-bold mt-3">{t.pct}%</div>
                      <div className="text-xs text-muted-foreground mt-1">{t.criteria}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-3 pt-2 border-t">
                        Assignment: <span className="text-foreground font-semibold">{t.assignment}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <Separator className="my-5" />

                {/* Editable rates */}
                <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3 block">
                  Commission rates
                </Label>
                <div className="grid md:grid-cols-3 gap-4">
                  <NumberField
                    label="Starter — Welcome"
                    value={draft.starter_free_pct}
                    onChange={(v) => setDraft({ ...draft, starter_free_pct: v })}
                    suffix="%"
                    helper="First-time host welcome rate"
                  />
                  <NumberField
                    label="Starter — Reduced"
                    value={draft.starter_low_pct}
                    onChange={(v) => setDraft({ ...draft, starter_low_pct: v })}
                    suffix="%"
                    helper="Mid-band reduced rate"
                  />
                  <NumberField
                    label="Standard"
                    value={draft.standard_pct}
                    onChange={(v) => setDraft({ ...draft, standard_pct: v })}
                    suffix="%"
                    helper="Default rate after graduation"
                  />
                </div>

                <Separator className="my-5" />

                {/* Editable thresholds */}
                <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3 block">
                  Tier thresholds (lifetime confirmed bookings)
                </Label>
                <div className="grid md:grid-cols-2 gap-4">
                  <NumberField
                    label="Welcome band ends after"
                    value={draft.starter_free_bookings}
                    onChange={(v) => setDraft({ ...draft, starter_free_bookings: v })}
                    suffix="bookings"
                    helper="0 → N bookings are charged the Welcome rate"
                  />
                  <NumberField
                    label="Reduced band ends after"
                    value={draft.starter_low_bookings}
                    onChange={(v) => setDraft({ ...draft, starter_low_bookings: v })}
                    suffix="bookings"
                    helper="N+1 → M bookings get the Reduced rate, then Standard"
                  />
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button onClick={save} disabled={saving || !dirty}>
                <Save className="w-4 h-4 mr-2" />
                {saving ? 'Saving…' : 'Save tier configuration'}
              </Button>
            </div>
          </TabsContent>

          {/* RELEASE & LONG-STAY */}
          <TabsContent value="release" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Release timing</CardTitle>
                <CardDescription>
                  Hostiva currently offers a single Standard release mode — payouts release 24 hours after guest check-in.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border-2 border-primary bg-primary/5 p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center">
                    <Clock className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-display font-bold">{RELEASE_MODES.standard.label}</span>
                      <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50">{RELEASE_MODES.standard.cost}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{RELEASE_MODES.standard.desc}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Long-stay payouts</CardTitle>
                <CardDescription>
                  Stays at or above the threshold are split into monthly installments matching guest payments.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <NumberField
                  label="Long-stay threshold"
                  value={draft.long_stay_threshold_nights}
                  onChange={(v) => setDraft({ ...draft, long_stay_threshold_nights: v })}
                  suffix="nights"
                  helper="Bookings of this length or longer trigger installment payouts."
                />
              </CardContent>
              <CardContent className="pt-0">
                <Button onClick={save} disabled={saving || !dirty}>
                  <Save className="w-4 h-4 mr-2" />
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* METHODS REFERENCE */}
          <TabsContent value="methods">
            <Card>
              <CardHeader>
                <CardTitle>Payout methods reference</CardTitle>
                <CardDescription>
                  Methods, processing windows and Hostiva costs as published to hosts.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-semibold">Method</th>
                        <th className="text-left px-4 py-2.5 font-semibold">Processing time</th>
                        <th className="text-left px-4 py-2.5 font-semibold">Hostiva cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {Object.entries(PAYOUT_METHODS).map(([key, m]) => (
                        <tr key={key} className="hover:bg-muted/20">
                          <td className="px-4 py-2.5 font-medium">{m.label}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{m.time}</td>
                          <td className="px-4 py-2.5">
                            {m.fee === 'Free' ? (
                              <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50">Free</Badge>
                            ) : (
                              <span className="text-muted-foreground">{m.fee}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  Times and fees are managed in <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded">src/lib/payouts/tiers.ts</code> for now and surfaced to hosts in the Payouts page.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* HOLDS */}
          <TabsContent value="holds">
            <Card>
              <CardHeader>
                <CardTitle>All active payout holds</CardTitle>
                <CardDescription>
                  Holds past SLA auto-release unless overridden by a team member with a documented justification.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {holdsLoading ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
                ) : holds.length === 0 ? (
                  <div className="text-center py-12">
                    <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500 mb-3" />
                    <p className="text-sm font-medium">No active holds</p>
                    <p className="text-xs text-muted-foreground mt-1">Money is flowing normally across the platform.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {holds.map((h) => {
                      const overdue = new Date(h.sla_due_at) < new Date();
                      const reason = HOLD_REASON_LABELS[h.reason_code];
                      return (
                        <div
                          key={h.id}
                          className={`flex items-center justify-between gap-3 p-3 rounded-lg border ${overdue ? 'border-destructive bg-destructive/5' : 'bg-card'}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant={overdue ? 'destructive' : 'outline'} className="font-mono text-[10px]">
                                {h.reason_code}
                              </Badge>
                              <span className="text-sm font-medium">{reason?.label}</span>
                              <span className="text-xs text-muted-foreground font-mono">
                                Host: {hostNames[h.host_id] || h.host_id.slice(0, 8)} · BK-{h.booking_id.slice(0, 8).toUpperCase()}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              Placed {format(new Date(h.placed_at), 'MMM d, HH:mm')} · SLA {overdue ? 'exceeded' : 'due'} {formatDistanceToNow(new Date(h.sla_due_at), { addSuffix: true })}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-semibold">{h.currency} {Number(h.amount).toLocaleString()}</div>
                          </div>
                          <Button size="sm" variant="outline" onClick={() => releaseHold(h.id)}>
                            Override & release
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* SLA */}
          <TabsContent value="sla">
            <Card>
              <CardHeader>
                <CardTitle>Hold resolution SLAs</CardTitle>
                <CardDescription>
                  Maximum time a hold can stay active before auto-release. Hosts see these on every hold.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid md:grid-cols-2 gap-4">
                <NumberField
                  label="Fraud review"
                  value={draft.hold_sla_fraud_hours}
                  onChange={(v) => setDraft({ ...draft, hold_sla_fraud_hours: v })}
                  suffix="hours"
                  helper="FRAUD_REVIEW reason code"
                />
                <NumberField
                  label="Dispute pending"
                  value={draft.hold_sla_dispute_days}
                  onChange={(v) => setDraft({ ...draft, hold_sla_dispute_days: v })}
                  suffix="days"
                  helper="DISPUTE_PENDING reason code"
                />
                <NumberField
                  label="Bank verification"
                  value={draft.hold_sla_bank_days}
                  onChange={(v) => setDraft({ ...draft, hold_sla_bank_days: v })}
                  suffix="days"
                  helper="BANK_VERIFICATION reason code"
                />
                <NumberField
                  label="Sanctions check"
                  value={draft.hold_sla_sanctions_days}
                  onChange={(v) => setDraft({ ...draft, hold_sla_sanctions_days: v })}
                  suffix="days"
                  helper="SANCTIONS_CHECK reason code"
                />
              </CardContent>
              <CardContent className="pt-0">
                <Button onClick={save} disabled={saving || !dirty}>
                  <Save className="w-4 h-4 mr-2" />
                  {saving ? 'Saving…' : 'Save SLAs'}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}