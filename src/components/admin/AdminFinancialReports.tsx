import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Download, FileText, Loader2 } from 'lucide-react';
import { format, startOfYear } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { fmtMoney, D } from '@/lib/accounting/money';
import {
  getIncomeStatement, getBalanceSheet, getCashFlow,
  type IncomeStatement, type BalanceSheet, type CashFlowStatement,
  type AccountBalance,
} from '@/lib/accounting/statements';
import { AccountingReports } from '@/components/accounting/AccountingReports';
import { AgingReport } from '@/components/accounting/AgingReport';
import { PerPropertyExpenseBreakdown } from '@/components/accounting/PerPropertyExpenseBreakdown';
import { PerPropertyProfitReport } from '@/components/accounting/PerPropertyProfitReport';
import { RecognitionVsBookingsReport } from '@/components/accounting/RecognitionVsBookingsReport';
import logoUrl from '@/assets/hostiva-logo.png';
import {
  exportFinancialPdf, exportAnnualReportPdf,
  ACCENT_INCOME, ACCENT_INCOME_INK,
  ACCENT_EXPENSE, ACCENT_EXPENSE_INK,
  ACCENT_ASSET, ACCENT_ASSET_INK,
  ACCENT_LIAB, ACCENT_LIAB_INK,
  ACCENT_EQUITY, ACCENT_EQUITY_INK,
  ACCENT_OPERATING, ACCENT_OPERATING_INK,
  ACCENT_INVESTING, ACCENT_INVESTING_INK,
  ACCENT_FINANCING, ACCENT_FINANCING_INK,
} from '@/lib/accounting/pdfExport';
import Decimal from 'decimal.js';
import { toast } from 'sonner';

interface HostLite { user_id: string; full_name: string | null; email: string }
interface PropertyLite { id: string; title: string; host_id: string }

/** Same Tailwind classes as host AccountingReports — guarantees identical look. */
const tblBase = 'w-full border-collapse text-sm';
const headRow = 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]';
const bandIncome    = 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200 font-bold uppercase tracking-wide text-xs';
const bandExpense   = 'bg-amber-50  dark:bg-amber-950/30  text-amber-900  dark:text-amber-200  font-bold uppercase tracking-wide text-xs';
const bandAsset     = 'bg-sky-50    dark:bg-sky-950/30    text-sky-900    dark:text-sky-200    font-bold uppercase tracking-wide text-xs';
const bandLiability = 'bg-rose-50   dark:bg-rose-950/30   text-rose-900   dark:text-rose-200   font-bold uppercase tracking-wide text-xs';
const bandEquity    = 'bg-violet-50 dark:bg-violet-950/30 text-violet-900 dark:text-violet-200 font-bold uppercase tracking-wide text-xs';
const subtotalRow   = 'bg-muted/40 font-semibold';
const totalRow      = 'bg-amber-100/80 dark:bg-amber-950/30 font-bold border-y-2 border-amber-300 dark:border-amber-700';
const itemRow       = 'border-b border-border/40';

const ALL = 'all';
const BASE = 'USD';

/* ---------- Cross-host aggregation helpers ---------- */

type AggRow = { code: string; name: string; balance: Decimal };

function mergeRows(into: Map<string, AggRow>, rows: AccountBalance[]) {
  rows.forEach((r) => {
    const key = `${r.code}::${r.name}`;
    const existing = into.get(key);
    if (existing) existing.balance = existing.balance.plus(r.balance);
    else into.set(key, { code: r.code, name: r.name, balance: r.balance });
  });
}

function toAccountBalances(map: Map<string, AggRow>, type: 'revenue' | 'expense' | 'asset' | 'liability' | 'equity'): AccountBalance[] {
  return Array.from(map.values())
    .filter((r) => !r.balance.eq(0))
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((r) => ({
      account_id: `${type}:${r.code}`,
      code: r.code,
      name: r.name,
      type,
      debit: D(0),
      credit: D(0),
      balance: r.balance,
    }));
}

