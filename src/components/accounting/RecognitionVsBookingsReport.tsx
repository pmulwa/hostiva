import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Download, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { fmtMoney, D } from '@/lib/accounting/money';
import { supabase } from '@/integrations/supabase/client';
import Decimal from 'decimal.js';

interface Props {
  hostId: string;
  startDate: string;
  endDate: string;
  baseCurrency: string;
}

interface MonthRow {
  month: string; // YYYY-MM
  recognizedRevenue: Decimal; // by check_out_date
  recognizedNights: number;
  bookingsCreated: number;
  bookedValueCreated: Decimal;
  bookingsConfirmed: number;
  bookedValueConfirmed: Decimal;
}

function ymKey(date: string): string {
  return date.slice(0, 7); // YYYY-MM
}

function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

export function RecognitionVsBookingsReport({ hostId, startDate, endDate, baseCurrency }: Props) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<MonthRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);

      // Recognized revenue — guest checkouts within window (income recognition rule)
      const { data: checkouts } = await supabase
        .from('bookings')
        .select('check_out_date, subtotal, num_nights, status')
        .eq('host_id', hostId)
        .gte('check_out_date', startDate)
        .lte('check_out_date', endDate)
        .in('status', ['completed', 'in_progress', 'confirmed']);

      // Bookings created in window
      const { data: created } = await supabase
        .from('bookings')
        .select('created_at, subtotal, status')
        .eq('host_id', hostId)
        .gte('created_at', `${startDate}T00:00:00.000Z`)
        .lte('created_at', `${endDate}T23:59:59.999Z`);

      // Bookings confirmed (host_approved_at) in window
      const { data: confirmed } = await supabase
        .from('bookings')
        .select('host_approved_at, subtotal, status')
        .eq('host_id', hostId)
        .not('host_approved_at', 'is', null)
        .gte('host_approved_at', `${startDate}T00:00:00.000Z`)
        .lte('host_approved_at', `${endDate}T23:59:59.999Z`);

      if (cancelled) return;

      const map = new Map<string, MonthRow>();
      const ensure = (ym: string): MonthRow => {
        let r = map.get(ym);
        if (!r) {
          r = {
            month: ym,
            recognizedRevenue: D(0),
            recognizedNights: 0,
            bookingsCreated: 0,
            bookedValueCreated: D(0),
            bookingsConfirmed: 0,
            bookedValueConfirmed: D(0),
          };
          map.set(ym, r);
        }
        return r;
      };

      // Only count revenue once status is 'completed' (matches journal posting rule),
      // but show "expected recognition" for upcoming checkouts as a separate column too.
      // For simplicity here, we recognize when checkout has passed AND status = completed.
      for (const b of checkouts ?? []) {
        if (b.status !== 'completed') continue;
        const ym = ymKey(b.check_out_date);
        const r = ensure(ym);
        r.recognizedRevenue = r.recognizedRevenue.plus(D(b.subtotal ?? 0));
        r.recognizedNights += Number(b.num_nights ?? 0);
      }

      for (const b of created ?? []) {
        const ym = ymKey((b.created_at as string).slice(0, 10));
        const r = ensure(ym);
        r.bookingsCreated += 1;
        r.bookedValueCreated = r.bookedValueCreated.plus(D(b.subtotal ?? 0));
      }

      for (const b of confirmed ?? []) {
        if (!b.host_approved_at) continue;
        const ym = ymKey((b.host_approved_at as string).slice(0, 10));
        const r = ensure(ym);
        r.bookingsConfirmed += 1;
        r.bookedValueConfirmed = r.bookedValueConfirmed.plus(D(b.subtotal ?? 0));
      }

      const sorted = Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
      setRows(sorted);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [hostId, startDate, endDate]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        recognizedRevenue: acc.recognizedRevenue.plus(r.recognizedRevenue),
        recognizedNights: acc.recognizedNights + r.recognizedNights,
        bookingsCreated: acc.bookingsCreated + r.bookingsCreated,
        bookedValueCreated: acc.bookedValueCreated.plus(r.bookedValueCreated),
        bookingsConfirmed: acc.bookingsConfirmed + r.bookingsConfirmed,
        bookedValueConfirmed: acc.bookedValueConfirmed.plus(r.bookedValueConfirmed),
      }),
      {
        recognizedRevenue: D(0),
        recognizedNights: 0,
        bookingsCreated: 0,
        bookedValueCreated: D(0),
        bookingsConfirmed: 0,
        bookedValueConfirmed: D(0),
      }
    );
  }, [rows]);

  const pipelineGap = totals.bookedValueConfirmed.minus(totals.recognizedRevenue);
  const gapPositive = pipelineGap.gte(0);

  const exportCsv = () => {
    const lines = [
      'Month,Recognized revenue (checkout),Recognized nights,Bookings created,Booked value (created),Bookings confirmed,Booked value (confirmed)',
    ];
    for (const r of rows) {
      lines.push(
        [
          fmtMonth(r.month),
          r.recognizedRevenue.toFixed(2),
          r.recognizedNights,
          r.bookingsCreated,
          r.bookedValueCreated.toFixed(2),
          r.bookingsConfirmed,
          r.bookedValueConfirmed.toFixed(2),
        ].join(',')
      );
    }
    lines.push(
      [
        'TOTAL',
        totals.recognizedRevenue.toFixed(2),
        totals.recognizedNights,
        totals.bookingsCreated,
        totals.bookedValueCreated.toFixed(2),
        totals.bookingsConfirmed,
        totals.bookedValueConfirmed.toFixed(2),
      ].join(',')
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recognition_vs_bookings_${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <Skeleton className="h-96" />;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base">Recognition vs Bookings</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            <strong>Recognized revenue</strong> = subtotal of stays whose <em>check-out date</em> falls in the period
            (income is booked at check-out). Compared against bookings <em>created</em> and <em>confirmed</em> in the
            same window — useful to see future pipeline vs realised income.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="w-4 h-4 mr-1" />Export CSV
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Recognized revenue</div>
            <div className="text-xl font-semibold">{fmtMoney(totals.recognizedRevenue, baseCurrency)}</div>
            <div className="text-xs text-muted-foreground mt-1">{totals.recognizedNights} nights</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Booked (created)</div>
            <div className="text-xl font-semibold">{fmtMoney(totals.bookedValueCreated, baseCurrency)}</div>
            <div className="text-xs text-muted-foreground mt-1">{totals.bookingsCreated} bookings</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Booked (confirmed)</div>
            <div className="text-xl font-semibold">{fmtMoney(totals.bookedValueConfirmed, baseCurrency)}</div>
            <div className="text-xs text-muted-foreground mt-1">{totals.bookingsConfirmed} bookings</div>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
          {pipelineGap.eq(0) ? (
            <Minus className="w-4 h-4 text-muted-foreground" />
          ) : gapPositive ? (
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          ) : (
            <TrendingDown className="w-4 h-4 text-destructive" />
          )}
          <span>
            Pipeline gap (confirmed − recognized):{' '}
            <strong className={gapPositive ? 'text-emerald-600' : 'text-destructive'}>
              {fmtMoney(pipelineGap, baseCurrency)}
            </strong>
            <span className="text-muted-foreground ml-2">
              {gapPositive
                ? '— future check-outs will recognise this as revenue.'
                : '— more was recognised than newly confirmed in this period.'}
            </span>
          </span>
        </div>

        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No booking activity in this period.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Recognized revenue</TableHead>
                  <TableHead className="text-right">Nights</TableHead>
                  <TableHead className="text-right">Created (#)</TableHead>
                  <TableHead className="text-right">Created value</TableHead>
                  <TableHead className="text-right">Confirmed (#)</TableHead>
                  <TableHead className="text-right">Confirmed value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.month}>
                    <TableCell className="font-medium">{fmtMonth(r.month)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(r.recognizedRevenue, baseCurrency)}</TableCell>
                    <TableCell className="text-right">{r.recognizedNights}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">{r.bookingsCreated}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{fmtMoney(r.bookedValueCreated, baseCurrency)}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline">{r.bookingsConfirmed}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{fmtMoney(r.bookedValueConfirmed, baseCurrency)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold border-t-2">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">{fmtMoney(totals.recognizedRevenue, baseCurrency)}</TableCell>
                  <TableCell className="text-right">{totals.recognizedNights}</TableCell>
                  <TableCell className="text-right">{totals.bookingsCreated}</TableCell>
                  <TableCell className="text-right">{fmtMoney(totals.bookedValueCreated, baseCurrency)}</TableCell>
                  <TableCell className="text-right">{totals.bookingsConfirmed}</TableCell>
                  <TableCell className="text-right">{fmtMoney(totals.bookedValueConfirmed, baseCurrency)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}