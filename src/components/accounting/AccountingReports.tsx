import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Download, FileText } from 'lucide-react';
import { fmtMoney } from '@/lib/accounting/money';
import { useBaseCurrency } from '@/hooks/useBaseCurrency';
import {
  getIncomeStatement, getBalanceSheet, getCashFlow,
  type IncomeStatement, type BalanceSheet, type CashFlowStatement,
} from '@/lib/accounting/statements';
import { AgingReport } from './AgingReport';
import { PerPropertyExpenseBreakdown } from './PerPropertyExpenseBreakdown';
import { PerPropertyProfitReport } from './PerPropertyProfitReport';
import { RecognitionVsBookingsReport } from './RecognitionVsBookingsReport';
import { format, startOfYear } from 'date-fns';
import {
  exportFinancialPdf,
  exportAnnualReportPdf,
  ACCENT_INCOME, ACCENT_INCOME_INK,
  ACCENT_EXPENSE, ACCENT_EXPENSE_INK,
  ACCENT_ASSET, ACCENT_ASSET_INK,
  ACCENT_LIAB, ACCENT_LIAB_INK,
  ACCENT_EQUITY, ACCENT_EQUITY_INK,
  ACCENT_OPERATING, ACCENT_OPERATING_INK,
  ACCENT_INVESTING, ACCENT_INVESTING_INK,
  ACCENT_FINANCING, ACCENT_FINANCING_INK,
  type PropertyPerfRow,
} from '@/lib/accounting/pdfExport';
import logoUrl from '@/assets/hostiva-logo.png';
import { supabase } from '@/integrations/supabase/client';

/** Shared classes for the decorated statement tables */
const tblBase = 'w-full border-collapse text-sm';
const headRow = 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]';
/** PDF-matched colored section bands. Each statement section uses its own accent. */
const bandIncome    = 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200 font-bold uppercase tracking-wide text-xs';
const bandExpense   = 'bg-amber-50  dark:bg-amber-950/30  text-amber-900  dark:text-amber-200  font-bold uppercase tracking-wide text-xs';
const bandAsset     = 'bg-sky-50    dark:bg-sky-950/30    text-sky-900    dark:text-sky-200    font-bold uppercase tracking-wide text-xs';
const bandLiability = 'bg-rose-50   dark:bg-rose-950/30   text-rose-900   dark:text-rose-200   font-bold uppercase tracking-wide text-xs';
const bandEquity    = 'bg-violet-50 dark:bg-violet-950/30 text-violet-900 dark:text-violet-200 font-bold uppercase tracking-wide text-xs';
const subtotalRow = 'bg-muted/40 font-semibold';
const totalRow = 'bg-amber-100/80 dark:bg-amber-950/30 font-bold border-y-2 border-amber-300 dark:border-amber-700';
const itemRow = 'border-b border-border/40';

function AmountCell({ value, currency, bold = false, neutral = false }: { value: any; currency: string; bold?: boolean; neutral?: boolean }) {
  const num = typeof value?.toNumber === 'function' ? value.toNumber() : Number(value ?? 0);
  const cls = neutral
    ? 'text-foreground'
    : num < 0
      ? 'text-red-600 dark:text-red-400'
      : num > 0
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-muted-foreground';
  return (
    <td className={`px-4 py-2.5 text-right tabular-nums ${cls} ${bold ? 'font-bold' : ''}`}>
      {fmtMoney(value, currency)}
    </td>
  );
}