async function fetchAggregated(hostIds: string[], startDate: string, endDate: string) {
  const rev = new Map<string, AggRow>();
  const exp = new Map<string, AggRow>();
  const ast = new Map<string, AggRow>();
  const lia = new Map<string, AggRow>();
  const eqt = new Map<string, AggRow>();

  let netIncome = D(0), totalRevenue = D(0), totalExpenses = D(0);
  let depreciation = D(0);
  let totalAssets = D(0), totalLiabilities = D(0), totalEquity = D(0), currentEarnings = D(0);

  // Fetch in parallel batches
  const results = await Promise.all(hostIds.map(async (hid) => {
    const [pl, bs, cf] = await Promise.all([
      getIncomeStatement(hid, startDate, endDate).catch(() => null),
      getBalanceSheet(hid, endDate).catch(() => null),
      getCashFlow(hid, startDate, endDate).catch(() => null),
    ]);
    return { pl, bs, cf };
  }));

  results.forEach(({ pl, bs, cf }) => {
    if (pl) {
      mergeRows(rev, pl.revenueRows);
      mergeRows(exp, pl.expenseRows);
      totalRevenue = totalRevenue.plus(pl.totalRevenue);
      totalExpenses = totalExpenses.plus(pl.totalExpenses);
      netIncome = netIncome.plus(pl.netIncome);
    }
    if (bs) {
      mergeRows(ast, bs.assetRows);
      mergeRows(lia, bs.liabilityRows);
      mergeRows(eqt, bs.equityRows);
      totalAssets = totalAssets.plus(bs.totalAssets);
      totalLiabilities = totalLiabilities.plus(bs.totalLiabilities);
      totalEquity = totalEquity.plus(bs.totalEquity);
      currentEarnings = currentEarnings.plus(bs.currentEarnings);
    }
    if (cf) depreciation = depreciation.plus(cf.depreciation);
  });

  const aggPl: IncomeStatement = {
    revenueRows: toAccountBalances(rev, 'revenue'),
    expenseRows: toAccountBalances(exp, 'expense'),
    totalRevenue, totalExpenses, netIncome,
  };
  const aggBs: BalanceSheet = {
    assetRows: toAccountBalances(ast, 'asset'),
    liabilityRows: toAccountBalances(lia, 'liability'),
    equityRows: toAccountBalances(eqt, 'equity'),
    totalAssets, totalLiabilities, totalEquity, currentEarnings,
    isBalanced: totalAssets.minus(totalLiabilities.plus(totalEquity)).abs().lessThan(0.01),
  };
  const operatingCash = netIncome.plus(depreciation);
  const aggCf: CashFlowStatement = {
    netIncome, depreciation, operatingCash,
    investingCash: D(0), financingCash: D(0),
    netChange: operatingCash,
  };

  return { pl: aggPl, bs: aggBs, cf: aggCf };
}

/* ---------- Aggregated render (mirrors host AccountingReports look exactly) ---------- */

function AmountCell({ value, currency, bold = false, neutral = false }: any) {
  const num = typeof value?.toNumber === 'function' ? value.toNumber() : Number(value ?? 0);
  const cls = neutral
    ? 'text-foreground'
    : num < 0 ? 'text-red-600 dark:text-red-400'
    : num > 0 ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-muted-foreground';
  return (
    <td className={`px-4 py-2.5 text-right tabular-nums ${cls} ${bold ? 'font-bold' : ''}`}>
      {fmtMoney(value, currency)}
    </td>
  );
}

/* ---------- Main component ---------- */

