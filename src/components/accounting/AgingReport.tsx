import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { differenceInDays, parseISO, format } from 'date-fns';
import { fmtMoney } from '@/lib/accounting/money';

type Bucket = '0-30' | '31-60' | '61-90' | '90+';
const BUCKETS: Bucket[] = ['0-30', '31-60', '61-90', '90+'];

interface AgingRow {
  id: string;
  party: string;       // guest or vendor
  reference: string;   // booking id / expense id
  date: string;        // due date proxy
  daysOverdue: number;
  bucket: Bucket;
  amount: number;
}

const bucketFor = (days: number): Bucket => {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
};

export function AgingReport({ hostId, baseCurrency }: { hostId: string; baseCurrency: string }) {
  const [arRows, setArRows] = useState<AgingRow[]>([]);
  const [apRows, setApRows] = useState<AgingRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const today = new Date();

      // A/R: external bookings still receivable
      const { data: bookings } = await supabase
        .from('acct_external_bookings')
        .select('id, guest_name, check_out_date, net_payout, base_amount, payment_status')
        .eq('host_id', hostId)
        .neq('payment_status', 'cleared')
        .neq('payment_status', 'received');

      const ar: AgingRow[] = (bookings ?? [])
        .filter((b: any) => b.payment_status === 'receivable' || b.payment_status === 'pending')
        .map((b: any) => {
          const days = Math.max(0, differenceInDays(today, parseISO(b.check_out_date)));
          const amount = Number(b.base_amount ?? b.net_payout ?? 0);
          return {
            id: b.id,
            party: b.guest_name || 'Unnamed guest',
            reference: `BK-${b.id.slice(0, 8).toUpperCase()}`,
            date: b.check_out_date,
            daysOverdue: days,
            bucket: bucketFor(days),
            amount,
          };
        })
        .filter((r) => r.amount > 0);

      // A/P: unpaid expenses
      const { data: expenses } = await supabase
        .from('acct_expenses')
        .select('id, vendor, description, expense_date, amount, base_amount, payment_status')
        .eq('host_id', hostId)
        .eq('payment_status', 'unpaid');

      const ap: AgingRow[] = (expenses ?? []).map((e: any) => {
        const days = Math.max(0, differenceInDays(today, parseISO(e.expense_date)));
        const amount = Number(e.base_amount ?? e.amount ?? 0);
        return {
          id: e.id,
          party: e.vendor || e.description.slice(0, 40),
          reference: `EXP-${e.id.slice(0, 8).toUpperCase()}`,
          date: e.expense_date,
          daysOverdue: days,
          bucket: bucketFor(days),
          amount,
        };
      }).filter((r) => r.amount > 0);

      setArRows(ar.sort((a, b) => b.daysOverdue - a.daysOverdue));
      setApRows(ap.sort((a, b) => b.daysOverdue - a.daysOverdue));
      setLoading(false);
    })();
  }, [hostId]);

  if (loading) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      <AgingTable title="Accounts receivable aging" rows={arRows} baseCurrency={baseCurrency} emptyText="No outstanding receivables 🎉" />
      <AgingTable title="Accounts payable aging" rows={apRows} baseCurrency={baseCurrency} emptyText="No unpaid bills 🎉" />
    </div>
  );
}

function AgingTable({ title, rows, baseCurrency, emptyText }: {
  title: string; rows: AgingRow[]; baseCurrency: string; emptyText: string;
}) {
  const totals: Record<Bucket, number> = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  rows.forEach((r) => { totals[r.bucket] += r.amount; });
  const grand = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Bucket summary */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
          {BUCKETS.map((b) => (
            <div key={b} className="rounded-md border p-3">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{b} days</div>
              <div className="font-semibold mt-0.5">{fmtMoney(totals[b], baseCurrency)}</div>
            </div>
          ))}
          <div className="rounded-md border p-3 bg-muted/40">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Total</div>
            <div className="font-semibold mt-0.5">{fmtMoney(grand, baseCurrency)}</div>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">{emptyText}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Bucket</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.reference}</TableCell>
                    <TableCell>{r.party}</TableCell>
                    <TableCell className="text-xs">{format(parseISO(r.date), 'MMM d, yyyy')}</TableCell>
                    <TableCell className="text-xs">{r.daysOverdue}</TableCell>
                    <TableCell>
                      <Badge variant={r.bucket === '90+' ? 'destructive' : r.bucket === '61-90' ? 'default' : 'secondary'}>
                        {r.bucket}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{fmtMoney(r.amount, baseCurrency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
