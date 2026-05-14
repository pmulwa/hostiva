import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { D, fmtMoney } from '@/lib/accounting/money';
import { loadExistingOpeningBalances, postOpeningBalances, setOpeningBalanceLock } from '@/lib/accounting/openingBalances';
import { Info, Lock, Save, Unlock, Wand2 } from 'lucide-react';

interface Account {
  id: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
}

interface Row {
  account_id: string;
  code: string;
  name: string;
  type: Account['type'];
  debit: string;
  credit: string;
  locked: boolean;
  hadValue: boolean; // had a posted value before
}

const TYPE_LABELS: Record<Account['type'], string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  revenue: 'Revenue',
  expense: 'Expenses',
};

export function OpeningBalancesWizard({ hostId, baseCurrency }: { hostId: string; baseCurrency: string }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [goLiveDate, setGoLiveDate] = useState<string>('');
  const [rows, setRows] = useState<Row[]>([]);

  const refresh = async () => {
    setLoading(true);
    const [{ data: accs }, { data: settings }, existing] = await Promise.all([
      supabase
        .from('acct_chart_of_accounts')
        .select('id, code, name, type')
        .eq('host_id', hostId)
        .eq('is_active', true)
        .in('type', ['asset', 'liability', 'equity'])
        .order('code'),
      supabase.from('acct_settings').select('go_live_date').eq('host_id', hostId).maybeSingle(),
      loadExistingOpeningBalances(hostId),
    ]);

    const existingMap = new Map(existing.map((e: any) => [e.account_id, e]));
    const built: Row[] = (accs ?? []).map((a) => {
      const e: any = existingMap.get(a.id);
      const hadValue = !!e && (Number(e.debit) > 0 || Number(e.credit) > 0);
      return {
        account_id: a.id,
        code: a.code,
        name: a.name,
        type: a.type as Account['type'],
        debit: e?.debit ? String(e.debit) : '',
        credit: e?.credit ? String(e.credit) : '',
        locked: !!e?.locked,
        hadValue,
      };
    });
    setRows(built);
    setGoLiveDate(settings?.go_live_date ?? new Date().toISOString().slice(0, 10));
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [hostId]);

  const totals = useMemo(() => {
    let d = D(0); let c = D(0);
    for (const r of rows) {
      d = d.plus(D(r.debit || 0));
      c = c.plus(D(r.credit || 0));
    }
    return { d, c, diff: d.minus(c) };
  }, [rows]);

  const update = (idx: number, field: 'debit' | 'credit', val: string) => {
    setRows((prev) => prev.map((r, i) => {
      if (i !== idx) return r;
      if (r.locked) return r; // safety
      if (field === 'debit') return { ...r, debit: val, credit: val ? '' : r.credit };
      return { ...r, credit: val, debit: val ? '' : r.debit };
    }));
  };

  const toggleLock = async (idx: number) => {
    const row = rows[idx];
    if (!row.hadValue) {
      toast({ title: 'Nothing to lock', description: 'Post a balance for this account first, then lock it.', variant: 'destructive' });
      return;
    }
    try {
      await setOpeningBalanceLock(hostId, row.account_id, !row.locked);
      setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, locked: !r.locked } : r)));
      toast({ title: row.locked ? 'Unlocked' : 'Locked', description: `${row.code} — ${row.name}` });
    } catch (e: any) {
      toast({ title: 'Failed', description: e.message, variant: 'destructive' });
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const lines = rows.map((r) => ({
        account_id: r.account_id,
        code: r.code,
        name: r.name,
        type: r.type,
        debit: Number(r.debit || 0),
        credit: Number(r.credit || 0),
        locked: r.locked,
      }));

      const hasAny = lines.some((l) => l.debit > 0 || l.credit > 0);
      if (!hasAny) {
        toast({ title: 'Nothing to post', description: 'Enter at least one opening balance.', variant: 'destructive' });
        return;
      }

      const { plug } = await postOpeningBalances(hostId, goLiveDate, lines);
      toast({
        title: 'Opening balances posted',
        description: plug > 0
          ? `${fmtMoney(plug, baseCurrency)} auto-balanced to Opening balance equity.`
          : 'Entry was perfectly balanced.',
      });
      await refresh();
    } catch (e: any) {
      toast({ title: 'Failed', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Skeleton className="h-96 w-full" />;

  const groups: Account['type'][] = ['asset', 'liability', 'equity'];
  const lockedCount = rows.filter((r) => r.locked).length;
  const allEditableLocked = rows.filter((r) => r.hadValue).every((r) => r.locked) && lockedCount > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Wand2 className="w-4 h-4" /> Opening balances wizard
          {lockedCount > 0 && <Badge variant="secondary" className="ml-2">{lockedCount} locked</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-sm">
            Enter your account balances <strong>as of {goLiveDate || 'your go-live date'}</strong>.
            Assets normally take a <strong>debit</strong>; liabilities and equity take a <strong>credit</strong>.
            Any imbalance is plugged into <strong>3040 — Opening balance equity</strong> automatically.
            All amounts are in your base currency ({baseCurrency}).
            <br />
            Click the <Lock className="inline w-3 h-3" /> icon next to a posted account to <strong>lock it individually</strong> — locked rows cannot be edited until you unlock them.
          </AlertDescription>
        </Alert>

        <div className="max-w-xs">
          <Label>Go-live date</Label>
          <Input
            type="date"
            value={goLiveDate}
            onChange={(e) => setGoLiveDate(e.target.value)}
            disabled={allEditableLocked}
          />
        </div>

        {groups.map((g) => {
          const groupRows = rows.map((r, i) => ({ r, i })).filter((x) => x.r.type === g);
          if (groupRows.length === 0) return null;
          return (
            <div key={g} className="space-y-2">
              <h4 className="text-sm font-semibold">{TYPE_LABELS[g]}</h4>
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2 w-20">Code</th>
                      <th className="text-left p-2">Account</th>
                      <th className="text-right p-2 w-32">Debit</th>
                      <th className="text-right p-2 w-32">Credit</th>
                      <th className="text-center p-2 w-12">Lock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupRows.map(({ r, i }) => (
                      <tr key={r.account_id} className={`border-t ${r.locked ? 'bg-muted/30' : ''}`}>
                        <td className="p-2 font-mono text-xs">{r.code}</td>
                        <td className="p-2">
                          {r.name}
                          {r.locked && <Badge variant="outline" className="ml-2 text-[10px]">Locked</Badge>}
                        </td>
                        <td className="p-1">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={r.debit}
                            onChange={(e) => update(i, 'debit', e.target.value)}
                            className="h-8 text-right"
                            disabled={r.locked}
                          />
                        </td>
                        <td className="p-1">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={r.credit}
                            onChange={(e) => update(i, 'credit', e.target.value)}
                            className="h-8 text-right"
                            disabled={r.locked}
                          />
                        </td>
                        <td className="p-1 text-center">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => toggleLock(i)}
                            title={r.locked ? 'Unlock this account' : 'Lock this account'}
                            disabled={!r.hadValue}
                          >
                            {r.locked
                              ? <Lock className="w-4 h-4 text-primary" />
                              : <Unlock className="w-4 h-4 text-muted-foreground" />}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

        <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-md bg-muted/30 border">
          <div className="flex gap-4 text-sm flex-wrap">
            <div>Total debits: <strong>{fmtMoney(totals.d.toNumber(), baseCurrency)}</strong></div>
            <div>Total credits: <strong>{fmtMoney(totals.c.toNumber(), baseCurrency)}</strong></div>
            <div>
              Imbalance:{' '}
              {totals.diff.eq(0) ? (
                <Badge variant="outline">Balanced ✓</Badge>
              ) : (
                <Badge variant="secondary">
                  {fmtMoney(totals.diff.abs().toNumber(), baseCurrency)} → plug to 3040
                </Badge>
              )}
            </div>
          </div>
          <Button onClick={save} disabled={saving}>
            <Save className="w-4 h-4 mr-1" /> {saving ? 'Posting…' : 'Post opening balances'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
