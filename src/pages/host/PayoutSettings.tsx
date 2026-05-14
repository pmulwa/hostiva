import { useEffect, useState } from 'react';
import { Layout } from '@/components/layout/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import {
  Wallet, Award, AlertCircle, CalendarDays, Shield, Clock,
  CheckCircle2, Info, ArrowRight, Sparkles, Building2, TrendingUp,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { usePayoutTiers } from '@/hooks/usePayoutTiers';
import {
  TIER_LABELS, RELEASE_MODES, PAYOUT_METHODS,
  HOLD_REASON_LABELS, determineTier, tierProgress, type TierKey,
} from '@/lib/payouts/tiers';
import { format, formatDistanceToNow } from 'date-fns';
import { Navigate } from 'react-router-dom';

interface PayoutSettings {
  release_mode: 'standard';
  payout_method: keyof typeof PAYOUT_METHODS;
  current_tier: TierKey;
  long_stay_installments_enabled: boolean;
  payout_account: Record<string, string>;
}

interface Hold {
  id: string;
  booking_id: string;
  amount: number;
  currency: string;
  reason_code: string;
  reason_detail: string | null;
  status: string;
  placed_at: string;
  sla_due_at: string;
}

interface Installment {
  id: string;
  booking_id: string;
  installment_number: number;
  total_installments: number;
  nights_covered: number;
  amount: number;
  currency: string;
  scheduled_release_date: string;
  released_at: string | null;
  status: string;
}

