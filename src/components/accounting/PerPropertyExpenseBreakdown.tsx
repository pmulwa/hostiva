import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { fmtMoney, D } from '@/lib/accounting/money';
import { Building2, Share2 } from 'lucide-react';

interface Props { hostId: string; startDate: string; endDate: string; baseCurrency: string; propertyFilter?: string | null; }

interface Row {
  property_id: string | null;
  title: string;
  direct: number;
  shared: number;
  total: number;
}

const UNALLOCATED_KEY = '__unallocated__';

export function PerPropertyExpenseBreakdown({ hostId, startDate, endDate, baseCurrency, propertyFilter }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [sharedCount, setSharedCount] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: props }, { data: exps }] = await Promise.all([
        supabase.from('properties').select('id, title').eq('host_id', hostId),
        supabase
          .from('acct_expenses')
          .select('id, property_id, base_amount, amount, is_shared, allocations, is_capitalized')
          .eq('host_id', hostId)
          .eq('is_capitalized', false)
          .gte('expense_date', startDate)
          .lte('expense_date', endDate),
      ]);
      const titleById = new Map<string, string>();
      (props ?? []).forEach((p: any) => titleById.set(p.id, p.title));

      const map = new Map<string, Row>();
      const ensure = (id: string | null, title: string): Row => {
        const key = id ?? UNALLOCATED_KEY;
        let r = map.get(key);
        if (!r) { r = { property_id: id, title, direct: 0, shared: 0, total: 0 }; map.set(key, r); }
        return r;
      };

      let nShared = 0;
      (exps ?? []).forEach((e: any) => {
        const baseAmt = D(e.base_amount ?? e.amount ?? 0);
        if (e.is_shared && Array.isArray(e.allocations) && e.allocations.length > 0) {
          nShared++;
          let allocated = D(0);
          e.allocations.forEach((a: any) => {
            const ratio = D(a.ratio ?? 0);
            const portion = baseAmt.times(ratio);
            allocated = allocated.plus(portion);
            const title = titleById.get(a.property_id) ?? 'Removed property';
            const r = ensure(a.property_id, title);
            r.shared += portion.toNumber();
            r.total += portion.toNumber();
          });
          // Any rounding remainder → unallocated bucket
          const remainder = baseAmt.minus(allocated);
          if (remainder.abs().gt(0.01)) {
            const r = ensure(null, 'Unallocated');
            r.shared += remainder.toNumber();
            r.total += remainder.toNumber();
          }
        } else {
          const title = e.property_id ? (titleById.get(e.property_id) ?? 'Removed property') : 'Unallocated';
          const r = ensure(e.property_id, title);
          r.direct += baseAmt.toNumber();
          r.total += baseAmt.toNumber();
        }
      });

      let sorted = Array.from(map.values()).sort((a, b) => b.total - a.total);
      if (propertyFilter && propertyFilter !== 'all') {
        sorted = sorted.filter((r) => r.property_id === propertyFilter);
      }
      setRows(sorted);
      setSharedCount(nShared);
      setLoading(false);
    })();
  }, [hostId, startDate, endDate, propertyFilter]);

  const grandTotal = useMemo(() => rows.reduce((s, r) => s + r.total, 0), [rows]);
  const max = useMemo(() => Math.max(1, ...rows.map((r) => r.total)), [rows]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="w-4 h-4" /> Expenses by property
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Direct expenses + your share of pooled costs (cleaning supplies, utilities, etc.).
            </p>
          </div>
          {sharedCount > 0 && (
            <Badge variant="secondary" className="gap-1">
              <Share2 className="w-3 h-3" /> {sharedCount} shared expense{sharedCount === 1 ? '' : 's'} allocated
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-48" /> : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No expenses in this period.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead className="text-right">Direct</TableHead>
                <TableHead className="text-right">Shared</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right w-24">% of total</TableHead>
                <TableHead className="w-40">Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const pct = grandTotal > 0 ? (r.total / grandTotal) * 100 : 0;
                const bar = (r.total / max) * 100;
                return (
                  <TableRow key={r.property_id ?? UNALLOCATED_KEY}>
                    <TableCell className="font-medium">{r.title}</TableCell>
                    <TableCell className="text-right">{fmtMoney(r.direct, baseCurrency)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmtMoney(r.shared, baseCurrency)}</TableCell>
                    <TableCell className="text-right font-semibold">{fmtMoney(r.total, baseCurrency)}</TableCell>
                    <TableCell className="text-right">{pct.toFixed(1)}%</TableCell>
                    <TableCell><Progress value={bar} className="h-2" /></TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="font-semibold border-t-2">
                <TableCell>Total</TableCell>
                <TableCell colSpan={2}></TableCell>
                <TableCell className="text-right">{fmtMoney(grandTotal, baseCurrency)}</TableCell>
                <TableCell className="text-right">100%</TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