export function AccountingReports({ hostId, propertyFilter }: { hostId: string; propertyFilter?: string | null }) {
  const baseCurrency = useBaseCurrency(hostId);
  const [startDate, setStartDate] = useState(format(startOfYear(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [pl, setPl] = useState<IncomeStatement | null>(null);
  const [bs, setBs] = useState<BalanceSheet | null>(null);
  const [cf, setCf] = useState<CashFlowStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('pl');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [p, b, c] = await Promise.all([
        getIncomeStatement(hostId, startDate, endDate),
        getBalanceSheet(hostId, endDate),
        getCashFlow(hostId, startDate, endDate),
      ]);
      setPl(p); setBs(b); setCf(c); setLoading(false);
    })();
  }, [hostId, startDate, endDate]);

  const exportCsv = () => {
    if (!pl) return;
    const lines = ['Type,Code,Account,Amount'];
    pl.revenueRows.forEach((r) => lines.push(`Revenue,${r.code},${r.name},${r.balance.toFixed(2)}`));
    pl.expenseRows.forEach((r) => lines.push(`Expense,${r.code},${r.name},${r.balance.toFixed(2)}`));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `pl_${startDate}_${endDate}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = async () => {
    if (activeTab === 'pl' && pl) {
      const sections = [
        {
          rows: [
            { label: 'INCOME', amount: 0, kind: 'header' as const, headerFill: ACCENT_INCOME, headerInk: ACCENT_INCOME_INK },
            ...pl.revenueRows.map((r) => ({ label: r.name, amount: r.balance.toNumber(), kind: 'item' as const, forceSign: 'neutral' as const })),
            { label: 'Gross income', amount: pl.totalRevenue.toNumber(), kind: 'subtotal' as const, forceSign: 'neutral' as const },
            { label: 'EXPENSES', amount: 0, kind: 'header' as const, headerFill: ACCENT_EXPENSE, headerInk: ACCENT_EXPENSE_INK },
            ...pl.expenseRows.map((r) => ({ label: r.name, amount: Math.abs(r.balance.toNumber()), kind: 'item' as const, forceSign: 'neutral' as const })),
            { label: 'Total expenses', amount: Math.abs(pl.totalExpenses.toNumber()), kind: 'subtotal' as const, forceSign: 'neutral' as const },
            { label: 'NET INCOME', amount: pl.netIncome.toNumber(), kind: 'total' as const, forceSign: 'neutral' as const },
          ],
        },
      ];
      const totalRev = pl.totalRevenue.toNumber();
      const margin = totalRev !== 0 ? (pl.netIncome.toNumber() / totalRev) * 100 : 0;
      await exportFinancialPdf({
        subtitle: 'Profit & Loss Statement',
        startDate, endDate, currency: baseCurrency,
        hero: {
          label: 'Net income',
          value: pl.netIncome.toNumber(),
          caption: `${margin.toFixed(1)}% margin`,
        },
        sections,
        fileName: `hostiva-pnl-${startDate}-to-${endDate}.pdf`,
      });
      return;
    }
    if (activeTab === 'bs' && bs) {
      await exportFinancialPdf({
        subtitle: `Balance Sheet (as of ${endDate})`,
        startDate, endDate, currency: baseCurrency,
        sections: [
          {
            title: 'Assets',
            rows: [
              { label: 'ASSETS', amount: 0, kind: 'header' as const, headerFill: ACCENT_ASSET, headerInk: ACCENT_ASSET_INK },
              ...bs.assetRows.map((r) => ({ label: r.name, amount: r.balance.toNumber(), kind: 'item' as const, forceSign: 'neutral' as const })),
              { label: 'Total assets', amount: bs.totalAssets.toNumber(), kind: 'total' as const, forceSign: 'neutral' as const },
            ],
          },
          {
            title: 'Liabilities and Equity',
            rows: [
              { label: 'LIABILITIES', amount: 0, kind: 'header' as const, headerFill: ACCENT_LIAB, headerInk: ACCENT_LIAB_INK },
              ...bs.liabilityRows.map((r) => ({ label: r.name, amount: r.balance.toNumber(), kind: 'item' as const, forceSign: 'neutral' as const })),
              { label: 'Total liabilities', amount: bs.totalLiabilities.toNumber(), kind: 'subtotal' as const, forceSign: 'neutral' as const },
              { label: 'EQUITY', amount: 0, kind: 'header' as const, headerFill: ACCENT_EQUITY, headerInk: ACCENT_EQUITY_INK },
              ...bs.equityRows.map((r) => ({ label: r.name, amount: r.balance.toNumber(), kind: 'item' as const, forceSign: 'neutral' as const })),
              { label: 'Current year earnings', amount: bs.currentEarnings.toNumber(), kind: 'item' as const, forceSign: 'neutral' as const },
              { label: 'Total equity', amount: bs.totalEquity.toNumber(), kind: 'subtotal' as const, forceSign: 'neutral' as const },
              { label: 'Total liabilities + equity', amount: bs.totalLiabilities.plus(bs.totalEquity).toNumber(), kind: 'total' as const, forceSign: 'neutral' as const },
            ],
          },
        ],
        fileName: `hostiva-balance-sheet-${endDate}.pdf`,
      });
      return;
    }
    if (activeTab === 'cf' && cf) {
      await exportFinancialPdf({
        subtitle: 'Cash Flow Statement (Indirect Method)',
        startDate, endDate, currency: baseCurrency,
        hero: {
          label: 'Net change in cash',
          value: cf.netChange.toNumber(),
        },
        sections: [{
          rows: [
            { label: 'OPERATING ACTIVITIES', amount: 0, kind: 'header' as const, headerFill: ACCENT_OPERATING, headerInk: ACCENT_OPERATING_INK },
            { label: 'Net income', amount: cf.netIncome.toNumber(), kind: 'item' as const, forceSign: 'neutral' as const },
            { label: 'Add back: depreciation', amount: cf.depreciation.toNumber(), kind: 'item' as const, forceSign: 'neutral' as const },
            { label: 'Cash from operations', amount: cf.operatingCash.toNumber(), kind: 'subtotal' as const, forceSign: 'neutral' as const },
            { label: 'INVESTING ACTIVITIES', amount: 0, kind: 'header' as const, headerFill: ACCENT_INVESTING, headerInk: ACCENT_INVESTING_INK },
            { label: 'Net cash from investing', amount: cf.investingCash.toNumber(), kind: 'subtotal' as const, forceSign: 'neutral' as const },
            { label: 'FINANCING ACTIVITIES', amount: 0, kind: 'header' as const, headerFill: ACCENT_FINANCING, headerInk: ACCENT_FINANCING_INK },
            { label: 'Net cash from financing', amount: cf.financingCash.toNumber(), kind: 'subtotal' as const, forceSign: 'neutral' as const },
            { label: 'NET CHANGE IN CASH', amount: cf.netChange.toNumber(), kind: 'total' as const, forceSign: 'neutral' as const },
          ],
        }],
        fileName: `hostiva-cashflow-${startDate}-to-${endDate}.pdf`,
      });
      return;
    }
  };

  const exportAllPdf = async () => {
    // Fetch property-level performance for the new portfolio overview page (page 3)
    let properties: PropertyPerfRow[] = [];
    try {
      const [propsRes, bookingsRes, externalRes, expensesRes] = await Promise.all([
        supabase.from('properties').select('id, title').eq('host_id', hostId),
        supabase
          .from('bookings')
          .select('id, property_id, subtotal, cleaning_fee, check_out_date, status')
          .eq('host_id', hostId)
          .in('status', ['confirmed', 'completed'] as any)
          .gte('check_out_date', startDate)
          .lte('check_out_date', endDate),
        supabase
          .from('acct_external_bookings')
          .select('property_id, gross_revenue, cleaning_fee, base_amount, check_out_date, status')
          .eq('host_id', hostId)
          .in('status', ['auto', 'completed', 'confirmed'])
          .gte('check_out_date', startDate)
          .lte('check_out_date', endDate),
        supabase
          .from('acct_expenses')
          .select('property_id, base_amount, amount, is_shared, allocations, is_capitalized, expense_date')
          .eq('host_id', hostId)
          .eq('is_capitalized', false)
          .gte('expense_date', startDate)
          .lte('expense_date', endDate),
      ]);

      const titleById = new Map<string, string>();
      (propsRes.data ?? []).forEach((p: any) => titleById.set(p.id, p.title));

      type Agg = { title: string; revenue: number; expense: number };
      const map = new Map<string, Agg>();
      const ensure = (id: string | null, title: string): Agg => {
        const key = id ?? '__unallocated__';
        let r = map.get(key);
        if (!r) { r = { title, revenue: 0, expense: 0 }; map.set(key, r); }
        return r;
      };

      (bookingsRes.data ?? []).forEach((b: any) => {
        const title = b.property_id ? (titleById.get(b.property_id) ?? 'Unknown property') : 'Unallocated';
        const row = ensure(b.property_id ?? null, title);
        row.revenue += Number(b.subtotal ?? 0) + Number(b.cleaning_fee ?? 0);
      });
      (externalRes.data ?? []).forEach((eb: any) => {
        const title = eb.property_id ? (titleById.get(eb.property_id) ?? 'Unknown property') : 'Unallocated';
        const row = ensure(eb.property_id ?? null, title);
        const amt = Number(eb.base_amount ?? eb.gross_revenue ?? 0) + Number(eb.cleaning_fee ?? 0);
        row.revenue += amt;
      });
      (expensesRes.data ?? []).forEach((ex: any) => {
        const amt = Math.abs(Number(ex.base_amount ?? ex.amount ?? 0));
        if (ex.is_shared && ex.allocations && typeof ex.allocations === 'object') {
          Object.entries(ex.allocations as Record<string, number>).forEach(([pid, weight]) => {
            const title = titleById.get(pid) ?? 'Unknown property';
            ensure(pid, title).expense += amt * Number(weight ?? 0);
          });
        } else {
          const title = ex.property_id ? (titleById.get(ex.property_id) ?? 'Unknown property') : 'Unallocated';
          ensure(ex.property_id ?? null, title).expense += amt;
        }
      });

      properties = Array.from(map.values())
        .map((r) => {
          const profit = r.revenue - r.expense;
          const margin = r.revenue !== 0 ? profit / r.revenue : 0;
          return { title: r.title, revenue: r.revenue, expense: r.expense, profit, margin };
        })
        .sort((a, b) => b.revenue - a.revenue);
    } catch (e) {
      console.error('Failed to load per-property performance for PDF', e);
    }

    await exportAnnualReportPdf({
      startDate,
      endDate,
      currency: baseCurrency,
      pl, bs, cf,
      properties,
      fileName: `hostiva-annual-report-${startDate}-to-${endDate}.pdf`,
    });
  };

  const totalRevNum = pl?.totalRevenue.toNumber() ?? 0;
  const netIncomeNum = pl?.netIncome.toNumber() ?? 0;
  const margin = totalRevNum !== 0 ? (netIncomeNum / totalRevNum) * 100 : 0;
  const canExportPdf = (activeTab === 'pl' && !!pl) || (activeTab === 'bs' && !!bs) || (activeTab === 'cf' && !!cf);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div><Label>From</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" /></div>
        <div><Label>To</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" /></div>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="w-4 h-4 mr-1" />Export CSV
        </Button>
        <Button variant="default" size="sm" onClick={exportPdf} disabled={!canExportPdf}>
          <FileText className="w-4 h-4 mr-1" />Export PDF
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={exportAllPdf}
          disabled={!pl && !bs && !cf}
          className="bg-amber-500 hover:bg-amber-600 text-white"
        >
          <FileText className="w-4 h-4 mr-1" />Export All Reports (PDF)
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
              {/* Decorative header band */}
              <div className="bg-primary text-primary-foreground px-6 py-5">
                <div className="flex items-center gap-4">
                  <img src={logoUrl} alt="Hostiva" className="h-10 w-auto bg-white rounded-md p-1" />
                  <div>
                    <h2 className="text-xl font-bold leading-tight">Profit &amp; Loss Statement</h2>
                    <p className="text-xs opacity-80">Period: {startDate} to {endDate} · {baseCurrency}</p>
                  </div>
                </div>
              </div>
              <div className="h-1 bg-amber-400" />
              <CardContent className="pt-6">
                {pl && (
                  <>
                    {/* Hero KPI */}
                    <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 px-6 py-5 mb-6">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Net income</p>
                      <p className={`text-3xl font-extrabold mt-1 tabular-nums ${netIncomeNum < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {fmtMoney(pl.netIncome, baseCurrency)}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {margin.toFixed(1)}% margin
                      </p>
                    </div>

                    <table className={tblBase}>
                      <thead>
                        <tr className={headRow}>
                          <th className="px-4 py-3 text-left font-bold">Particulars</th>
                          <th className="px-4 py-3 text-right font-bold">Amount ({baseCurrency})</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className={bandIncome}><td colSpan={2} className="px-4 py-3">INCOME</td></tr>
                        {pl.revenueRows.map((r) => (
                          <tr key={r.account_id} className={itemRow}>
                            <td className="px-4 py-2.5 pl-8 text-foreground">{r.name}</td>
                            <AmountCell value={r.balance} currency={baseCurrency} />
                          </tr>
                        ))}
                        <tr className={subtotalRow}>
                          <td className="px-4 py-3">Gross income</td>
                          <AmountCell value={pl.totalRevenue} currency={baseCurrency} bold />
                        </tr>
                        <tr className={bandExpense}><td colSpan={2} className="px-4 py-3">EXPENSES</td></tr>
                        {pl.expenseRows.map((r) => (
                          <tr key={r.account_id} className={itemRow}>
                            <td className="px-4 py-2.5 pl-8 text-foreground">{r.name}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                              {fmtMoney(Math.abs(r.balance.toNumber()), baseCurrency)}
                            </td>
                          </tr>
                        ))}
                        <tr className={subtotalRow}>
                          <td className="px-4 py-3">Total expenses</td>
                          <td className="px-4 py-3 text-right tabular-nums font-bold text-foreground">
                            {fmtMoney(Math.abs(pl.totalExpenses.toNumber()), baseCurrency)}
                          </td>
                        </tr>
                        <tr className={totalRow}>
                          <td className="px-4 py-3 text-base">NET INCOME</td>
                          <AmountCell value={pl.netIncome} currency={baseCurrency} bold />
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
                    <h2 className="text-xl font-bold leading-tight">Balance Sheet</h2>
                    <p className="text-xs opacity-80">As of {endDate} · {baseCurrency}</p>
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
                        <th className="px-4 py-3 text-right font-bold">Amount ({baseCurrency})</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className={bandAsset}><td colSpan={2} className="px-4 py-3">ASSETS</td></tr>
                      {bs.assetRows.map((r) => (
                        <tr key={r.account_id} className={itemRow}>
                          <td className="px-4 py-2.5 pl-8">{r.name}</td>
                          <AmountCell value={r.balance} currency={baseCurrency} neutral />
                        </tr>
                      ))}
                      <tr className={subtotalRow}><td className="px-4 py-3">Total assets</td><AmountCell value={bs.totalAssets} currency={baseCurrency} bold neutral /></tr>

                      <tr className={bandLiability}><td colSpan={2} className="px-4 py-3">LIABILITIES</td></tr>
                      {bs.liabilityRows.map((r) => (
                        <tr key={r.account_id} className={itemRow}>
                          <td className="px-4 py-2.5 pl-8">{r.name}</td>
                          <AmountCell value={r.balance} currency={baseCurrency} neutral />
                        </tr>
                      ))}
                      <tr className={subtotalRow}><td className="px-4 py-3">Total liabilities</td><AmountCell value={bs.totalLiabilities} currency={baseCurrency} bold neutral /></tr>

                      <tr className={bandEquity}><td colSpan={2} className="px-4 py-3">EQUITY</td></tr>
                      {bs.equityRows.map((r) => (
                        <tr key={r.account_id} className={itemRow}>
                          <td className="px-4 py-2.5 pl-8">{r.name}</td>
                          <AmountCell value={r.balance} currency={baseCurrency} neutral />
                        </tr>
                      ))}
                      <tr className={itemRow}>
                        <td className="px-4 py-2.5 pl-8">Current year earnings</td>
                        <AmountCell value={bs.currentEarnings} currency={baseCurrency} neutral />
                      </tr>
                      <tr className={subtotalRow}><td className="px-4 py-3">Total equity</td><AmountCell value={bs.totalEquity} currency={baseCurrency} bold neutral /></tr>
                      <tr className={totalRow}>
                        <td className="px-4 py-3 text-base">Total liabilities + equity</td>
                        <AmountCell value={bs.totalLiabilities.plus(bs.totalEquity)} currency={baseCurrency} bold neutral />
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
                    <h2 className="text-xl font-bold leading-tight">Cash Flow Statement</h2>
                    <p className="text-xs opacity-80">Indirect method · {startDate} to {endDate} · {baseCurrency}</p>
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
                        {fmtMoney(cf.netChange, baseCurrency)}
                      </p>
                    </div>
                    <table className={tblBase}>
                      <thead>
                        <tr className={headRow}>
                          <th className="px-4 py-3 text-left font-bold">Particulars</th>
                          <th className="px-4 py-3 text-right font-bold">Amount ({baseCurrency})</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className={bandIncome}><td colSpan={2} className="px-4 py-3">OPERATING ACTIVITIES</td></tr>
                        <tr className={itemRow}><td className="px-4 py-2.5 pl-8">Net income</td><AmountCell value={cf.netIncome} currency={baseCurrency} /></tr>
                        <tr className={itemRow}><td className="px-4 py-2.5 pl-8">Add back: depreciation</td><AmountCell value={cf.depreciation} currency={baseCurrency} /></tr>
                        <tr className={subtotalRow}><td className="px-4 py-3">Cash from operations</td><AmountCell value={cf.operatingCash} currency={baseCurrency} bold /></tr>
                        <tr className={bandAsset}><td colSpan={2} className="px-4 py-3">INVESTING ACTIVITIES</td></tr>
                        <tr className={subtotalRow}><td className="px-4 py-3">Net cash from investing</td><AmountCell value={cf.investingCash} currency={baseCurrency} bold /></tr>
                        <tr className={bandEquity}><td colSpan={2} className="px-4 py-3">FINANCING ACTIVITIES</td></tr>
                        <tr className={subtotalRow}><td className="px-4 py-3">Net cash from financing</td><AmountCell value={cf.financingCash} currency={baseCurrency} bold /></tr>
                        <tr className={totalRow}>
                          <td className="px-4 py-3 text-base">NET CHANGE IN CASH</td>
                          <AmountCell value={cf.netChange} currency={baseCurrency} bold />
                        </tr>
                      </tbody>
                    </table>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="profit">
            <PerPropertyProfitReport hostId={hostId} startDate={startDate} endDate={endDate} baseCurrency={baseCurrency} propertyFilter={propertyFilter} />
          </TabsContent>

          <TabsContent value="recognition">
            <RecognitionVsBookingsReport hostId={hostId} startDate={startDate} endDate={endDate} baseCurrency={baseCurrency} />
          </TabsContent>

          <TabsContent value="property">
            <PerPropertyExpenseBreakdown hostId={hostId} startDate={startDate} endDate={endDate} baseCurrency={baseCurrency} propertyFilter={propertyFilter} />
          </TabsContent>

          <TabsContent value="aging">
            <AgingReport hostId={hostId} baseCurrency={baseCurrency} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
