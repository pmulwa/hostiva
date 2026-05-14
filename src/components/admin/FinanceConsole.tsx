import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Download, FileSpreadsheet, FileText, TrendingUp, TrendingDown,
  Wallet, Receipt, ShieldCheck, CheckCircle2, Lock, Sparkles, ArrowUpRight, ArrowDownRight,
  Coins, BadgePercent, Landmark, Plus, Trash2, Building2, Pencil,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip as RTooltip,
  CartesianGrid, BarChart, Bar, Cell, Legend, ComposedChart, Line,
} from 'recharts';
import { useHasPermission } from '@/hooks/usePermissions';
import { useAuth } from '@/contexts/AuthContext';
import { exportAnnualReportPdf } from '@/lib/accounting/pdfExport';
import Decimal from 'decimal.js';
import type {
  IncomeStatement,
  BalanceSheet,
  CashFlowStatement,
  AccountBalance,
} from '@/lib/accounting/statements';

/* ------------------------------------------------------------------ */
/* Types (kept compatible with AdminAccounting)                       */
/* ------------------------------------------------------------------ */

interface BookingRow {
  id: string; host_id: string; guest_id: string; property_id: string; status: string;
  currency: string | null; subtotal: number; cleaning_fee: number | null;
  service_fee: number | null; total_price: number;
  refund_amount: number | null; refund_status: string | null;
  check_in_date: string; check_out_date: string; created_at: string;
}
interface PayoutRow {
  id: string; host_id: string; booking_id: string;
  amount: number; status: string; paid_at: string | null; created_at: string;
}
interface ExternalBookingRow {
  id: string; host_id: string; property_id: string | null;
  gross_revenue: number; cleaning_fee: number; commission_amount: number;
  net_payout: number; txn_currency: string; payment_status: string;
  payment_received_date: string | null; check_in_date: string;
}
interface ProfileLite { user_id: string; full_name: string | null; email: string }
interface PropertyLite { id: string; title: string; host_id: string }

export interface FinanceConsoleProps {
  bookings: BookingRow[];
  payouts: PayoutRow[];
  externals: ExternalBookingRow[];
  profiles: ProfileLite[];
  properties: PropertyLite[];
  loading: boolean;
  from: string;
  to: string;
  totals: {
    guestPaid: number; hostPayouts: number;
    platformServiceFee: number; platformCommission: number;
    platformTaxes: number; platformRevenue: number;
    cleaningRevenue: number; refundsIssued: number;
    grossBookingValue: number;
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const fmt = (n: number, ccy = 'USD') => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: ccy, maximumFractionDigits: 2 }).format(n); }
  catch { return `${ccy} ${n.toFixed(2)}`; }
};
const csvEscape = (v: any) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const monthKey = (iso: string) => iso.slice(0, 7);
const downloadBlob = (filename: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};

// Estimated payment-processing cost on guest payments (Stripe-style: 2.9% + $0.30 per txn).
// This is an industry-standard proxy until exact processor invoices are imported.
const estimateProcessingCost = (guestPaid: number, txnCount: number) =>
  guestPaid * 0.029 + txnCount * 0.30;

/* ------------------------------------------------------------------ */
/* Main component                                                     */
/* ------------------------------------------------------------------ */

