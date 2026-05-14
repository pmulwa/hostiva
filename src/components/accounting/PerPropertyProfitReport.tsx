import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Download, TrendingUp, TrendingDown } from 'lucide-react';
import { fmtMoney, D } from '@/lib/accounting/money';

interface Props { hostId: string; startDate: string; endDate: string; baseCurrency: string; propertyFilter?: string | null; }

interface Row {
  property_id: string | null;
  title: string;
  revenue: number;
  directExpense: number;
  sharedExpense: number;
  totalExpense: number;
  profit: number;
  margin: number; // 0..1
}

const UNALLOCATED_KEY = '__unallocated__';

export function PerPropertyProfitReport({ hostId, startDate, endDate, baseCurrency, propertyFilter }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [propsRes, bookingsRes, externalRes, expensesRes] = await Promise.all([
        supabase.from('properties').select('id, title').eq('host_id', hostId),
        // Hostiva bookings — recognise revenue by check-out date in window, only counted statuses
        supabase
          .from('bookings')
          .select('id, property_id, subtotal, cleaning_fee, currency, check_out_date, status')
          .eq('host_id', hostId)
          .in('status', ['confirmed', 'completed'] as any)
          .gte('check_out_date', startDate)
          .lte('check_out_date', endDate),
        // External / auto-posted bookings (uses base_amount when host is multi-currency)
        supabase
          .from('acct_external_bookings')
          .select('property_id, gross_revenue, cleaning_fee, base_amount, fx_rate, txn_currency, check_out_date, status, notes')
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

      // Build a lookup of FX rates from auto-imported Hostiva rows so we can convert
      // internal Hostiva bookings (which are stored in their booking currency, e.g. USD)
      // into the host's base currency (e.g. KES).
      const fxByBookingId = new Map<string, number>();
      (externalRes.data ?? []).forEach((eb: any) => {
        const note: string = eb.notes ?? '';
        const m = note.match(/^AUTO:HOSTLY:([0-9a-f-]+)/i);
        if (m && eb.fx_rate) fxByBookingId.set(m[1], Number(eb.fx_rate));
      });

      const map = new Map<string, Row>();
      const ensure = (id: string | null, title: string): Row => {
        const key = id ?? UNALLOCATED_KEY;
        let r = map.get(key);
        if (!r) {
          r = { property_id: id, title, revenue: 0, directExpense: 0, sharedExpense: 0, totalExpense: 0, profit: 0, margin: 0 };
          map.set(key, r);
        }
        return r;
      };

      // Seed all known properties so they appear with 0s
      (propsRes.data ?? []).forEach((p: any) => ensure(p.id, p.title));

      // Revenue from internal bookings (Hostiva platform) — convert to base currency
      // using the fx rate captured at auto-post time when currencies differ.
      (bookingsRes.data ?? []).forEach((b: any) => {
        const title = b.property_id ? (titleById.get(b.property_id) ?? 'Removed property') : 'Unallocated';
        const r = ensure(b.property_id, title);
        const fx = D(fxByBookingId.get(b.id) ?? 1);
        r.revenue += D(b.subtotal ?? 0).plus(D(b.cleaning_fee ?? 0)).times(fx).toNumber();
      });

      // Revenue from external bookings — prefer base_amount, otherwise convert via fx_rate
      (externalRes.data ?? []).forEach((b: any) => {
        // Skip Hostiva auto-rows here — they were already counted via the internal bookings list
        // (otherwise we'd double-count Hostiva revenue).
        const note: string = b.notes ?? '';
        if (/^AUTO:HOSTLY:/i.test(note)) return;
        const title = b.property_id ? (titleById.get(b.property_id) ?? 'Removed property') : 'Unallocated';
        const r = ensure(b.property_id, title);
        const fx = D(b.fx_rate ?? 1);
        const rev = D(b.gross_revenue ?? 0).plus(D(b.cleaning_fee ?? 0)).times(fx);
        r.revenue += rev.toNumber();
      });

      // Expenses (direct + allocated shared)
      (expensesRes.data ?? []).forEach((e: any) => {
        const baseAmt = D(e.base_amount ?? e.amount ?? 0);
        if (e.is_shared && Array.isArray(e.allocations) && e.allocations.length > 0) {
          let allocated = D(0);
          e.allocations.forEach((a: any) => {
            const ratio = D(a.ratio ?? 0);
            const portion = baseAmt.times(ratio);
            allocated = allocated.plus(portion);
            const title = titleById.get(a.property_id) ?? 'Removed property';
            const r = ensure(a.property_id, title);
            r.sharedExpense += portion.toNumber();
          });
          const remainder = baseAmt.minus(allocated);
          if (remainder.abs().gt(0.01)) {
            const r = ensure(null, 'Unallocated');
            r.sharedExpense += remainder.toNumber();
          }
        } else {
          const title = e.property_id ? (titleById.get(e.property_id) ?? 'Removed property') : 'Unallocated';
          const r = ensure(e.property_id, title);
          r.directExpense += baseAmt.toNumber();
        }
      });

      // Finalise totals + profit
      const finals = Array.from(map.values()).map((r) => {
        const totalExpense = r.directExpense + r.sharedExpense;
        const profit = r.revenue - totalExpense;
        const margin = r.revenue > 0 ? profit / r.revenue : 0;
        return { ...r, totalExpense, profit, margin };
      });

      // Hide rows that are entirely empty unless they're the unallocated bucket with data
      let filtered = finals.filter((r) => r.revenue !== 0 || r.totalExpense !== 0);
      if (propertyFilter && propertyFilter !== 'all') {
        filtered = filtered.filter((r) => r.property_id === propertyFilter);
      }
      filtered.sort((a, b) => b.profit - a.profit);
      setRows(filtered);
      setLoading(false);
    })();
  }, [hostId, startDate, endDate, propertyFilter]);

  const totals = useMemo(() => {
    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    const direct = rows.reduce((s, r) => s + r.directExpense, 0);
    const shared = rows.reduce((s, r) => s + r.sharedExpense, 0);
    const totalExpense = direct + shared;
    const profit = revenue - totalExpense;
    const margin = revenue > 0 ? profit / revenue : 0;
    return { revenue, direct, shared, totalExpense, profit, margin };
  }, [rows]);

  const maxAbsProfit = useMemo(() => Math.max(1, ...rows.map((r) => Math.abs(r.profit))), [rows]);

  const exportCsv = () => {
    const lines = ['Property,Revenue,Direct expenses,Shared expenses,Total expenses,Net profit,Margin %'];
    rows.forEach((r) => {
      lines.push(
        `"${r.title}",${r.revenue.toFixed(2)},${r.directExpense.toFixed(2)},${r.sharedExpense.toFixed(2)},${r.totalExpense.toFixed(2)},${r.profit.toFixed(2)},${(r.margin * 100).toFixed(2)}`
      );
    });
    lines.push(`Total,${totals.revenue.toFixed(2)},${totals.direct.toFixed(2)},${totals.shared.toFixed(2)},${totals.totalExpense.toFixed(2)},${totals.profit.toFixed(2)},${(totals.margin * 100).toFixed(2)}`);
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `profit_by_property_${startDate}_${endDate}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4" /> Profit by property
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Revenue (booking subtotals + cleaning) minus direct expenses + your share of pooled costs.
              Capitalized purchases are excluded.
            </p>
          </div>
          {rows.length > 0 && (
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="w-4 h-4 mr-1" /> Export CSV
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-48" /> : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No revenue or expense activity in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Direct exp.</TableHead>
                  <TableHead className="text-right">Shared exp.</TableHead>
                  <TableHead className="text-right">Net profit</TableHead>
                  <TableHead className="text-right w-20">Margin</TableHead>
                  <TableHead className="w-40">Profit scale</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const pct = (Math.abs(r.profit) / maxAbsProfit) * 100;
                  const positive = r.profit >= 0;
                  return (
                    <TableRow key={r.property_id ?? UNALLOCATED_KEY}>
                      <TableCell className="font-medium">{r.title}</TableCell>
                      <TableCell className="text-right">{fmtMoney(r.revenue, baseCurrency)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{fmtMoney(r.directExpense, baseCurrency)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{fmtMoney(r.sharedExpense, baseCurrency)}</TableCell>
                      <TableCell className={`text-right font-semibold ${positive ? 'text-emerald-600' : 'text-destructive'}`}>
                        <span className="inline-flex items-center gap-1 justify-end">
                          {positive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                          {fmtMoney(r.profit, baseCurrency)}
                        </span>
                      </TableCell>
                      <TableCell className={`text-right ${positive ? '' : 'text-destructive'}`}>
                        {r.revenue > 0 ? `${(r.margin * 100).toFixed(1)}%` : '—'}
                      </TableCell>
                      <TableCell>
                        <Progress
                          value={pct}
                          className={`h-2 ${positive ? '' : '[&>div]:bg-destructive'}`}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="font-semibold border-t-2">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">{fmtMoney(totals.revenue, baseCurrency)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(totals.direct, baseCurrency)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(totals.shared, baseCurrency)}</TableCell>
                  <TableCell className={`text-right ${totals.profit >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                    {fmtMoney(totals.profit, baseCurrency)}
                  </TableCell>
                  <TableCell className="text-right">
                    {totals.revenue > 0 ? `${(totals.margin * 100).toFixed(1)}%` : '—'}
                  </TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
