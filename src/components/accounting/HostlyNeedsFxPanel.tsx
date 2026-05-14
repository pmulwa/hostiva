import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { D, fmtMoney } from '@/lib/accounting/money';
import { postJournalEntry } from '@/lib/accounting/journal';
import { getAccountByCode } from '@/lib/accounting/init';

interface NeedsFxRow {
  id: string;
  check_in_date: string;
  check_out_date: string;
  txn_currency: string;
  gross_revenue: number;
  cleaning_fee: number;
  commission_amount: number;
  net_payout: number;
  notes: string | null;
}

export function HostivaNeedsFxPanel({
  hostId,
  baseCurrency,
  onPosted,
}: {
  hostId: string;
  baseCurrency: string;
  onPosted: () => void;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<NeedsFxRow[]>([]);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from('acct_external_bookings')
      .select('id, check_in_date, check_out_date, txn_currency, gross_revenue, cleaning_fee, commission_amount, net_payout, notes')
      .eq('host_id', hostId)
      .eq('status', 'needs_fx')
      .order('check_out_date', { ascending: false });
    setRows((data ?? []) as any);
  };

  useEffect(() => { load(); }, [hostId]);

  const post = async (row: NeedsFxRow) => {
    const fx = D(rates[row.id] || 0);
    if (fx.lte(0)) {
      toast({ title: 'Enter a valid exchange rate', variant: 'destructive' });
      return;
    }
    setBusy(row.id);
    try {
      const gross = D(row.gross_revenue).times(fx);
      const cleaning = D(row.cleaning_fee).times(fx);
      const commission = D(row.commission_amount).times(fx);
      const net = D(row.net_payout).times(fx);

      const [acDeposit, acRevenue, acCommission, acCleaning] = await Promise.all([
        getAccountByCode(hostId, '1100'),
        getAccountByCode(hostId, '4010'),
        getAccountByCode(hostId, '5010'),
        getAccountByCode(hostId, '4100'),
      ]);
      if (!acDeposit || !acRevenue) {
        toast({ title: 'Missing accounts', description: 'Pending payouts (1100) or Hostiva revenue (4010) not found.', variant: 'destructive' });
        return;
      }

      const fxMemo = ` (${row.txn_currency} @ ${fx.toFixed(4)})`;
      const lines: any[] = [{ account_id: acDeposit, debit: net.toNumber(), memo: `Net payout from Hostiva${fxMemo}` }];
      if (commission.gt(0) && acCommission) lines.push({ account_id: acCommission, debit: commission.toNumber(), memo: `Hostiva service fee${fxMemo}` });
      if (gross.gt(0)) lines.push({ account_id: acRevenue, credit: gross.toNumber(), memo: `Gross rental revenue${fxMemo}` });
      if (cleaning.gt(0) && acCleaning) lines.push({ account_id: acCleaning, credit: cleaning.toNumber(), memo: `Cleaning fee income${fxMemo}` });

      const ref = (row.notes ?? '').replace('AUTO:HOSTLY:', '').slice(0, 8).toUpperCase();
      const entryId = await postJournalEntry({
        host_id: hostId,
        entry_date: row.check_out_date,
        description: `Hostiva booking — ${row.txn_currency} → ${baseCurrency}${fxMemo}`,
        reference: `HOSTIVA-${ref}`,
        source_type: 'booking',
        source_id: row.id,
        lines,
      });

      await supabase
        .from('acct_external_bookings')
        .update({
          fx_rate: fx.toNumber(),
          base_amount: net.toNumber(),
          journal_entry_id: entryId,
          status: 'auto',
        })
        .eq('id', row.id);

      toast({ title: 'Posted', description: `Net ${fmtMoney(net.toNumber(), baseCurrency)} added to your books.` });
      setRates((r) => { const n = { ...r }; delete n[row.id]; return n; });
      await load();
      onPosted();
    } catch (e: any) {
      toast({ title: 'Failed to post', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  if (rows.length === 0) return null;

  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-destructive" />
          Hostiva bookings awaiting exchange rate
          <Badge variant="destructive" className="ml-1">{rows.length}</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          These bookings are in a different currency than your base ({baseCurrency}). Enter the rate to post them to your books.
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stay</TableHead>
                <TableHead className="text-right">Net (txn)</TableHead>
                <TableHead className="w-[260px]">FX rate (1 txn = ? {baseCurrency})</TableHead>
                <TableHead className="text-right">Posts as</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const fx = D(rates[r.id] || 0);
                const preview = fx.gt(0) ? D(r.net_payout).times(fx).toNumber() : 0;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">
                      {r.check_in_date} → {r.check_out_date}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {fmtMoney(r.net_payout, r.txn_currency)}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.0001"
                        placeholder={`e.g. 130.5000`}
                        value={rates[r.id] ?? ''}
                        onChange={(e) => setRates((rt) => ({ ...rt, [r.id]: e.target.value }))}
                      />
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {fx.gt(0) ? <strong>{fmtMoney(preview, baseCurrency)}</strong> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" onClick={() => post(r)} disabled={busy === r.id || fx.lte(0)}>
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                        {busy === r.id ? 'Posting…' : 'Post'}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