export function FinanceConsole(props: FinanceConsoleProps) {
  const { bookings, payouts, externals, loading, from, to, totals } = props;
  const canExportAll = useHasPermission('export_finance');

  // ---- Cancellation penalties (host-cancel fines) — Hostiva income --
  const [cancellationPenalties, setCancellationPenalties] = useState(0);
  // ---- Hostiva's own operating expenses (admin-managed) -------------
  interface PlatformExpenseRow {
    id: string; category: string; description: string; amount: number;
    currency: string; expense_date: string; vendor: string | null;
  }
  const [platformExpenses, setPlatformExpenses] = useState<PlatformExpenseRow[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      // Host cancellation fines fall directly into Hostiva's revenue
      const { data: pens } = await supabase
        .from('host_deductions' as any)
        .select('amount, created_at, currency')
        .eq('reason_code', 'host_cancel_fine')
        .gte('created_at', from)
        .lte('created_at', `${to}T23:59:59.999Z`);
      // Admin-managed Hostiva operating expenses (hosting, salaries, etc.)
      const { data: exps } = await supabase
        .from('platform_expenses' as any)
        .select('id, category, description, amount, currency, expense_date, vendor')
        .gte('expense_date', from)
        .lte('expense_date', to)
        .order('expense_date', { ascending: false });
      if (!active) return;
      const totalPen = (pens ?? []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
      setCancellationPenalties(totalPen);
      setPlatformExpenses(((exps as any) ?? []) as PlatformExpenseRow[]);
    })();
    return () => { active = false; };
  }, [from, to, refreshKey]);

  // ---- Hostiva-only economics ---------------------------------------
  const hostly = useMemo(() => {
    const successful = bookings.filter(b => ['confirmed', 'completed'].includes(b.status));
    const txnCount = successful.length;
    // Revenue lines (what Hostiva actually earns)
    const serviceFees = totals.platformServiceFee;
    const commission = totals.platformCommission;
    const penalties = cancellationPenalties;              // host-cancel fines — Hostiva income
    const taxesPayable = totals.platformTaxes;            // VAT/GST owed on Hostiva revenue
    const grossRevenue = serviceFees + commission + penalties;
    // Cost lines (what Hostiva actually spends)
    const refunds = totals.refundsIssued;
    const processing = estimateProcessingCost(totals.guestPaid, txnCount);
    const operatingExpenses = platformExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
    const totalCosts = refunds + processing + taxesPayable + operatingExpenses;
    const netIncome = grossRevenue - totalCosts;
    const margin = grossRevenue > 0 ? netIncome / grossRevenue : 0;
    return {
      serviceFees, commission, penalties,
      taxesPayable, operatingExpenses,
      grossRevenue, refunds, processing,
      totalCosts, netIncome, margin, txnCount,
    };
  }, [bookings, totals, cancellationPenalties, platformExpenses]);

  // ---- Monthly trend: Hostiva revenue vs Hostiva cost vs net ---------
  const trend = useMemo(() => {
    const map = new Map<string, { month: string; revenue: number; cost: number; net: number; txn: number }>();
    const ensure = (k: string) => {
      let r = map.get(k);
      if (!r) { r = { month: k, revenue: 0, cost: 0, net: 0, txn: 0 }; map.set(k, r); }
      return r;
    };
    // Approximate per-month revenue using each booking's service_fee proportion
    const totalGuest = bookings.reduce((s, b) => s + Number(b.total_price || 0), 0);
    const ratioRev = totalGuest > 0 ? (hostly.serviceFees + hostly.commission) / totalGuest : 0;
    bookings.forEach(b => {
      if (!['confirmed', 'completed'].includes(b.status)) return;
      const r = ensure(monthKey(b.check_in_date));
      r.revenue += Number(b.total_price) * ratioRev;
      r.txn += 1;
      // estimated processing per booking
      r.cost += Number(b.total_price) * 0.029 + 0.30;
    });
    bookings.forEach(b => {
      if (b.refund_amount && Number(b.refund_amount) > 0) {
        const r = ensure(monthKey(b.check_in_date));
        r.cost += Number(b.refund_amount);
      }
    });
    platformExpenses.forEach(e => {
      const r = ensure(monthKey(e.expense_date));
      r.cost += Number(e.amount || 0);
    });
    const arr = Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
    arr.forEach(r => { r.net = r.revenue - r.cost; });
    return arr;
  }, [bookings, hostly, platformExpenses]);

  // ---- Revenue mix (donut-ish bar chart) ----------------------------
  const revenueMix = useMemo(() => ([
    { name: 'Service fees', value: Math.round(hostly.serviceFees * 100) / 100, fill: 'hsl(var(--gold))' },
    { name: 'Host commission', value: Math.round(hostly.commission * 100) / 100, fill: 'hsl(var(--burgundy))' },
    { name: 'Cancellation penalties', value: Math.round(hostly.penalties * 100) / 100, fill: 'hsl(var(--coral))' },
  ]), [hostly]);

  const costMix = useMemo(() => ([
    { name: 'Refunds issued', value: Math.round(hostly.refunds * 100) / 100, fill: 'hsl(var(--destructive))' },
    { name: 'Taxes payable', value: Math.round(hostly.taxesPayable * 100) / 100, fill: 'hsl(var(--burgundy))' },
    { name: 'Operating expenses', value: Math.round(hostly.operatingExpenses * 100) / 100, fill: 'hsl(var(--gold))' },
    { name: 'Payment processing', value: Math.round(hostly.processing * 100) / 100, fill: 'hsl(var(--sage))' },
  ]), [hostly]);

  /* ---- Combined "Download all" export (P&L + Balance Sheet + Cash Flow) ---- */
  const exportAllPdf = async () => {
    if (!canExportAll) { toast.error('Requires export_finance permission'); return; }

    const { pl, bs, cf } = buildHostivaStatements(hostly, totals);
    await exportAnnualReportPdf({
      startDate: from,
      endDate: to,
      currency: 'USD',
      pl, bs, cf,
      properties: [],
      fileName: `hostiva-annual-report-${from}-to-${to}.pdf`,
    });
    toast.success('Annual report exported');
  };

  return (
    <Tabs defaultValue="command" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList className="bg-cream/60 border border-gold/20">
          <TabsTrigger value="command" className="data-[state=active]:bg-paper data-[state=active]:shadow-sm">
            Command center
          </TabsTrigger>
          <TabsTrigger value="statements" className="data-[state=active]:bg-paper data-[state=active]:shadow-sm">
            Hostiva P&amp;L
          </TabsTrigger>
          <TabsTrigger value="balance" className="data-[state=active]:bg-paper data-[state=active]:shadow-sm">
            Hostiva Balance Sheet
          </TabsTrigger>
          <TabsTrigger value="cashflow" className="data-[state=active]:bg-paper data-[state=active]:shadow-sm">
            Hostiva Cash Flow
          </TabsTrigger>
        </TabsList>
        <Button
          size="sm"
          className="h-9 bg-burgundy hover:bg-burgundy/90 text-paper"
          onClick={exportAllPdf}
          disabled={!canExportAll}
          title="Download P&L + Balance Sheet + Cash Flow as a single branded PDF"
        >
          <Download className="w-4 h-4 mr-1.5" /> Download all (PDF)
        </Button>
      </div>

      {/* ============================================================ */}
      {/* COMMAND CENTER                                              */}
      {/* ============================================================ */}
      <TabsContent value="command" className="space-y-6">
        <HeroBanner
          loading={loading}
          netIncome={hostly.netIncome}
          grossRevenue={hostly.grossRevenue}
          totalCosts={hostly.totalCosts}
          margin={hostly.margin}
          period={`${from} → ${to}`}
          txnCount={hostly.txnCount}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="Service fees"
            value={fmt(hostly.serviceFees)}
            sub="Charged to guests"
            icon={BadgePercent}
            tone="gold"
          />
          <KpiCard
            label="Host commission"
            value={fmt(hostly.commission)}
            sub="Withheld from payouts"
            icon={Landmark}
            tone="burgundy"
          />
          <KpiCard
            label="Refunds issued"
            value={fmt(hostly.refunds)}
            sub="Reduces net income"
            icon={TrendingDown}
            tone="destructive"
          />
          <KpiCard
            label="Processing cost"
            value={fmt(hostly.processing)}
            sub="Est. 2.9% + $0.30/txn"
            icon={Coins}
            tone="sage"
          />
        </div>

        <Card className="border-gold/20 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <CardTitle className="font-editorial text-2xl tracking-tight text-ink">
                  Hostiva money flow
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Monthly platform revenue vs. costs and resulting net income.
                </p>
              </div>
              <div className="flex gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1.5"><Dot color="hsl(var(--gold))" /> Revenue</span>
                <span className="inline-flex items-center gap-1.5"><Dot color="hsl(var(--destructive))" /> Cost</span>
                <span className="inline-flex items-center gap-1.5"><Dot color="hsl(var(--burgundy))" /> Net</span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-72 w-full" />
            ) : trend.length === 0 ? (
              <EmptyState message="No platform activity in this period." />
            ) : (
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={trend} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="goldArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--gold))" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="hsl(var(--gold))" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="redArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.30} />
                        <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--rule))" />
                    <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11}
                      tickFormatter={(v) => v >= 1000 ? `$${(v/1000).toFixed(0)}k` : `$${v.toFixed(0)}`} />
                    <RTooltip
                      contentStyle={{
                        background: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 10,
                        fontSize: 12,
                      }}
                      formatter={(v: any) => fmt(Number(v))}
                    />
                    <Area type="monotone" dataKey="revenue" name="Revenue" stroke="hsl(var(--gold))" fill="url(#goldArea)" strokeWidth={2} />
                    <Area type="monotone" dataKey="cost" name="Cost" stroke="hsl(var(--destructive))" fill="url(#redArea)" strokeWidth={2} />
                    <Line type="monotone" dataKey="net" name="Net" stroke="hsl(var(--burgundy))" strokeWidth={2.5} dot={{ r: 3, fill: 'hsl(var(--burgundy))' }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border-gold/20 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="font-editorial text-xl text-ink">Revenue composition</CardTitle>
              <p className="text-xs text-muted-foreground">Where Hostiva earns</p>
            </CardHeader>
            <CardContent>
              <MixChart data={revenueMix} loading={loading} total={hostly.grossRevenue} />
            </CardContent>
          </Card>
          <Card className="border-gold/20 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="font-editorial text-xl text-ink">Cost composition</CardTitle>
              <p className="text-xs text-muted-foreground">Where Hostiva spends</p>
            </CardHeader>
            <CardContent>
              <MixChart data={costMix} loading={loading} total={hostly.totalCosts} />
            </CardContent>
          </Card>
        </div>

        {/* Pass-through note */}
        <Card className="bg-cream/40 border-gold/30">
          <CardContent className="p-4 flex items-start gap-3">
            <Sparkles className="w-4 h-4 text-gold mt-0.5 shrink-0" />
            <div className="text-xs text-ink/80 leading-relaxed">
              <strong>Excluded from Hostiva P&amp;L:</strong> guest cleaning fees ({fmt(totals.cleaningRevenue)})
              and host payouts ({fmt(totals.hostPayouts)}) — these flow through Hostiva accounts but are
              not Hostiva income or expense.
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ============================================================ */}
      {/* HOSTIVA P&L STATEMENT                                        */}
      {/* ============================================================ */}
      <TabsContent value="statements">
        <HostivaPnlStatement
          from={from} to={to}
          hostly={hostly}
          totals={totals}
          platformExpenses={platformExpenses}
          onExpensesChanged={() => setRefreshKey(k => k + 1)}
        />
      </TabsContent>

      {/* ============================================================ */}
      {/* HOSTIVA BALANCE SHEET                                        */}
      {/* ============================================================ */}
      <TabsContent value="balance">
        <HostivaBalanceSheet from={from} to={to} hostly={hostly} totals={totals} />
      </TabsContent>

      {/* ============================================================ */}
      {/* HOSTIVA CASH FLOW                                            */}
      {/* ============================================================ */}
      <TabsContent value="cashflow">
        <HostivaCashFlow from={from} to={to} hostly={hostly} totals={totals} />
      </TabsContent>
    </Tabs>
  );
}

