import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { fmtMoney, D } from '@/lib/accounting/money';
import { getAccountBalances, type AccountBalance } from '@/lib/accounting/statements';
import { format, startOfYear } from 'date-fns';
import { useBaseCurrency } from '@/hooks/useBaseCurrency';

interface Entry {
  id: string; entry_date: string; description: string; reference: string | null; source_type: string;
  acct_journal_lines: { account_id: string; debit: number; credit: number; memo: string | null;
    acct_chart_of_accounts: { code: string; name: string } }[];
}

export function AccountingJournal({ hostId }: { hostId: string }) {
  const baseCurrency = useBaseCurrency(hostId);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [balances, setBalances] = useState<AccountBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(format(startOfYear(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const load = async () => {
    setLoading(true);
    const [ent, bal] = await Promise.all([
      supabase.from('acct_journal_entries')
        .select('id, entry_date, description, reference, source_type, acct_journal_lines(account_id, debit, credit, memo, acct_chart_of_accounts(code, name))')
        .eq('host_id', hostId)
        .gte('entry_date', startDate).lte('entry_date', endDate)
        .order('entry_date', { ascending: false }).limit(200),
      getAccountBalances(hostId, endDate, startDate),
    ]);
    setEntries((ent.data ?? []) as any);
    setBalances(bal);
    setLoading(false);
  };

  useEffect(() => { load(); }, [hostId, startDate, endDate]);

  const totalDebit = balances.reduce((s, r) => s.plus(r.debit), D(0));
  const totalCredit = balances.reduce((s, r) => s.plus(r.credit), D(0));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div><Label>From</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" /></div>
        <div><Label>To</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" /></div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Trial balance</CardTitle>
          {!loading && (
            <Badge variant={totalDebit.minus(totalCredit).abs().lt(0.01) ? 'default' : 'destructive'}>
              {totalDebit.minus(totalCredit).abs().lt(0.01)
                ? `Balanced ✓ (${fmtMoney(totalDebit, baseCurrency)})`
                : `Off by ${fmtMoney(totalDebit.minus(totalCredit).abs(), baseCurrency)}`}
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-40" /> : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Code</TableHead><TableHead>Account</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {balances.filter((b) => !b.debit.eq(0) || !b.credit.eq(0)).map((b) => (
                  <TableRow key={b.account_id}>
                    <TableCell className="font-mono text-xs">{b.code}</TableCell>
                    <TableCell>{b.name}</TableCell>
                    <TableCell className="text-right">{b.debit.gt(0) ? fmtMoney(b.debit, baseCurrency) : ''}</TableCell>
                    <TableCell className="text-right">{b.credit.gt(0) ? fmtMoney(b.credit, baseCurrency) : ''}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold border-t-2">
                  <TableCell colSpan={2}>Totals</TableCell>
                  <TableCell className="text-right">{fmtMoney(totalDebit, baseCurrency)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(totalCredit, baseCurrency)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">General ledger</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-40" /> : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No journal entries in this range.</p>
          ) : (
            <div className="space-y-3">
              {entries.map((e) => (
                <div key={e.id} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="text-sm font-medium">{e.description}</div>
                      <div className="text-xs text-muted-foreground">{e.entry_date} · {e.reference ?? '—'}</div>
                    </div>
                    <Badge variant="outline">{e.source_type}</Badge>
                  </div>
                  <Table>
                    <TableBody>
                      {e.acct_journal_lines.map((l, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs w-16">{l.acct_chart_of_accounts?.code}</TableCell>
                          <TableCell className="text-sm">{l.acct_chart_of_accounts?.name}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{l.memo}</TableCell>
                          <TableCell className="text-right text-sm w-24">{l.debit > 0 ? fmtMoney(l.debit, baseCurrency) : ''}</TableCell>
                          <TableCell className="text-right text-sm w-24">{l.credit > 0 ? fmtMoney(l.credit, baseCurrency) : ''}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