export default function HostPayoutSettings() {
  const { user, isHost } = useAuth();
  const { toast } = useToast();
  const { config } = usePayoutTiers();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<PayoutSettings>({
    release_mode: 'standard',
    payout_method: 'bank_swift',
    current_tier: 'starter_free',
    long_stay_installments_enabled: true,
    payout_account: {},
  });
  const [metrics, setMetrics] = useState({
    completed_bookings: 0, avg_rating: 0, response_rate: 100, cancellation_rate: 0,
  });
  const [holds, setHolds] = useState<Hold[]>([]);
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [accountInput, setAccountInput] = useState('');

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: existing }, { data: tierData }, { data: holdsData }, { data: instData }] =
        await Promise.all([
          supabase.from('host_payout_settings' as any).select('*').eq('host_id', user.id).maybeSingle(),
          supabase.rpc('calculate_host_tier' as any, { _host_id: user.id }),
          supabase.from('payout_holds' as any).select('*').eq('host_id', user.id).eq('status', 'active').order('placed_at', { ascending: false }),
          supabase.from('payout_installments' as any).select('*').eq('host_id', user.id).order('scheduled_release_date', { ascending: true }),
        ]);

      if (existing) {
        const e = existing as any;
        const legacyTier: TierKey =
          e.current_tier === 'starter_free' || e.current_tier === 'starter_low' || e.current_tier === 'standard'
            ? e.current_tier
            : 'starter_free';
        setSettings({
          release_mode: 'standard',
          payout_method: e.payout_method,
          current_tier: legacyTier,
          long_stay_installments_enabled: e.long_stay_installments_enabled,
          payout_account: e.payout_account || {},
        });
        setAccountInput(e.payout_account?.account_reference || '');
      } else {
        await supabase.from('host_payout_settings' as any).insert({ host_id: user.id } as any);
      }

      if (tierData && (tierData as any[])[0]) {
        const t = (tierData as any[])[0];
        setMetrics({
          completed_bookings: t.completed_bookings,
          avg_rating: Number(t.avg_rating),
          response_rate: Number(t.response_rate),
          cancellation_rate: Number(t.cancellation_rate),
        });
      }

      setHolds((holdsData as unknown as Hold[]) || []);
      setInstallments((instData as unknown as Installment[]) || []);
      setLoading(false);
    })();
  }, [user]);

  if (!user) return <Navigate to="/auth" replace />;
  if (!isHost) return <Navigate to="/host/dashboard" replace />;

  const tierInfo = determineTier(metrics, config);
  const commissionPct = tierInfo.commission_pct;
  const progress = tierProgress(metrics, config);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from('host_payout_settings' as any)
      .update({
        release_mode: 'standard',
        payout_method: settings.payout_method,
        long_stay_installments_enabled: settings.long_stay_installments_enabled,
        payout_account: { account_reference: accountInput, method: settings.payout_method },
      } as any)
      .eq('host_id', user.id);
    setSaving(false);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Payout settings saved', description: 'Changes apply to new bookings.' });
    }
  };

  const tiers: { key: TierKey; pct: number; label: string; sub: string; criteria: string }[] = [
    { key: 'starter_free', pct: config.starter_free_pct, label: 'Welcome', sub: 'Starter', criteria: `First ${config.starter_free_bookings} bookings` },
    { key: 'starter_low', pct: config.starter_low_pct, label: 'Reduced', sub: 'Starter', criteria: `Bookings ${config.starter_free_bookings + 1}–${config.starter_low_bookings}` },
    { key: 'standard', pct: config.standard_pct, label: 'Standard', sub: 'Established', criteria: `From booking ${config.starter_low_bookings + 1}` },
  ];

  const activeMethod = PAYOUT_METHODS[settings.payout_method];

  return (
    <Layout>
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 sm:px-6 py-12 max-w-6xl">
          {/* MASTHEAD */}
          <header className="mb-12">
            <div className="flex items-center gap-2 mb-5 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <span>Treasury &amp; Settlement</span>
            </div>
            <div className="grid lg:grid-cols-12 gap-8 items-end">
              <div className="lg:col-span-8">
                <h1 className="font-serif text-5xl md:text-6xl font-light text-foreground leading-[1.02] tracking-tight">
                  Payout settings
                </h1>
                <p className="mt-4 text-base text-muted-foreground max-w-xl leading-relaxed">
                  Set how and when your earnings land. Commission is charged on the booking subtotal only — never on guest service fees, taxes, or security deposits.
                </p>
              </div>
              <div className="lg:col-span-4 flex lg:justify-end">
                <Button onClick={save} disabled={saving} size="lg" className="rounded-full px-8 shadow-sm">
                  {saving ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </div>
            <Separator className="mt-10" />
          </header>

          {/* HERO TIER CARD */}
          <section className="mb-12">
            <div className="rounded-3xl border bg-gradient-to-br from-primary/5 via-card to-card overflow-hidden shadow-sm">
              <div className="grid md:grid-cols-12">
                <div className="md:col-span-7 p-8 md:p-12">
                  <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground mb-6">
                    <Award className="w-3.5 h-3.5 text-primary" />
                    Current commission
                  </div>
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <span className="font-serif text-7xl md:text-8xl font-light text-foreground leading-none tabular-nums">
                      {commissionPct}
                    </span>
                    <span className="text-3xl font-light text-muted-foreground">%</span>
                    <Badge className="ml-2 rounded-full px-3 py-1 bg-primary/10 text-primary hover:bg-primary/15 border-primary/20">
                      {TIER_LABELS[tierInfo.tier]}
                    </Badge>
                  </div>
                  <p className="mt-5 text-sm text-muted-foreground italic font-serif max-w-md leading-relaxed">
                    Charged on the booking subtotal of every confirmed stay.
                  </p>

                  {progress && (
                    <div className="mt-8 max-w-md">
                      <div className="flex items-center justify-between text-xs mb-2.5">
                        <span className="uppercase tracking-wider text-muted-foreground font-medium">Tier progress</span>
                        <span className="text-foreground font-medium tabular-nums">
                          {progress.remaining} {progress.remaining === 1 ? 'booking' : 'bookings'} to go
                        </span>
                      </div>
                      <div className="relative h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all duration-500"
                          style={{ width: `${(progress.current / progress.bandEnd) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="md:col-span-5 grid grid-cols-3 md:grid-cols-1 border-t md:border-t-0 md:border-l divide-x md:divide-x-0 md:divide-y">
                  <div className="p-6 md:p-7">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground" />
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Completed</p>
                    </div>
                    <p className="font-serif text-3xl font-light text-foreground tabular-nums">{metrics.completed_bookings}</p>
                  </div>
                  <div className="p-6 md:p-7">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Rating</p>
                    </div>
                    <p className="font-serif text-3xl font-light text-foreground tabular-nums">
                      {metrics.avg_rating > 0 ? metrics.avg_rating.toFixed(2) : '—'}
                    </p>
                  </div>
                  <div className="p-6 md:p-7">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertCircle className="w-3.5 h-3.5 text-muted-foreground" />
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Cancel rate</p>
                    </div>
                    <p className="font-serif text-3xl font-light text-foreground tabular-nums">{metrics.cancellation_rate.toFixed(1)}%</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Commission ladder */}
            <div className="mt-5 grid md:grid-cols-3 gap-4">
              {tiers.map((t) => {
                const active = t.key === tierInfo.tier;
                return (
                  <div
                    key={t.key}
                    className={`relative rounded-2xl border p-6 transition-all ${
                      active
                        ? 'border-primary/40 bg-primary/5 shadow-sm'
                        : 'border-border bg-card hover:border-foreground/20'
                    }`}
                  >
                    {active && (
                      <span className="absolute top-4 right-4 inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider">
                        <CheckCircle2 className="w-3 h-3" />
                        Current
                      </span>
                    )}
                    <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-medium mb-3">
                      {t.sub} · {t.label}
                    </p>
                    <div className="flex items-baseline gap-1">
                      <span className="font-serif text-5xl font-light text-foreground tabular-nums">{t.pct}</span>
                      <span className="text-xl text-muted-foreground">%</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-3 font-serif italic">{t.criteria}</p>
                  </div>
                );
              })}
            </div>
          </section>

          {/* SETTINGS TABS */}
          <section className="mb-12">
            <div className="flex items-center gap-3 mb-6">
              <h2 className="font-serif text-2xl font-light text-foreground">Configuration</h2>
              <Separator className="flex-1" />
            </div>

            <Tabs defaultValue="method" className="space-y-6">
              <TabsList className="grid grid-cols-4 w-full max-w-2xl bg-muted/60 rounded-full p-1 h-12">
                <TabsTrigger value="method" className="rounded-full data-[state=active]:bg-background data-[state=active]:shadow-sm">
                  <Wallet className="w-4 h-4 mr-1.5" /> Method
                </TabsTrigger>
                <TabsTrigger value="release" className="rounded-full data-[state=active]:bg-background data-[state=active]:shadow-sm">
                  <Clock className="w-4 h-4 mr-1.5" /> Release
                </TabsTrigger>
                <TabsTrigger value="holds" className="rounded-full data-[state=active]:bg-background data-[state=active]:shadow-sm">
                  <Shield className="w-4 h-4 mr-1.5" /> Holds
                  {holds.length > 0 && <Badge variant="destructive" className="ml-1.5 h-4 px-1.5 text-[10px]">{holds.length}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="installments" className="rounded-full data-[state=active]:bg-background data-[state=active]:shadow-sm">
                  <CalendarDays className="w-4 h-4 mr-1.5" /> Long stays
                </TabsTrigger>
              </TabsList>

              {/* METHOD */}
              <TabsContent value="method" className="space-y-5 mt-6">
                <Card className="rounded-2xl border shadow-sm">
                  <CardContent className="p-8 space-y-7">
                    <div>
                      <h3 className="font-serif text-xl font-light text-foreground">Payout method</h3>
                      <p className="text-sm text-muted-foreground mt-1">Where your earnings land. All methods are free except PayPal (0.5% PayPal-imposed fee).</p>
                    </div>

                    {/* Current method preview */}
                    <div className="rounded-xl border bg-muted/30 p-5 flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-background border flex items-center justify-center shrink-0">
                        <Building2 className="w-5 h-5 text-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground">{activeMethod.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{activeMethod.time} · {activeMethod.fee}</p>
                      </div>
                      <Badge variant="outline" className="rounded-full bg-emerald-50 text-emerald-700 border-emerald-200">Active</Badge>
                    </div>

                    <div className="grid md:grid-cols-2 gap-5">
                      <div>
                        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Method</Label>
                        <Select value={settings.payout_method} onValueChange={(v) => setSettings(s => ({ ...s, payout_method: v as any }))}>
                          <SelectTrigger className="mt-2 h-11 rounded-xl"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(PAYOUT_METHODS).map(([key, m]) => (
                              <SelectItem key={key} value={key}>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{m.label}</span>
                                  <span className="text-xs text-muted-foreground">· {m.time}</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Account reference</Label>
                        <Input
                          type="text"
                          value={accountInput}
                          onChange={(e) => setAccountInput(e.target.value)}
                          placeholder={settings.payout_method.includes('bank') ? 'IBAN or account number' : 'Phone, email, or wallet ID'}
                          className="mt-2 h-11 rounded-xl"
                        />
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5" /> Verified by our finance team before your first payout.
                    </p>

                    <Separator />

                    <div>
                      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-3 block">All available methods</Label>
                      <div className="rounded-xl border overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/50">
                            <tr>
                              <th className="text-left px-4 py-2.5 font-semibold text-foreground">Method</th>
                              <th className="text-left px-4 py-2.5 font-semibold text-foreground">Processing</th>
                              <th className="text-left px-4 py-2.5 font-semibold text-foreground">Cost</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {Object.entries(PAYOUT_METHODS).map(([key, m]) => (
                              <tr key={key} className={settings.payout_method === key ? 'bg-primary/5' : ''}>
                                <td className="px-4 py-3 font-medium text-foreground">{m.label}</td>
                                <td className="px-4 py-3 text-muted-foreground">{m.time}</td>
                                <td className="px-4 py-3 text-muted-foreground">{m.fee}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-5 rounded-xl border bg-muted/30">
                      <div className="pr-4">
                        <Label className="font-semibold text-foreground">Long-stay installments</Label>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                          For stays of {config.long_stay_threshold_nights}+ nights, split payouts into monthly installments matching guest payments.
                        </p>
                      </div>
                      <Switch
                        checked={settings.long_stay_installments_enabled}
                        onCheckedChange={(c) => setSettings(s => ({ ...s, long_stay_installments_enabled: c }))}
                      />
                    </div>

                    <div className="flex justify-end pt-2">
                      <Button onClick={save} disabled={saving} className="rounded-full px-8 min-w-32">
                        {saving ? 'Saving…' : 'Save method'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* RELEASE */}
              <TabsContent value="release" className="mt-6">
                <Card className="rounded-2xl border shadow-sm">
                  <CardContent className="p-8 space-y-6">
                    <div>
                      <h3 className="font-serif text-xl font-light text-foreground">Release timing</h3>
                      <p className="text-sm text-muted-foreground mt-1">When your payout becomes available after a guest checks in.</p>
                    </div>

                    <div className="rounded-2xl border-2 border-primary/30 bg-primary/5 p-6">
                      <div className="flex items-start gap-4">
                        <div className="w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                          <Clock className="w-5 h-5 text-primary" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-serif text-xl font-light text-foreground">{RELEASE_MODES.standard.label}</span>
                            <Badge className="rounded-full bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-emerald-200">{RELEASE_MODES.standard.cost}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1.5">{RELEASE_MODES.standard.desc}</p>

                          <div className="mt-5 flex items-center gap-3 text-xs flex-wrap">
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background border">
                              <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                              <span className="text-foreground">Guest checks in</span>
                            </div>
                            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background border">
                              <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                              <span className="text-foreground">+24 hours</span>
                            </div>
                            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-200">
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              <span className="font-semibold text-emerald-700">Payout released</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border bg-muted/30 p-5 flex items-start gap-3">
                      <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-sm text-foreground">Why 24 hours?</p>
                        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                          The 24-hour window protects you from fraudulent check-in disputes. If a guest reports a serious issue within this window, the hold lets us investigate before funds move.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* HOLDS */}
              <TabsContent value="holds" className="mt-6">
                <Card className="rounded-2xl border shadow-sm">
                  <CardContent className="p-8 space-y-6">
                    <div>
                      <h3 className="font-serif text-xl font-light text-foreground">Active payout holds</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        Every hold has a visible reason and SLA. If we miss the SLA, the hold auto-releases unless a team member logs a documented override.
                      </p>
                    </div>

                    {loading ? (
                      <p className="text-sm text-muted-foreground">Loading…</p>
                    ) : holds.length === 0 ? (
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-6 flex items-center gap-4">
                        <div className="w-11 h-11 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                          <Shield className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-emerald-800">All clear</p>
                          <p className="text-sm text-emerald-700 mt-0.5">No active holds on your payouts. Money is flowing normally.</p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {holds.map((h) => {
                          const reason = HOLD_REASON_LABELS[h.reason_code] || { label: h.reason_code, desc: '' };
                          const overdue = new Date(h.sla_due_at) < new Date();
                          return (
                            <div
                              key={h.id}
                              className={`rounded-xl border p-5 ${overdue ? 'border-destructive/40 bg-destructive/5' : 'bg-card'}`}
                            >
                              <div className="flex items-start justify-between gap-3 flex-wrap">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                    <Badge variant={overdue ? 'destructive' : 'outline'} className="font-mono text-[10px] rounded-full">
                                      {h.reason_code}
                                    </Badge>
                                    <span className="font-semibold text-foreground">{reason.label}</span>
                                  </div>
                                  <p className="text-sm text-muted-foreground">{h.reason_detail || reason.desc}</p>
                                  <p className="text-xs text-muted-foreground mt-2 font-mono">
                                    Booking #{h.booking_id.slice(0, 8).toUpperCase()}
                                  </p>
                                </div>
                                <div className="text-right shrink-0">
                                  <div className="font-serif text-2xl font-light text-foreground tabular-nums">
                                    {h.currency} {Number(h.amount).toLocaleString()}
                                  </div>
                                  <div className={`text-xs flex items-center gap-1 justify-end mt-1 ${overdue ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                                    <Clock className="w-3 h-3" />
                                    SLA {overdue ? 'exceeded' : 'due'} {formatDistanceToNow(new Date(h.sla_due_at), { addSuffix: true })}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <Separator />

                    <div>
                      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-3 block">
                        Hold reason codes &amp; SLA
                      </Label>
                      <div className="grid sm:grid-cols-2 gap-2.5 text-xs">
                        {Object.entries(HOLD_REASON_LABELS).map(([code, info]) => (
                          <div key={code} className="flex items-start gap-2.5 p-3 rounded-xl border bg-muted/20">
                            <Badge variant="outline" className="font-mono text-[9px] shrink-0 rounded-full">{code}</Badge>
                            <div>
                              <div className="font-semibold text-foreground">{info.label}</div>
                              <div className="text-muted-foreground mt-0.5">{info.desc}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* INSTALLMENTS */}
              <TabsContent value="installments" className="mt-6">
                <Card className="rounded-2xl border shadow-sm">
                  <CardContent className="p-8 space-y-6">
                    <div>
                      <h3 className="font-serif text-xl font-light text-foreground">Long-stay installment schedule</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        Stays of {config.long_stay_threshold_nights}+ nights are paid in monthly installments — matching cash-flow to guest payments.
                      </p>
                    </div>

                    {installments.length === 0 ? (
                      <div className="text-center py-16 rounded-2xl border border-dashed">
                        <CalendarDays className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
                        <p className="text-sm font-medium text-foreground">No long-stay bookings yet</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Installments will appear here when a guest books {config.long_stay_threshold_nights}+ nights.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {installments.map((i) => {
                          const released = i.status === 'released';
                          return (
                            <div
                              key={i.id}
                              className="flex items-center gap-4 p-4 rounded-xl border bg-card hover:border-foreground/20 transition-colors"
                            >
                              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm shrink-0 ${released ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
                                #{i.installment_number}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-semibold text-foreground">
                                    Installment {i.installment_number} of {i.total_installments}
                                  </span>
                                  <Badge variant="outline" className="text-[10px] rounded-full">{i.nights_covered} nights</Badge>
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                                  Booking #{i.booking_id.slice(0, 8).toUpperCase()}
                                </p>
                              </div>
                              <div className="text-right">
                                <div className="font-semibold text-foreground tabular-nums">{i.currency} {Number(i.amount).toLocaleString()}</div>
                                <div className="text-xs text-muted-foreground">
                                  {released
                                    ? `Released ${format(new Date(i.released_at!), 'MMM d, yyyy')}`
                                    : `Scheduled ${format(new Date(i.scheduled_release_date), 'MMM d, yyyy')}`}
                                </div>
                              </div>
                              <Badge
                                variant={released ? 'default' : 'secondary'}
                                className={`rounded-full ${released ? 'bg-emerald-500 hover:bg-emerald-600' : ''}`}
                              >
                                {i.status}
                              </Badge>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </section>

          {/* Commission base reminder */}
          <section>
            <Card className="rounded-2xl border-dashed bg-muted/20">
              <CardContent className="p-7">
                <div className="flex items-center gap-2 mb-3">
                  <Info className="w-4 h-4 text-primary" />
                  <h3 className="font-serif text-lg font-light text-foreground">How commission is charged</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                  Hostiva's commission is charged on the <span className="font-semibold text-foreground">booking subtotal only</span> — the room rate × nights. It is <span className="font-semibold text-foreground">never</span> charged on:
                </p>
                <ul className="grid sm:grid-cols-2 gap-2.5 text-sm">
                  {[
                    "Guest service fee (Hostiva's revenue directly)",
                    'Taxes',
                    'Security deposits (even if captured)',
                    'Cancelled bookings where you receive nothing',
                  ].map((s) => (
                    <li key={s} className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span className="text-foreground">{s}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </Layout>
  );
}