/* ------------------------------------------------------------------ */
/* Hero banner                                                        */
/* ------------------------------------------------------------------ */

function HeroBanner({
  loading, netIncome, grossRevenue, totalCosts, margin, period, txnCount,
}: {
  loading: boolean;
  netIncome: number; grossRevenue: number; totalCosts: number; margin: number;
  period: string; txnCount: number;
}) {
  const positive = netIncome >= 0;
  return (
    <Card className="overflow-hidden border-0 shadow-lg">
      <div
        className="relative px-6 py-7 sm:px-8 sm:py-9"
        style={{
          background:
            'linear-gradient(135deg, hsl(var(--burgundy)) 0%, hsl(var(--ink)) 60%, hsl(350 35% 18%) 100%)',
        }}
      >
        <div
          className="absolute inset-0 opacity-30"
          style={{
            background:
              'radial-gradient(800px 240px at 90% 0%, hsl(var(--gold) / 0.5), transparent 60%), radial-gradient(600px 200px at 0% 100%, hsl(var(--gold) / 0.25), transparent 60%)',
          }}
        />
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Badge className="bg-gold/20 text-gold border-gold/40 hover:bg-gold/30">
                <Wallet className="w-3 h-3 mr-1" /> Hostiva P&amp;L · {period}
              </Badge>
              <h2 className="font-editorial text-3xl sm:text-4xl text-paper mt-3 tracking-tight">
                Net income from platform operations
              </h2>
              <p className="text-paper/60 text-sm mt-1.5">
                Service fees and commission earned, minus refunds and payment-processing cost.
              </p>
            </div>
            <Badge variant="outline" className="bg-paper/10 text-paper border-paper/20 backdrop-blur">
              {txnCount} successful bookings
            </Badge>
          </div>

          <div className="mt-7 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              {loading ? (
                <Skeleton className="h-16 w-64 bg-paper/10" />
              ) : (
                <>
                  <div className="text-paper/60 text-xs uppercase tracking-wider">Net income</div>
                  <div className={`font-editorial text-5xl sm:text-6xl mt-1 ${positive ? 'text-gold' : 'text-coral'}`}>
                    {fmt(netIncome)}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge className={positive ? 'bg-gold/20 text-gold border-gold/40' : 'bg-destructive/20 text-coral border-destructive/40'}>
                      {positive ? <ArrowUpRight className="w-3 h-3 mr-1" /> : <ArrowDownRight className="w-3 h-3 mr-1" />}
                      {(margin * 100).toFixed(1)}% margin
                    </Badge>
                  </div>
                </>
              )}
            </div>
            <HeroStat label="Gross revenue" value={fmt(grossRevenue)} accent="text-gold" />
            <HeroStat label="Total costs" value={fmt(totalCosts)} accent="text-coral" />
          </div>
        </div>
      </div>
    </Card>
  );
}

function HeroStat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="border-l border-paper/15 pl-4">
      <div className="text-paper/60 text-[11px] uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${accent}`}>{value}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* KPI card                                                           */
/* ------------------------------------------------------------------ */

const TONES = {
  gold: { ring: 'border-gold/30', icon: 'text-gold', glow: 'bg-gold-soft/40' },
  burgundy: { ring: 'border-burgundy/30', icon: 'text-burgundy', glow: 'bg-burgundy/5' },
  destructive: { ring: 'border-destructive/30', icon: 'text-destructive', glow: 'bg-destructive/5' },
  sage: { ring: 'border-sage/30', icon: 'text-sage', glow: 'bg-sage/5' },
} as const;

function KpiCard({
  label, value, sub, icon: Icon, tone,
}: { label: string; value: string; sub: string; icon: any; tone: keyof typeof TONES }) {
  const t = TONES[tone];
  return (
    <Card className={`group relative overflow-hidden ${t.ring} hover:shadow-md transition-all`}>
      <div className={`absolute -top-12 -right-12 w-40 h-40 rounded-full ${t.glow} blur-2xl opacity-70 group-hover:opacity-100 transition-opacity`} />
      <CardContent className="relative p-5">
        <div className="flex items-start justify-between">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</span>
          <Icon className={`w-4 h-4 ${t.icon}`} />
        </div>
        <div className="font-editorial text-3xl text-ink mt-3 tracking-tight">{value}</div>
        <div className="text-[11px] text-muted-foreground mt-1.5">{sub}</div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Mix chart (horizontal bars with totals)                            */
/* ------------------------------------------------------------------ */

function MixChart({ data, loading, total }: { data: { name: string; value: number; fill: string }[]; loading: boolean; total: number }) {
  if (loading) return <Skeleton className="h-48" />;
  if (total <= 0) return <EmptyState message="No data to display." />;
  return (
    <div className="space-y-4">
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--rule))" horizontal={false} />
            <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11}
              tickFormatter={(v) => v >= 1000 ? `$${(v/1000).toFixed(0)}k` : `$${v.toFixed(0)}`} />
            <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} width={130} />
            <RTooltip
              contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
              formatter={(v: any) => fmt(Number(v))}
            />
            <Bar dataKey="value" radius={[0, 8, 8, 0]}>
              {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-1.5">
        {data.map(d => {
          const pct = total > 0 ? (d.value / total) * 100 : 0;
          return (
            <div key={d.name} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: d.fill }} />
                <span className="text-ink">{d.name}</span>
              </span>
              <span className="tabular-nums text-muted-foreground">
                {fmt(d.value)} <span className="text-ink/40">· {pct.toFixed(1)}%</span>
              </span>
            </div>
          );
        })}
        <div className="flex items-center justify-between pt-2 border-t border-rule mt-2">
          <span className="text-xs font-semibold text-ink uppercase tracking-wider">Total</span>
          <span className="text-sm font-bold tabular-nums text-ink">{fmt(total)}</span>
        </div>
      </div>
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span className="w-2 h-2 rounded-full inline-block" style={{ background: color }} />;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="w-12 h-12 rounded-full bg-cream flex items-center justify-center mb-3">
        <Receipt className="w-5 h-5 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

/* ================================================================== */
/* HOSTIVA P&L STATEMENT                                              */
/* ================================================================== */

interface StatementLine { label: string; amount?: number; bold?: boolean; sub?: boolean; positive?: boolean; negative?: boolean }

interface PlatformExpenseRow {
  id: string; category: string; description: string; amount: number;
  currency: string; expense_date: string; vendor: string | null;
}