export function AdminFinancialReports() {
  const [startDate, setStartDate] = useState(format(startOfYear(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [hosts, setHosts] = useState<HostLite[]>([]);
  const [properties, setProperties] = useState<PropertyLite[]>([]);
  const [hostFilter, setHostFilter] = useState<string>(ALL);
  const [propertyFilter, setPropertyFilter] = useState<string>(ALL);
  const [activeTab, setActiveTab] = useState('pl');

  // Aggregated statements (used only when hostFilter === ALL)
  const [pl, setPl] = useState<IncomeStatement | null>(null);
  const [bs, setBs] = useState<BalanceSheet | null>(null);
  const [cf, setCf] = useState<CashFlowStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  /* ---- Load hosts + properties ---- */
  useEffect(() => {
    (async () => {
      const [{ data: hr }, { data: pr }] = await Promise.all([
        supabase.from('user_roles').select('user_id').eq('role', 'host'),
        supabase.from('properties').select('id, title, host_id'),
      ]);
      const hostIds = Array.from(new Set((hr ?? []).map((r: any) => r.user_id)));
      if (hostIds.length === 0) { setHosts([]); setProperties((pr ?? []) as any); return; }
      const { data: profs } = await supabase
        .from('profiles').select('user_id, full_name, email').in('user_id', hostIds);
      setHosts((profs ?? []) as any);
      setProperties((pr ?? []) as any);
    })();
  }, []);

  const hostIdsForQuery = useMemo(() => {
    if (hostFilter !== ALL) return [hostFilter];
    return hosts.map((h) => h.user_id);
  }, [hostFilter, hosts]);

  const visibleProperties = useMemo(() => {
    if (hostFilter === ALL) return properties;
    return properties.filter((p) => p.host_id === hostFilter);
  }, [properties, hostFilter]);

  /* ---- Load aggregated data when in 'All hosts' mode ---- */
  useEffect(() => {
    if (hostFilter !== ALL) { setLoading(false); return; }
    if (hostIdsForQuery.length === 0) { setPl(null); setBs(null); setCf(null); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { pl, bs, cf } = await fetchAggregated(hostIdsForQuery, startDate, endDate);
        if (cancelled) return;
        setPl(pl); setBs(bs); setCf(cf);
      } catch (e: any) {
        toast.error(e.message ?? 'Failed to load consolidated reports');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hostFilter, hostIdsForQuery.join(','), startDate, endDate]);

  // Reset property when host changes
  useEffect(() => { setPropertyFilter(ALL); }, [hostFilter]);

  /* ---- PDF exports for aggregated mode ---- */

  const exportSinglePdf = async () => {
    if (!pl && !bs && !cf) return;
    setExporting(true);
    try {
      if (activeTab === 'pl' && pl) {
        const totalRev = pl.totalRevenue.toNumber();
        const margin = totalRev !== 0 ? (pl.netIncome.toNumber() / totalRev) * 100 : 0;
        await exportFinancialPdf({
          subtitle: 'Consolidated Profit & Loss Statement',
          startDate, endDate, currency: BASE,
          hero: { label: 'Net income', value: pl.netIncome.toNumber(), caption: `${margin.toFixed(1)}% margin · all hosts` },
          sections: [{
            rows: [
              { label: 'INCOME', amount: 0, kind: 'header', headerFill: ACCENT_INCOME, headerInk: ACCENT_INCOME_INK },
              ...pl.revenueRows.map((r) => ({ label: r.name, amount: r.balance.toNumber(), kind: 'item' as const, forceSign: 'neutral' as const })),
              { label: 'Gross income', amount: pl.totalRevenue.toNumber(), kind: 'subtotal' as const, forceSign: 'neutral' as const },
              { label: 'EXPENSES', amount: 0, kind: 'header', headerFill: ACCENT_EXPENSE, headerInk: ACCENT_EXPENSE_INK },
              ...pl.expenseRows.map((r) => ({ label: r.name, amount: Math.abs(r.balance.toNumber()), kind: 'item' as const, forceSign: 'neutral' as const })),
              { label: 'Total expenses', amount: Math.abs(pl.totalExpenses.toNumber()), kind: 'subtotal' as const, forceSign: 'neutral' as const },
              { label: 'NET INCOME', amount: pl.netIncome.toNumber(), kind: 'total' as const, forceSign: 'neutral' as const },
            ],
          }],
          fileName: `hostiva-admin-pnl-${startDate}-to-${endDate}.pdf`,
        });
      } else if (activeTab === 'bs' && bs) {
        await exportFinancialPdf({
          subtitle: `Consolidated Balance Sheet (as of ${endDate})`,
          startDate, endDate, currency: BASE,
          sections: [{
            rows: [
              { label: 'ASSETS', amount: 0, kind: 'header', headerFill: ACCENT_ASSET, headerInk: ACCENT_ASSET_INK },
              ...bs.assetRows.map((r) => ({ label: r.name, amount: r.balance.toNumber(), kind: 'item' as const, forceSign: 'neutral' as const })),
              { label: 'Total assets', amount: bs.totalAssets.toNumber(), kind: 'subtotal' as const, forceSign: 'neutral' as const },
              { label: 'LIABILITIES', amount: 0, kind: 'header', headerFill: ACCENT_LIAB, headerInk: ACCENT_LIAB_INK },
              ...bs.liabilityRows.map((r) => ({ label: r.name, amount: r.balance.toNumber(), kind: 'item' as const, forceSign: 'neutral' as const })),
              { label: 'Total liabilities', amount: bs.totalLiabilities.toNumber(), kind: 'subtotal' as const, forceSign: 'neutral' as const },
              { label: 'EQUITY', amount: 0, kind: 'header', headerFill: ACCENT_EQUITY, headerInk: ACCENT_EQUITY_INK },
              ...bs.equityRows.map((r) => ({ label: r.name, amount: r.balance.toNumber(), kind: 'item' as const, forceSign: 'neutral' as const })),
              { label: 'Current year earnings', amount: bs.currentEarnings.toNumber(), kind: 'item' as const, forceSign: 'neutral' as const },
              { label: 'Total equity', amount: bs.totalEquity.toNumber(), kind: 'subtotal' as const, forceSign: 'neutral' as const },
              { label: 'Total liabilities + equity', amount: bs.totalLiabilities.plus(bs.totalEquity).toNumber(), kind: 'total' as const, forceSign: 'neutral' as const },
            ],
          }],
          fileName: `hostiva-admin-balance-sheet-${endDate}.pdf`,
        });
      } else if (activeTab === 'cf' && cf) {
        await exportFinancialPdf({
          subtitle: 'Consolidated Cash Flow Statement (Indirect)',
          startDate, endDate, currency: BASE,
          hero: { label: 'Net change in cash', value: cf.netChange.toNumber() },
          sections: [{
            rows: [
              { label: 'OPERATING ACTIVITIES', amount: 0, kind: 'header', headerFill: ACCENT_OPERATING, headerInk: ACCENT_OPERATING_INK },
              { label: 'Net income', amount: cf.netIncome.toNumber(), kind: 'item' as const, forceSign: 'neutral' as const },
              { label: 'Add back: depreciation', amount: cf.depreciation.toNumber(), kind: 'item' as const, forceSign: 'neutral' as const },
              { label: 'Cash from operations', amount: cf.operatingCash.toNumber(), kind: 'subtotal' as const, forceSign: 'neutral' as const },
              { label: 'INVESTING ACTIVITIES', amount: 0, kind: 'header', headerFill: ACCENT_INVESTING, headerInk: ACCENT_INVESTING_INK },
              { label: 'Net cash from investing', amount: cf.investingCash.toNumber(), kind: 'subtotal' as const, forceSign: 'neutral' as const },
              { label: 'FINANCING ACTIVITIES', amount: 0, kind: 'header', headerFill: ACCENT_FINANCING, headerInk: ACCENT_FINANCING_INK },
              { label: 'Net cash from financing', amount: cf.financingCash.toNumber(), kind: 'subtotal' as const, forceSign: 'neutral' as const },
              { label: 'NET CHANGE IN CASH', amount: cf.netChange.toNumber(), kind: 'total' as const, forceSign: 'neutral' as const },
            ],
          }],
          fileName: `hostiva-admin-cashflow-${startDate}-to-${endDate}.pdf`,
        });
      }
    } finally { setExporting(false); }
  };

  const exportAllPdf = async () => {
    if (!pl && !bs && !cf) return;
    setExporting(true);
    try {
      await exportAnnualReportPdf({
        startDate, endDate, currency: BASE,
        pl, bs, cf,
        properties: [], // platform-wide properties list omitted
        fileName: `hostiva-admin-annual-report-${startDate}-to-${endDate}.pdf`,
      });
    } finally { setExporting(false); }
  };

  const totalRevNum = pl?.totalRevenue.toNumber() ?? 0;
  const netIncomeNum = pl?.netIncome.toNumber() ?? 0;
  const margin = totalRevNum !== 0 ? (netIncomeNum / totalRevNum) * 100 : 0;

  /* ---- When a single host is picked, delegate entirely to the host AccountingReports
         component so every detail (visuals, exports, sub-reports) matches 1:1. ---- */
  if (hostFilter !== ALL) {
    return (
      <div className="space-y-4">
        <FilterBar
          hosts={hosts}
          properties={visibleProperties}
          hostFilter={hostFilter}
          setHostFilter={setHostFilter}
          propertyFilter={propertyFilter}
          setPropertyFilter={setPropertyFilter}
        />
        <AccountingReports hostId={hostFilter} propertyFilter={propertyFilter === ALL ? null : propertyFilter} />
      </div>
    );
  }

  /* ---- Aggregated 'All hosts' view ---- */
  return (
    <div className="space-y-4">
      <FilterBar
        hosts={hosts}
        properties={visibleProperties}
        hostFilter={hostFilter}
        setHostFilter={setHostFilter}
        propertyFilter={propertyFilter}
        setPropertyFilter={setPropertyFilter}
      />

      <div className="flex flex-wrap items-end gap-3">
        <div><Label>From</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" /></div>
        <div><Label>To</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" /></div>
        <Button variant="default" size="sm" onClick={exportSinglePdf} disabled={exporting || (!pl && !bs && !cf)}>
          {exporting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileText className="w-4 h-4 mr-1" />}Export PDF
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={exportAllPdf}
          disabled={exporting || (!pl && !bs && !cf)}
          className="bg-amber-500 hover:bg-amber-600 text-white"
        >
          {exporting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileText className="w-4 h-4 mr-1" />}Export All Reports (PDF)
        </Button>
      </div>

      {loading ? <Skeleton className="h-96" /> : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-3">
          <TabsList>
            <TabsTrigger value="pl">Income statement</TabsTrigger>
            <TabsTrigger value="bs">Balance sheet</TabsTrigger>
            <TabsTrigger value="cf">Cash flow</TabsTrigger>
            <TabsTrigger value="recognition">Recognition vs bookings</TabsTrigger>
            <TabsTrigger value="profit">Profit by property</TabsTrigger>
            <TabsTrigger value="property">Expenses by property</TabsTrigger>
            <TabsTrigger value="aging">A/R + A/P aging</TabsTrigger>
          </TabsList>

          <TabsContent value="pl">
            <Card className="overflow-hidden border-amber-200/60 dark:border-amber-900/40">
              <div className="bg-primary text-primary-foreground px-6 py-5">
                <div className="flex items-center gap-4">
                  <img src={logoUrl} alt="Hostiva" className="h-10 w-auto bg-white rounded-md p-1" />
                  <div>
                    <h2 className="text-xl font-bold leading-tight">Profit &amp; Loss Statement (All hosts)</h2>
                    <p className="text-xs opacity-80">Period: {startDate} to {endDate} · {BASE}</p>
                  </div>
                </div>
              </div>
              <div className="h-1 bg-amber-400" />
              <CardContent className="pt-6">
                {pl && (
                  <>
                    <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 px-6 py-5 mb-6">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Net income</p>
                      <p className={`text-3xl font-extrabold mt-1 tabular-nums ${netIncomeNum < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {fmtMoney(pl.netIncome, BASE)}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">{margin.toFixed(1)}% margin · {hosts.length} hosts</p>
                    </div>

                    <table className={tblBase}>
                      <thead>
                        <tr className={headRow}>
                          <th className="px-4 py-3 text-left font-bold">Particulars</th>
                          <th className="px-4 py-3 text-right font-bold">Amount ({BASE})</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className={bandIncome}><td colSpan={2} className="px-4 py-3">INCOME</td></tr>
                        {pl.revenueRows.map((r) => (
                          <tr key={r.account_id} className={itemRow}>
                            <td className="px-4 py-2.5 pl-8 text-foreground">{r.name}</td>
                            <AmountCell value={r.balance} currency={BASE} />
                          </tr>
                        ))}
                        <tr className={subtotalRow}>
                          <td className="px-4 py-3">Gross income</td>
                          <AmountCell value={pl.totalRevenue} currency={BASE} bold />
                        </tr>
                        <tr className={bandExpense}><td colSpan={2} className="px-4 py-3">EXPENSES</td></tr>
                        {pl.expenseRows.map((r) => (
                          <tr key={r.account_id} className={itemRow}>
                            <td className="px-4 py-2.5 pl-8 text-foreground">{r.name}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                              {fmtMoney(Math.abs(r.balance.toNumber()), BASE)}
                            </td>
                          </tr>
                        ))}
                        <tr className={subtotalRow}>
                          <td className="px-4 py-3">Total expenses</td>
                          <td className="px-4 py-3 text-right tabular-nums font-bold text-foreground">
                            {fmtMoney(Math.abs(pl.totalExpenses.toNumber()), BASE)}
                          </td>
                        </tr>
                        <tr className={totalRow}>
                          <td className="px-4 py-3 text-base">NET INCOME</td>
                          <AmountCell value={pl.netIncome} currency={BASE} bold />
                        </tr>
                      </tbody>
                    </table>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="bs">
            <Card className="overflow-hidden border-amber-200/60 dark:border-amber-900/40">
              <div className="bg-primary text-primary-foreground px-6 py-5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <img src={logoUrl} alt="Hostiva" className="h-10 w-auto bg-white rounded-md p-1" />
                  <div>
                    <h2 className="text-xl font-bold leading-tight">Balance Sheet (All hosts)</h2>
                    <p className="text-xs opacity-80">As of {endDate} · {BASE}</p>
                  </div>
                </div>
                {bs && <Badge variant={bs.isBalanced ? 'default' : 'destructive'} className="shrink-0">{bs.isBalanced ? 'Balanced ✓' : 'Out of balance'}</Badge>}
              </div>
              <div className="h-1 bg-amber-400" />
              <CardContent className="pt-6">
                {bs && (
                  <table className={tblBase}>
                    <thead>
                      <tr className={headRow}>
                        <th className="px-4 py-3 text-left font-bold">Particulars</th>
                        <th className="px-4 py-3 text-right font-bold">Amount ({BASE})</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className={bandAsset}><td colSpan={2} className="px-4 py-3">ASSETS</td></tr>
                      {bs.assetRows.map((r) => (
                        <tr key={r.account_id} className={itemRow}>
                          <td className="px-4 py-2.5 pl-8">{r.name}</td>
                          <AmountCell value={r.balance} currency={BASE} neutral />
                        </tr>
                      ))}
                      <tr className={subtotalRow}><td className="px-4 py-3">Total assets</td><AmountCell value={bs.totalAssets} currency={BASE} bold neutral /></tr>

                      <tr className={bandLiability}><td colSpan={2} className="px-4 py-3">LIABILITIES</td></tr>
                      {bs.liabilityRows.map((r) => (
                        <tr key={r.account_id} className={itemRow}>
                          <td className="px-4 py-2.5 pl-8">{r.name}</td>
                          <AmountCell value={r.balance} currency={BASE} neutral />
                        </tr>
                      ))}
                      <tr className={subtotalRow}><td className="px-4 py-3">Total liabilities</td><AmountCell value={bs.totalLiabilities} currency={BASE} bold neutral /></tr>

                      <tr className={bandEquity}><td colSpan={2} className="px-4 py-3">EQUITY</td></tr>
                      {bs.equityRows.map((r) => (
                        <tr key={r.account_id} className={itemRow}>
                          <td className="px-4 py-2.5 pl-8">{r.name}</td>
                          <AmountCell value={r.balance} currency={BASE} neutral />
                        </tr>
                      ))}
                      <tr className={itemRow}>
                        <td className="px-4 py-2.5 pl-8">Current year earnings</td>
                        <AmountCell value={bs.currentEarnings} currency={BASE} neutral />
                      </tr>
                      <tr className={subtotalRow}><td className="px-4 py-3">Total equity</td><AmountCell value={bs.totalEquity} currency={BASE} bold neutral /></tr>
                      <tr className={totalRow}>
                        <td className="px-4 py-3 text-base">Total liabilities + equity</td>
                        <AmountCell value={bs.totalLiabilities.plus(bs.totalEquity)} currency={BASE} bold neutral />
                      </tr>
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="cf">
            <Card className="overflow-hidden border-amber-200/60 dark:border-amber-900/40">
              <div className="bg-primary text-primary-foreground px-6 py-5">
                <div className="flex items-center gap-4">
                  <img src={logoUrl} alt="Hostiva" className="h-10 w-auto bg-white rounded-md p-1" />
                  <div>
                    <h2 className="text-xl font-bold leading-tight">Cash Flow Statement (All hosts)</h2>
                    <p className="text-xs opacity-80">Indirect method · {startDate} to {endDate} · {BASE}</p>
                  </div>
                </div>
              </div>
              <div className="h-1 bg-amber-400" />
              <CardContent className="pt-6">
                {cf && (
                  <>
                    <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 px-6 py-5 mb-6">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Net change in cash</p>
                      <p className={`text-3xl font-extrabold mt-1 tabular-nums ${cf.netChange.toNumber() < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {fmtMoney(cf.netChange, BASE)}
                      </p>
                    </div>
                    <table className={tblBase}>
                      <thead>
                        <tr className={headRow}>
                          <th className="px-4 py-3 text-left font-bold">Particulars</th>
                          <th className="px-4 py-3 text-right font-bold">Amount ({BASE})</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className={bandIncome}><td colSpan={2} className="px-4 py-3">OPERATING ACTIVITIES</td></tr>
                        <tr className={itemRow}><td className="px-4 py-2.5 pl-8">Net income</td><AmountCell value={cf.netIncome} currency={BASE} /></tr>
                        <tr className={itemRow}><td className="px-4 py-2.5 pl-8">Add back: depreciation</td><AmountCell value={cf.depreciation} currency={BASE} /></tr>
                        <tr className={subtotalRow}><td className="px-4 py-3">Cash from operations</td><AmountCell value={cf.operatingCash} currency={BASE} bold /></tr>
                        <tr className={bandAsset}><td colSpan={2} className="px-4 py-3">INVESTING ACTIVITIES</td></tr>
                        <tr className={subtotalRow}><td className="px-4 py-3">Net cash from investing</td><AmountCell value={cf.investingCash} currency={BASE} bold /></tr>
                        <tr className={bandEquity}><td colSpan={2} className="px-4 py-3">FINANCING ACTIVITIES</td></tr>
                        <tr className={subtotalRow}><td className="px-4 py-3">Net cash from financing</td><AmountCell value={cf.financingCash} currency={BASE} bold /></tr>
                        <tr className={totalRow}>
                          <td className="px-4 py-3 text-base">NET CHANGE IN CASH</td>
                          <AmountCell value={cf.netChange} currency={BASE} bold />
                        </tr>
                      </tbody>
                    </table>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Property/recognition/aging tabs render per-host stacks since they're host-scoped queries.
              When a property filter is set, sub-components narrow their rows to that property. */}
          <TabsContent value="recognition" className="space-y-4">
            <PerHostStack
              hosts={hosts}
              render={(h) => (
                <RecognitionVsBookingsReport hostId={h.user_id} startDate={startDate} endDate={endDate} baseCurrency={BASE} />
              )}
            />
          </TabsContent>

          <TabsContent value="profit" className="space-y-4">
            <PerHostStack
              hosts={hosts}
              render={(h) => (
                <PerPropertyProfitReport hostId={h.user_id} startDate={startDate} endDate={endDate} baseCurrency={BASE} propertyFilter={propertyFilter === ALL ? null : propertyFilter} />
              )}
            />
          </TabsContent>

          <TabsContent value="property" className="space-y-4">
            <PerHostStack
              hosts={hosts}
              render={(h) => (
                <PerPropertyExpenseBreakdown hostId={h.user_id} startDate={startDate} endDate={endDate} baseCurrency={BASE} propertyFilter={propertyFilter === ALL ? null : propertyFilter} />
              )}
            />
          </TabsContent>

          <TabsContent value="aging" className="space-y-4">
            <PerHostStack
              hosts={hosts}
              render={(h) => <AgingReport hostId={h.user_id} baseCurrency={BASE} />}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

/* ---------- Subcomponents ---------- */

function FilterBar({
  hosts, properties, hostFilter, setHostFilter, propertyFilter, setPropertyFilter,
}: {
  hosts: HostLite[]; properties: PropertyLite[];
  hostFilter: string; setHostFilter: (v: string) => void;
  propertyFilter: string; setPropertyFilter: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
      <div>
        <Label className="text-xs">Host</Label>
        <Select value={hostFilter} onValueChange={setHostFilter}>
          <SelectTrigger className="h-9 w-[240px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All hosts (consolidated)</SelectItem>
            {hosts.map((h) => (
              <SelectItem key={h.user_id} value={h.user_id}>{h.full_name || h.email}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Property</Label>
        <Select value={propertyFilter} onValueChange={setPropertyFilter}>
          <SelectTrigger className="h-9 w-[240px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All properties</SelectItem>
            {properties.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">
        Property filter narrows the per-property reports (Profit, Expenses). Statements (P&amp;L, Balance Sheet, Cash Flow) are derived from the host ledger.
      </p>
    </div>
  );
}

function PerHostStack({ hosts, render }: { hosts: HostLite[]; render: (h: HostLite) => React.ReactNode }) {
  if (hosts.length === 0) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground">No hosts found.</CardContent></Card>;
  }
  return (
    <>
      {hosts.map((h) => (
        <Card key={h.user_id} className="overflow-hidden">
          <CardHeader className="bg-muted/40 py-3">
            <CardTitle className="text-sm font-semibold">{h.full_name || h.email}</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">{render(h)}</CardContent>
        </Card>
      ))}
    </>
  );
}