function HostivaPnlStatement({
  from, to, hostly, totals, platformExpenses, onExpensesChanged,
}: {
  from: string; to: string;
  hostly: ReturnType<typeof computeHostiva>;
  totals: FinanceConsoleProps['totals'];
  platformExpenses: PlatformExpenseRow[];
  onExpensesChanged: () => void;
}) {
  const { user } = useAuth();
  const canExport = useHasPermission('export_finance');
  const canApprove = useHasPermission('approve_finance');

  const [stmtFrom, setStmtFrom] = useState(from);
  const [stmtTo, setStmtTo] = useState(to);
  useEffect(() => { setStmtFrom(from); }, [from]);
  useEffect(() => { setStmtTo(to); }, [to]);

  const [displayCcy, setDisplayCcy] = useState('USD');
  const [fxRate, setFxRate] = useState<string>('1');
  const fx = useMemo(() => {
    const n = Number(fxRate);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }, [fxRate]);
  const conv = (usd: number) => usd * fx;
  const fmtD = (usd: number) => fmt(conv(usd), displayCcy);

  const [approvals, setApprovals] = useState<{ id: string; created_at: string; period_from: string; period_to: string; display_currency: string; notes: string | null }[]>([]);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approvalNotes, setApprovalNotes] = useState('');
  const [submittingApproval, setSubmittingApproval] = useState(false);
  const [allApprovedRanges, setAllApprovedRanges] = useState<{ period_from: string; period_to: string }[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('finance_statement_approvals' as any)
        .select('*')
        .eq('period_from', stmtFrom)
        .eq('period_to', stmtTo)
        .order('created_at', { ascending: false });
      if (active) setApprovals((data as any) ?? []);
    })();
    return () => { active = false; };
  }, [stmtFrom, stmtTo]);

  // Load every approved period so we can lock individual expense rows
  // whose date falls inside any approved range (not just the current view).
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('finance_statement_approvals' as any)
        .select('period_from, period_to');
      if (active) setAllApprovedRanges((data as any) ?? []);
    })();
    return () => { active = false; };
  }, [approvals.length]);

  const periodLabel = `${stmtFrom} to ${stmtTo}`;
  const ccyLabel = displayCcy === 'USD' ? 'USD' : `${displayCcy} (FX ${fx})`;

  const lines: StatementLine[] = [
    { label: 'INCOME', bold: true },
    { label: 'Service fees collected', amount: hostly.serviceFees, sub: true, positive: true },
    { label: 'Host commission collected', amount: hostly.commission, sub: true, positive: true },
    { label: 'Cancellation penalties (host-cancel fines)', amount: hostly.penalties, sub: true, positive: true },
    { label: 'Gross income', amount: hostly.grossRevenue, bold: true, positive: true },
    { label: ' ' },
    { label: 'EXPENSES', bold: true },
    { label: 'Taxes payable (VAT/GST on fees & commission)', amount: -hostly.taxesPayable, sub: true, negative: hostly.taxesPayable > 0 },
    { label: 'Hosting & operating expenses', amount: -hostly.operatingExpenses, sub: true, negative: hostly.operatingExpenses > 0 },
    { label: 'Refunds issued to guests', amount: -hostly.refunds, sub: true, negative: hostly.refunds > 0 },
    { label: 'Payment processing (est.)', amount: -hostly.processing, sub: true, negative: hostly.processing > 0 },
    { label: 'Total expenses', amount: -hostly.totalCosts, bold: true, negative: hostly.totalCosts > 0 },
    { label: ' ' },
    { label: 'NET INCOME', amount: hostly.netIncome, bold: true, positive: hostly.netIncome >= 0, negative: hostly.netIncome < 0 },
  ];

  const memos: StatementLine[] = [
    { label: 'Gross booking value (GMV)', amount: totals.grossBookingValue + totals.cleaningRevenue, sub: true },
    { label: 'Total guest payments (in-flow)', amount: totals.guestPaid, sub: true },
    { label: 'Total host payouts (pass-through)', amount: totals.hostPayouts, sub: true },
    { label: 'Cleaning fees (pass-through)', amount: totals.cleaningRevenue, sub: true },
    { label: 'Net margin', amount: hostly.margin * 100, sub: true },
  ];

  /* ---- Exports ---- */

  const exportCsv = () => {
    if (!canExport) { toast.error('Requires export_finance permission'); return; }
    const out: string[] = [
      'Hostiva Profit & Loss Statement',
      `Period,${periodLabel}`,
      `Display currency,${ccyLabel}`,
      `Generated,${new Date().toISOString()}`,
      '',
      `Line,Amount (${displayCcy})`,
      ...lines.map(l => l.label.trim() === '' ? '' : `${csvEscape(l.label)},${l.amount != null ? conv(l.amount).toFixed(2) : ''}`),
      '',
      'MEMO ITEMS (NOT IN P&L)',
      `Line,Amount (${displayCcy})`,
      ...memos.map(l => `${csvEscape(l.label)},${l.amount != null ? (l.label === 'Net margin' ? l.amount.toFixed(2) + '%' : conv(l.amount).toFixed(2)) : ''}`),
    ];
    downloadBlob(`hostly-pnl-${stmtFrom}-to-${stmtTo}.csv`, new Blob([out.join('\n')], { type: 'text/csv;charset=utf-8' }));
    toast.success('CSV exported');
  };

  const exportXlsx = async () => {
    if (!canExport) { toast.error('Requires export_finance permission'); return; }
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Line', `Amount (${displayCcy})`],
      ...lines.filter(l => l.label.trim() !== '').map(l => [l.label, l.amount != null ? Number(conv(l.amount).toFixed(2)) as any : '']),
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, 'Hostiva P&L');
    const memoSheet = XLSX.utils.aoa_to_sheet([
      ['Memo item', `Amount (${displayCcy})`],
      ...memos.map(l => [l.label, l.amount != null ? Number(conv(l.amount).toFixed(2)) as any : '']),
    ]);
    XLSX.utils.book_append_sheet(wb, memoSheet, 'Memo (pass-through)');
    const cover = XLSX.utils.aoa_to_sheet([
      ['Hostiva Profit & Loss Statement'],
      ['Period', periodLabel],
      ['Display currency', ccyLabel],
      ['Generated', new Date().toISOString()],
    ]);
    XLSX.utils.book_append_sheet(wb, cover, 'Cover');
    XLSX.writeFile(wb, `hostly-pnl-${stmtFrom}-to-${stmtTo}.xlsx`);
    toast.success('Excel exported');
  };

  const exportPdf = async () => {
    if (!canExport) { toast.error('Requires export_finance permission'); return; }
    const { pl } = buildHostivaStatements(hostly, totals);
    await exportAnnualReportPdf({
      startDate: stmtFrom,
      endDate: stmtTo,
      currency: displayCcy,
      pl, bs: null, cf: null,
      properties: [],
      fileName: `hostiva-pnl-${stmtFrom}-to-${stmtTo}.pdf`,
    });
    toast.success('PDF exported');
  };

  const submitApproval = async () => {
    if (!canApprove || !user) { toast.error('Requires approve_finance permission'); return; }
    setSubmittingApproval(true);
    const totalsSnapshot = {
      hostly: { ...hostly },
      displayCcy, fxRate: fx,
    };
    const { error, data } = await supabase
      .from('finance_statement_approvals' as any)
      .insert({
        approver_id: user.id,
        period_from: stmtFrom,
        period_to: stmtTo,
        view_type: 'hostly',
        display_currency: displayCcy,
        totals_snapshot: totalsSnapshot,
        notes: approvalNotes || null,
      })
      .select()
      .single();
    setSubmittingApproval(false);
    if (error) { toast.error(error.message); return; }
    setApprovals([data as any, ...approvals]);
    setApprovalOpen(false);
    setApprovalNotes('');
    toast.success('Statement approved & signed off');
  };

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <Card className="border-gold/20 shadow-sm">
        <CardHeader className="pb-3 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="font-editorial text-2xl text-ink">Hostiva Profit &amp; Loss</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Platform-only — Hostiva's revenue and direct costs. Period{' '}
                <span className="font-mono">{stmtFrom}</span> → <span className="font-mono">{stmtTo}</span> · {ccyLabel}
              </p>
            </div>
            {approvals.length > 0 ? (
              <Badge className="bg-sage/15 text-sage border-sage/40 hover:bg-sage/20">
                <CheckCircle2 className="w-3 h-3 mr-1" /> Approved {new Date(approvals[0].created_at).toLocaleDateString()}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground border-dashed">
                <Lock className="w-3 h-3 mr-1" /> Awaiting sign-off
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">From</Label>
              <Input type="date" value={stmtFrom} onChange={e => setStmtFrom(e.target.value)} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">To</Label>
              <Input type="date" value={stmtTo} onChange={e => setStmtTo(e.target.value)} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Currency</Label>
              <Select value={displayCcy} onValueChange={(v) => { setDisplayCcy(v); if (v === 'USD') setFxRate('1'); }}>
                <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent className="z-[60]">
                  {['USD','EUR','GBP','KES','UGX','TZS','ZAR','NGN','GHS','INR','AED','JPY','CNY','CAD','AUD'].map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">FX (USD → {displayCcy})</Label>
              <Input
                type="number" step="0.0001" min="0"
                value={fxRate} onChange={e => setFxRate(e.target.value)}
                disabled={displayCcy === 'USD'}
                className="h-9 mt-1 font-mono"
              />
            </div>
            <div className="col-span-2 flex items-end gap-2 flex-wrap justify-end">
              <Button variant="outline" size="sm" className="h-9 border-gold/40 hover:bg-gold-soft/40" onClick={exportCsv} disabled={!canExport}>
                <Download className="w-4 h-4 mr-1.5" /> CSV
              </Button>
              <Button variant="outline" size="sm" className="h-9 border-gold/40 hover:bg-gold-soft/40" onClick={exportXlsx} disabled={!canExport}>
                <FileSpreadsheet className="w-4 h-4 mr-1.5" /> Excel
              </Button>
              <Button size="sm" className="h-9 bg-burgundy hover:bg-burgundy/90 text-paper" onClick={exportPdf} disabled={!canExport}>
                <FileText className="w-4 h-4 mr-1.5" /> PDF
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-3 border-t border-rule">
            <p className="text-[11px] text-muted-foreground">
              Sign-off creates an immutable approval record for this period.
            </p>
            <Button
              size="sm"
              variant={approvals.length > 0 ? 'outline' : 'default'}
              className={approvals.length > 0 ? '' : 'bg-gold hover:bg-gold/90 text-ink'}
              onClick={() => setApprovalOpen(true)} disabled={!canApprove}
            >
              <ShieldCheck className="w-4 h-4 mr-1.5" />
              {approvals.length > 0 ? 'Add new approval' : 'Approve & sign off'}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Statement card */}
      <Card className="border-gold/20 shadow-md overflow-hidden">
        <div className="border-b border-rule px-6 py-5 bg-cream/40">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-editorial text-xl text-ink">Statement of Operations</h3>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mt-1">
                {periodLabel} · {displayCcy}
              </p>
            </div>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Net income</div>
              <div className={`font-editorial text-3xl ${hostly.netIncome >= 0 ? 'text-burgundy' : 'text-destructive'}`}>
                {fmtD(hostly.netIncome)}
              </div>
            </div>
          </div>
        </div>
        <CardContent className="p-0">
          <table className="w-full">
            <tbody>
              {lines.map((l, i) => {
                if (l.label.trim() === '') return <tr key={i}><td className="h-3" /></tr>;
                const isHeader = l.bold && !l.amount && !l.sub && (l.label === 'REVENUE' || l.label === 'COSTS');
                if (isHeader) {
                  return (
                    <tr key={i}>
                      <td colSpan={2} className="px-6 pt-4 pb-2 text-[10px] uppercase tracking-[0.18em] text-burgundy font-semibold border-t border-rule">
                        {l.label}
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={i} className={l.bold ? 'bg-cream/30' : ''}>
                    <td className={`px-6 py-2.5 ${l.sub ? 'pl-10 text-sm text-ink/80' : 'text-sm font-semibold text-ink'}`}>
                      {l.label}
                    </td>
                    <td className={`px-6 py-2.5 text-right tabular-nums ${l.bold ? 'text-base font-bold' : 'text-sm'} ${
                      l.negative ? 'text-destructive' : l.positive ? 'text-burgundy' : 'text-ink'
                    }`}>
                      {l.amount == null ? '' : fmtD(l.amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Memo items */}
      <Card className="border-rule">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 text-ink">
            <Sparkles className="w-3.5 h-3.5 text-gold" /> Memo items — pass-through (not Hostiva income or expense)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full">
            <tbody>
              {memos.map((l, i) => (
                <tr key={i} className="border-t border-rule first:border-0">
                  <td className="px-6 py-2 text-xs text-muted-foreground">{l.label}</td>
                  <td className="px-6 py-2 text-xs text-right tabular-nums text-ink">
                    {l.amount == null ? '' : (l.label === 'Net margin' ? `${l.amount.toFixed(2)}%` : fmtD(l.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Operating expenses (admin-managed) */}
      <PlatformExpensesPanel
        expenses={platformExpenses}
        from={stmtFrom}
        to={stmtTo}
        fmtD={fmtD}
        onChanged={onExpensesChanged}
        canEdit={canApprove}
        approvedRanges={allApprovedRanges}
      />

      {/* Approvals history */}
      {approvals.length > 0 && (
        <Card className="border-sage/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-ink">
              <ShieldCheck className="w-4 h-4 text-sage" /> Approval history for this period
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full">
              <tbody>
                {approvals.map(a => (
                  <tr key={a.id} className="border-t border-rule first:border-0">
                    <td className="px-6 py-2 text-xs text-foreground dark:text-foreground">{new Date(a.created_at).toLocaleString()}</td>
                    <td className="px-6 py-2 text-xs text-foreground dark:text-foreground">{a.display_currency}</td>
                    <td className="px-6 py-2 text-xs text-muted-foreground dark:text-muted-foreground">{a.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Dialog open={approvalOpen} onOpenChange={setApprovalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve &amp; sign off Hostiva P&amp;L</DialogTitle>
            <DialogDescription>
              Signing off the Hostiva P&amp;L for period{' '}
              <span className="font-mono">{stmtFrom} → {stmtTo}</span> in <strong>{displayCcy}</strong>
              {displayCcy !== 'USD' && <> at FX <strong>{fx}</strong></>}.
              This creates an immutable record with your user id.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label className="text-xs">Approval notes (optional)</Label>
            <Textarea
              value={approvalNotes} onChange={e => setApprovalNotes(e.target.value)}
              placeholder="e.g. Reviewed against bank statements and Stripe payouts."
              className="mt-1.5"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApprovalOpen(false)}>Cancel</Button>
            <Button onClick={submitApproval} disabled={submittingApproval} className="bg-gold hover:bg-gold/90 text-ink">
              <ShieldCheck className="w-4 h-4 mr-1.5" />
              {submittingApproval ? 'Recording…' : 'Record approval'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// shared shape from main component (kept exported-typed via inference)
function computeHostiva(): {
  serviceFees: number; commission: number; penalties: number;
  taxesPayable: number; operatingExpenses: number;
  grossRevenue: number; refunds: number; processing: number;
  totalCosts: number; netIncome: number; margin: number; txnCount: number;
} {
  return {
    serviceFees: 0, commission: 0, penalties: 0,
    taxesPayable: 0, operatingExpenses: 0,
    grossRevenue: 0, refunds: 0, processing: 0,
    totalCosts: 0, netIncome: 0, margin: 0, txnCount: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Build IncomeStatement / BalanceSheet / CashFlowStatement objects   */
/* from Hostiva-derived totals so we can reuse the branded             */
/* exportAnnualReportPdf layout (matches the reference annual report). */
/* ------------------------------------------------------------------ */
function makeRow(name: string, code: string, amount: number, type: AccountBalance['type']): AccountBalance {
  const bal = new Decimal(amount);
  const debit = type === 'asset' || type === 'expense' ? (bal.gte(0) ? bal : new Decimal(0)) : new Decimal(0);
  const credit = type === 'asset' || type === 'expense' ? (bal.lt(0) ? bal.abs() : new Decimal(0)) : (bal.gte(0) ? bal : new Decimal(0));
  return { account_id: code, code, name, type, debit, credit, balance: bal };
}

function buildHostivaStatements(
  hostly: ReturnType<typeof computeHostiva>,
  totals: { guestPaid: number; hostPayouts: number; [k: string]: number | undefined } | any,
): { pl: IncomeStatement; bs: BalanceSheet; cf: CashFlowStatement } {
  // P&L
  const revenueRows: AccountBalance[] = [
    makeRow('Service fees collected', '4100', hostly.serviceFees, 'revenue'),
    makeRow('Host commission collected', '4200', hostly.commission, 'revenue'),
    makeRow('Cancellation penalties', '4300', hostly.penalties, 'revenue'),
  ].filter(r => !r.balance.eq(0));
  const expenseRows: AccountBalance[] = [
    makeRow('Taxes payable (VAT/GST)', '6100', hostly.taxesPayable, 'expense'),
    makeRow('Hosting & operating expenses', '6200', hostly.operatingExpenses, 'expense'),
    makeRow('Refunds issued to guests', '6300', hostly.refunds, 'expense'),
    makeRow('Payment processing (est.)', '6400', hostly.processing, 'expense'),
  ].filter(r => !r.balance.eq(0));
  const totalRevenue = new Decimal(hostly.grossRevenue);
  const totalExpenses = new Decimal(hostly.totalCosts);
  const netIncome = new Decimal(hostly.netIncome);
  const pl: IncomeStatement = { revenueRows, expenseRows, totalRevenue, totalExpenses, netIncome };

  // Balance sheet
  const cashOnHand =
    (totals.guestPaid ?? 0) - (totals.hostPayouts ?? 0) - hostly.refunds - hostly.processing - hostly.operatingExpenses;
  const assetRows: AccountBalance[] = [
    makeRow('Cash & cash equivalents', '1000', cashOnHand, 'asset'),
  ].filter(r => !r.balance.eq(0));
  const liabilityRows: AccountBalance[] = [
    makeRow('Taxes payable (VAT/GST)', '2200', hostly.taxesPayable, 'liability'),
  ].filter(r => !r.balance.eq(0));
  const equityRows: AccountBalance[] = [];
  const totalAssets = new Decimal(cashOnHand);
  const totalLiabilities = new Decimal(hostly.taxesPayable);
  const currentEarnings = new Decimal(hostly.netIncome);
  const totalEquity = currentEarnings;
  const bs: BalanceSheet = {
    assetRows, liabilityRows, equityRows,
    totalAssets, totalLiabilities, totalEquity, currentEarnings,
    isBalanced: totalAssets.minus(totalLiabilities.plus(totalEquity)).abs().lessThan(0.01),
  };

  // Cash flow
  const operatingCash = new Decimal(hostly.netIncome);
  const cf: CashFlowStatement = {
    netIncome: new Decimal(hostly.netIncome),
    depreciation: new Decimal(0),
    operatingCash,
    investingCash: new Decimal(0),
    financingCash: new Decimal(0),
    netChange: operatingCash,
  };

  return { pl, bs, cf };
}

/* ================================================================== */
/* PLATFORM EXPENSES PANEL — admin-managed Hostiva operating costs    */
/* ================================================================== */

const EXPENSE_CATEGORIES = [
  'Hosting & infrastructure',
  'Salaries & contractors',
  'Marketing & advertising',
  'Software & SaaS',
  'Legal & professional',
  'Office & admin',
  'Banking & FX',
  'Other',
];

function PlatformExpensesPanel({
  expenses, from, to, fmtD, onChanged, canEdit, approvedRanges,
}: {
  expenses: PlatformExpenseRow[];
  from: string; to: string;
  fmtD: (n: number) => string;
  onChanged: () => void;
  canEdit: boolean;
  approvedRanges: { period_from: string; period_to: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    category: EXPENSE_CATEGORIES[0],
    description: '',
    amount: '',
    expense_date: new Date().toISOString().slice(0, 10),
    vendor: '',
  });
  const total = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);

  const isDateLocked = (iso: string) =>
    approvedRanges.some(r => iso >= r.period_from && iso <= r.period_to);
  const formDateLocked = isDateLocked(form.expense_date);

  const resetForm = () => {
    setForm({
      category: EXPENSE_CATEGORIES[0],
      description: '',
      amount: '',
      expense_date: new Date().toISOString().slice(0, 10),
      vendor: '',
    });
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    setOpen(true);
  };

  const openEdit = (e: PlatformExpenseRow) => {
    setEditingId(e.id);
    setForm({
      category: e.category,
      description: e.description,
      amount: String(e.amount ?? ''),
      expense_date: e.expense_date,
      vendor: e.vendor ?? '',
    });
    setOpen(true);
  };

  // Friendly translation of the server-side period-lock trigger errors.
  // The trigger raises SQLSTATE 42501 with messages containing "approved P&L period".
  const friendlyLockError = (err: { code?: string; message?: string } | null | undefined): string | null => {
    if (!err) return null;
    const msg = err.message ?? '';
    if (err.code === '42501' || /approved P&L period|approved and locked|cannot be (edited|deleted)/i.test(msg)) {
      return 'This expense date is inside an approved P&L period and is locked. Approved periods are read-only — pick a date outside any approved period or have a finance officer record a new approval.';
    }
    return msg || 'Something went wrong. Please try again.';
  };

  const submit = async () => {
    if (!canEdit) {
      toast.error('You don\'t have permission to record platform expenses'); return;
    }
    if (!form.description.trim() || !form.amount) {
      toast.error('Description and amount are required'); return;
    }
    if (formDateLocked) {
      toast.error('Locked period', {
        description: 'That date falls inside an approved P&L period and cannot be edited. Choose a date outside any approved period.',
      });
      return;
    }
    setSaving(true);
    const payload = {
      category: form.category,
      description: form.description.trim(),
      amount: Number(form.amount),
      expense_date: form.expense_date,
      vendor: form.vendor.trim() || null,
    };
    const { error } = editingId
      ? await supabase.from('platform_expenses' as any).update(payload as any).eq('id', editingId)
      : await supabase.from('platform_expenses' as any).insert({ ...payload, currency: 'USD' } as any);
    setSaving(false);
    if (error) {
      const friendly = friendlyLockError(error);
      if (error.code === '42501' || /approved P&L period|approved and locked/i.test(error.message ?? '')) {
        toast.error('Locked period', { description: friendly ?? undefined });
      } else {
        toast.error(friendly ?? 'Save failed');
      }
      return;
    }
    toast.success(editingId ? 'Expense updated' : 'Expense recorded');
    resetForm();
    setOpen(false);
    onChanged();
  };

  const remove = async (id: string, expense_date: string) => {
    if (!canEdit) {
      toast.error('You don\'t have permission to delete platform expenses'); return;
    }
    if (isDateLocked(expense_date)) {
      toast.error('Locked period', {
        description: 'This expense falls inside an approved P&L period and cannot be deleted.',
      });
      return;
    }
    const { error } = await supabase.from('platform_expenses' as any).delete().eq('id', id);
    if (error) {
      const friendly = friendlyLockError(error);
      if (error.code === '42501' || /approved P&L period|approved and locked/i.test(error.message ?? '')) {
        toast.error('Locked period', { description: friendly ?? undefined });
      } else {
        toast.error(friendly ?? 'Delete failed');
      }
      return;
    }
    toast.success('Expense removed');
    onChanged();
  };

  return (
    <Card className="border-rule">
      <CardHeader className="pb-2 flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm flex items-center gap-2 text-ink">
          <Building2 className="w-3.5 h-3.5 text-burgundy" />
          Hosting & operating expenses ({from} → {to})
        </CardTitle>
        {canEdit ? (
          <Button size="sm" variant="outline" className="h-8" onClick={openCreate}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add expense
          </Button>
        ) : (
          <Badge
            variant="outline"
            className="h-7 text-[10px] uppercase tracking-wider border-muted-foreground/30 text-muted-foreground"
            title="Only finance officers and admins can edit platform operating expenses"
          >
            <Lock className="w-3 h-3 mr-1" /> View only
          </Badge>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {expenses.length === 0 ? (
          <p className="px-6 py-4 text-xs text-muted-foreground">
            No operating expenses recorded for this period. Add hosting, salaries, marketing, taxes paid, etc.
          </p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-rule">
                <th className="px-6 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Date</th>
                <th className="px-6 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Category</th>
                <th className="px-6 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Description</th>
                <th className="px-6 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Vendor</th>
                <th className="px-6 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Amount</th>
                {canEdit && <th className="w-12" />}
              </tr>
            </thead>
            <tbody>
              {expenses.map(e => (
                <tr key={e.id} className="border-t border-rule">
                  <td className="px-6 py-2 text-xs text-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      {e.expense_date}
                      {isDateLocked(e.expense_date) && (
                        <Lock className="w-3 h-3 text-muted-foreground" aria-label="Locked by approval" />
                      )}
                    </span>
                  </td>
                  <td className="px-6 py-2 text-xs text-foreground">{e.category}</td>
                  <td className="px-6 py-2 text-xs text-foreground">{e.description}</td>
                  <td className="px-6 py-2 text-xs text-muted-foreground">{e.vendor || '—'}</td>
                  <td className="px-6 py-2 text-xs text-right tabular-nums text-destructive">{fmtD(Number(e.amount))}</td>
                  {canEdit && (
                    <td className="pr-3 whitespace-nowrap">
                      <Button
                        size="sm" variant="ghost" className="h-7 w-7 p-0"
                        onClick={() => openEdit(e)}
                        disabled={isDateLocked(e.expense_date)}
                        title={isDateLocked(e.expense_date) ? 'Locked: period approved' : 'Edit'}
                      >
                        <Pencil className="w-3.5 h-3.5 text-foreground" />
                      </Button>
                      <Button
                        size="sm" variant="ghost" className="h-7 w-7 p-0"
                        onClick={() => remove(e.id, e.expense_date)}
                        disabled={isDateLocked(e.expense_date)}
                        title={isDateLocked(e.expense_date) ? 'Locked: period approved' : 'Delete'}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
              <tr className="border-t border-rule bg-cream/30">
                <td colSpan={4} className="px-6 py-2 text-xs font-semibold text-ink">Total operating expenses</td>
                <td className="px-6 py-2 text-sm text-right tabular-nums font-bold text-destructive">{fmtD(total)}</td>
                {canEdit && <td />}
              </tr>
            </tbody>
          </table>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit operating expense' : 'Add operating expense'}</DialogTitle>
            <DialogDescription>
              Records a Hostiva-side cost (hosting, salary, marketing, tax payment, etc.) that will appear in the P&amp;L.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent className="z-[60]">
                  {EXPENSE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="mt-1" placeholder="e.g. AWS December hosting" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Amount (USD)</Label>
                <Input type="number" step="0.01" min="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Date</Label>
                <Input type="date" value={form.expense_date} onChange={e => setForm({ ...form, expense_date: e.target.value })} className="mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Vendor (optional)</Label>
              <Input value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} className="mt-1" />
            </div>
            {formDateLocked && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <Lock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>
                  The selected date falls inside an approved P&amp;L period and is locked.
                  Pick a date outside any approved period to save.
                </span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving || formDateLocked} className="bg-burgundy hover:bg-burgundy/90 text-paper">
              {saving ? 'Saving…' : (editingId ? 'Save changes' : 'Record expense')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/* ================================================================== */
/* HOSTIVA BALANCE SHEET — derived from Hostiva-only economics        */
/* ================================================================== */

function HostivaBalanceSheet({
  from, to, hostly, totals,
}: {
  from: string; to: string;
  hostly: ReturnType<typeof computeHostiva>;
  totals: FinanceConsoleProps['totals'];
}) {
  const canExport = useHasPermission('export_finance');
  // Derive balance-sheet positions from period activity.
  // Cash on hand approximates: guest payments collected − host payouts − refunds − processing − opex.
  const cashOnHand =
    totals.guestPaid - totals.hostPayouts - hostly.refunds - hostly.processing - hostly.operatingExpenses;
  const accountsReceivable = 0; // Hostiva collects upfront via Stripe — typically nil
  const totalAssets = cashOnHand + accountsReceivable;

  // Liabilities: host payables (cleaning pass-through unbilled), taxes payable
  const hostPayable = 0; // already netted in cash above; kept for transparency
  const taxesPayable = hostly.taxesPayable;
  const totalLiabilities = hostPayable + taxesPayable;

  // Equity = retained earnings (period net income for this view)
  const retainedEarnings = hostly.netIncome;
  const totalEquity = retainedEarnings;

  const sections = [
    {
      title: 'ASSETS', tone: 'asset' as const,
      rows: [
        { label: 'Cash & cash equivalents', amount: cashOnHand },
        { label: 'Accounts receivable', amount: accountsReceivable },
      ],
      total: { label: 'Total Assets', amount: totalAssets },
    },
    {
      title: 'LIABILITIES', tone: 'liability' as const,
      rows: [
        { label: 'Host payables (pass-through)', amount: hostPayable },
        { label: 'Taxes payable (VAT/GST)', amount: taxesPayable },
      ],
      total: { label: 'Total Liabilities', amount: totalLiabilities },
    },
    {
      title: 'EQUITY', tone: 'equity' as const,
      rows: [
        { label: 'Retained earnings (period net income)', amount: retainedEarnings },
      ],
      total: { label: 'Total Equity', amount: totalEquity },
    },
  ];

  const toneClass = (t: 'asset' | 'liability' | 'equity') =>
    t === 'asset'
      ? 'bg-sky-50 text-sky-900 dark:bg-sky-950/30 dark:text-sky-200'
      : t === 'liability'
        ? 'bg-rose-50 text-rose-900 dark:bg-rose-950/30 dark:text-rose-200'
        : 'bg-violet-50 text-violet-900 dark:bg-violet-950/30 dark:text-violet-200';

  const exportPdf = async () => {
    if (!canExport) { toast.error('Requires export_finance permission'); return; }
    const { bs } = buildHostivaStatements(hostly, totals);
    await exportAnnualReportPdf({
      startDate: from,
      endDate: to,
      currency: 'USD',
      pl: null, bs, cf: null,
      properties: [],
      fileName: `hostiva-balance-sheet-as-of-${to}.pdf`,
    });
    toast.success('PDF exported');
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" className="h-9 bg-burgundy hover:bg-burgundy/90 text-paper" onClick={exportPdf} disabled={!canExport}>
          <FileText className="w-4 h-4 mr-1.5" /> Export PDF
        </Button>
      </div>
      <Card className="border-gold/20 shadow-md overflow-hidden">
        <div className="border-b border-rule px-6 py-5 bg-cream/40">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="font-editorial text-xl text-ink">Hostiva Balance Sheet</h3>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mt-1">
                As of {to}
              </p>
            </div>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Net assets</div>
              <div className="font-editorial text-2xl text-burgundy">{fmt(totalAssets - totalLiabilities)}</div>
            </div>
          </div>
        </div>
        <CardContent className="p-0">
          <table className="w-full">
            <tbody>
              {sections.map((sec, si) => (
                <>
                  <tr key={`h-${si}`}>
                    <td colSpan={2} className={`px-6 py-2 text-[11px] font-bold uppercase tracking-[0.18em] ${toneClass(sec.tone)}`}>
                      {sec.title}
                    </td>
                  </tr>
                  {sec.rows.map((r, i) => (
                    <tr key={`r-${si}-${i}`} className="border-t border-rule">
                      <td className="px-6 py-2.5 pl-10 text-sm text-ink/80">{r.label}</td>
                      <td className="px-6 py-2.5 text-right tabular-nums text-sm text-ink">{fmt(r.amount)}</td>
                    </tr>
                  ))}
                  <tr key={`t-${si}`} className="bg-cream/30 border-t border-rule">
                    <td className="px-6 py-2.5 text-sm font-semibold text-ink">{sec.total.label}</td>
                    <td className="px-6 py-2.5 text-right tabular-nums text-base font-bold text-burgundy">{fmt(sec.total.amount)}</td>
                  </tr>
                </>
              ))}
              <tr className="border-t-2 border-burgundy/40">
                <td className="px-6 py-3 text-sm font-bold text-ink">Liabilities + Equity</td>
                <td className="px-6 py-3 text-right tabular-nums text-base font-bold text-burgundy">
                  {fmt(totalLiabilities + totalEquity)}
                </td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card className="bg-cream/40 border-gold/30">
        <CardContent className="p-4 text-xs text-ink/80 leading-relaxed">
          <strong>Methodology:</strong> Cash on hand is derived from period inflows (guest payments) less
          outflows (host payouts, refunds, processing, operating expenses). Period: {from} → {to}.
        </CardContent>
      </Card>
    </div>
  );
}

/* ================================================================== */
/* HOSTIVA CASH FLOW — derived from Hostiva-only economics            */
/* ================================================================== */

function HostivaCashFlow({
  from, to, hostly, totals,
}: {
  from: string; to: string;
  hostly: ReturnType<typeof computeHostiva>;
  totals: FinanceConsoleProps['totals'];
}) {
  const canExport = useHasPermission('export_finance');
  // Operating activities
  const cashFromGuests = totals.guestPaid;
  const cashToHosts = -totals.hostPayouts;
  const refundsPaid = -hostly.refunds;
  const processingPaid = -hostly.processing;
  const opexPaid = -hostly.operatingExpenses;
  const taxesPaid = -hostly.taxesPayable;
  const netOperating =
    cashFromGuests + cashToHosts + refundsPaid + processingPaid + opexPaid + taxesPaid;

  // Investing & financing — none modeled; placeholders for transparency
  const netInvesting = 0;
  const netFinancing = 0;

  const netChange = netOperating + netInvesting + netFinancing;

  const sections = [
    {
      title: 'OPERATING ACTIVITIES', tone: 'income' as const,
      rows: [
        { label: 'Cash received from guests', amount: cashFromGuests },
        { label: 'Cash paid to hosts (payouts)', amount: cashToHosts },
        { label: 'Refunds paid', amount: refundsPaid },
        { label: 'Payment processing fees', amount: processingPaid },
        { label: 'Operating expenses paid', amount: opexPaid },
        { label: 'Taxes paid', amount: taxesPaid },
      ],
      total: { label: 'Net cash from operating activities', amount: netOperating },
    },
    {
      title: 'INVESTING ACTIVITIES', tone: 'asset' as const,
      rows: [
        { label: 'No investing activity', amount: 0 },
      ],
      total: { label: 'Net cash from investing activities', amount: netInvesting },
    },
    {
      title: 'FINANCING ACTIVITIES', tone: 'equity' as const,
      rows: [
        { label: 'No financing activity', amount: 0 },
      ],
      total: { label: 'Net cash from financing activities', amount: netFinancing },
    },
  ];

  const toneClass = (t: 'income' | 'asset' | 'equity') =>
    t === 'income'
      ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
      : t === 'asset'
        ? 'bg-sky-50 text-sky-900 dark:bg-sky-950/30 dark:text-sky-200'
        : 'bg-violet-50 text-violet-900 dark:bg-violet-950/30 dark:text-violet-200';

  const exportPdf = async () => {
    if (!canExport) { toast.error('Requires export_finance permission'); return; }
    const { cf } = buildHostivaStatements(hostly, totals);
    await exportAnnualReportPdf({
      startDate: from,
      endDate: to,
      currency: 'USD',
      pl: null, bs: null, cf,
      properties: [],
      fileName: `hostiva-cash-flow-${from}-to-${to}.pdf`,
    });
    toast.success('PDF exported');
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" className="h-9 bg-burgundy hover:bg-burgundy/90 text-paper" onClick={exportPdf} disabled={!canExport}>
          <FileText className="w-4 h-4 mr-1.5" /> Export PDF
        </Button>
      </div>
      <Card className="border-gold/20 shadow-md overflow-hidden">
        <div className="border-b border-rule px-6 py-5 bg-cream/40">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="font-editorial text-xl text-ink">Hostiva Cash Flow Statement</h3>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mt-1">
                For the period {from} → {to}
              </p>
            </div>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Net change in cash</div>
              <div className={`font-editorial text-2xl ${netChange >= 0 ? 'text-burgundy' : 'text-destructive'}`}>
                {fmt(netChange)}
              </div>
            </div>
          </div>
        </div>
        <CardContent className="p-0">
          <table className="w-full">
            <tbody>
              {sections.map((sec, si) => (
                <>
                  <tr key={`h-${si}`}>
                    <td colSpan={2} className={`px-6 py-2 text-[11px] font-bold uppercase tracking-[0.18em] ${toneClass(sec.tone)}`}>
                      {sec.title}
                    </td>
                  </tr>
                  {sec.rows.map((r, i) => (
                    <tr key={`r-${si}-${i}`} className="border-t border-rule">
                      <td className="px-6 py-2.5 pl-10 text-sm text-ink/80">{r.label}</td>
                      <td className={`px-6 py-2.5 text-right tabular-nums text-sm ${r.amount < 0 ? 'text-destructive' : 'text-ink'}`}>
                        {fmt(r.amount)}
                      </td>
                    </tr>
                  ))}
                  <tr key={`t-${si}`} className="bg-cream/30 border-t border-rule">
                    <td className="px-6 py-2.5 text-sm font-semibold text-ink">{sec.total.label}</td>
                    <td className={`px-6 py-2.5 text-right tabular-nums text-base font-bold ${sec.total.amount >= 0 ? 'text-burgundy' : 'text-destructive'}`}>
                      {fmt(sec.total.amount)}
                    </td>
                  </tr>
                </>
              ))}
              <tr className="border-t-2 border-burgundy/40">
                <td className="px-6 py-3 text-sm font-bold text-ink">Net increase / (decrease) in cash</td>
                <td className={`px-6 py-3 text-right tabular-nums text-base font-bold ${netChange >= 0 ? 'text-burgundy' : 'text-destructive'}`}>
                  {fmt(netChange)}
                </td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

