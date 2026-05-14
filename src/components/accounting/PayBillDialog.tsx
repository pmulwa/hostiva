import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { fmtMoney, D } from '@/lib/accounting/money';
import { postJournalEntry } from '@/lib/accounting/journal';
import { getAccountByCode } from '@/lib/accounting/init';
import { format } from 'date-fns';
import { Copy } from 'lucide-react';
import { AccountPicker, type PickerAccount } from './AccountPicker';

interface ExpenseRow {
  id: string;
  description: string;
  vendor: string | null;
  amount: number;
  base_amount: number | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  hostId: string;
  baseCurrency: string;
  expense: ExpenseRow | null;
  accounts: PickerAccount[];
  onDone: () => void;
}

const TODAY = () => format(new Date(), 'yyyy-MM-dd');

export function PayBillDialog({
  open, onOpenChange, hostId, baseCurrency, expense, accounts, onDone,
}: Props) {
  const { toast } = useToast();
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(TODAY());
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [paidSoFar, setPaidSoFar] = useState(0);
  const [loadingPaid, setLoadingPaid] = useState(false);

  const totalDue = expense ? Number(expense.base_amount ?? expense.amount) : 0;
  const outstanding = useMemo(
    () => Math.max(0, D(totalDue).minus(D(paidSoFar)).toNumber()),
    [totalDue, paidSoFar],
  );

  useEffect(() => {
    if (!open || !expense) return;
    setDate(TODAY());
    setReference('');
    // Default to Mobile money (1040), fallback to first cash/bank account
    const mm = accounts.find((a) => a.code === '1040');
    const fallback = accounts.find((a) => a.code.startsWith('10') || a.code.startsWith('11'));
    setAccountId(mm?.id ?? fallback?.id ?? '');

    // Compute total already paid against this expense via prior clearing entries
    (async () => {
      setLoadingPaid(true);
      try {
        const apId = await getAccountByCode(hostId, '2010');
        if (!apId) { setPaidSoFar(0); return; }
        // Find all manual journal entries posted against this expense as source
        const { data: entries } = await supabase
          .from('acct_journal_entries')
          .select('id')
          .eq('host_id', hostId)
          .eq('source_type', 'manual')
          .eq('source_id', expense.id);
        const ids = (entries ?? []).map((e: any) => e.id);
        if (ids.length === 0) { setPaidSoFar(0); return; }
        const { data: lines } = await supabase
          .from('acct_journal_lines')
          .select('debit, account_id, entry_id')
          .in('entry_id', ids)
          .eq('account_id', apId);
        const sum = (lines ?? []).reduce((s: number, l: any) => s + Number(l.debit ?? 0), 0);
        setPaidSoFar(sum);
        setPayAmount(Math.max(0, D(expense.base_amount ?? expense.amount).minus(D(sum)).toNumber()).toFixed(2));
      } finally {
        setLoadingPaid(false);
      }
    })();
  }, [open, expense, accounts, hostId]);

  const selectedAccountName = useMemo(
    () => accounts.find((a) => a.id === accountId)?.name ?? null,
    [accounts, accountId],
  );

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setReference(text.trim());
    } catch {
      toast({ title: 'Clipboard unavailable', description: 'Paste manually with Ctrl/Cmd + V.', variant: 'destructive' });
    }
  };

  const submit = async () => {
    if (!expense) return;
    if (!accountId) { toast({ title: 'Pick the account paid from', variant: 'destructive' }); return; }
    if (date > TODAY()) { toast({ title: 'Date cannot be in the future', variant: 'destructive' }); return; }
    const amt = D(payAmount || 0);
    if (amt.lte(0)) { toast({ title: 'Enter a payment amount greater than 0', variant: 'destructive' }); return; }
    if (amt.gt(D(outstanding).plus(0.001))) {
      toast({ title: 'Payment exceeds amount owed', description: `You owe ${fmtMoney(outstanding, baseCurrency)}.`, variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const apId = await getAccountByCode(hostId, '2010');
      if (!apId) throw new Error('Accounts payable account (2010) missing.');
      const refSuffix = reference ? ` — ref ${reference}` : '';
      const newPaidTotal = D(paidSoFar).plus(amt);
      const fullyCleared = newPaidTotal.gte(D(totalDue).minus(0.001));
      const partialMemo = fullyCleared ? '' : ` (partial: ${fmtMoney(amt.toNumber(), baseCurrency)} of ${fmtMoney(totalDue, baseCurrency)} — ${fmtMoney(D(totalDue).minus(newPaidTotal).toNumber(), baseCurrency)} still owed)`;
      const entryId = await postJournalEntry({
        host_id: hostId,
        entry_date: date,
        description: `${fullyCleared ? 'Pay bill' : 'Partial payment'} — ${expense.description}${refSuffix}${partialMemo}`,
        reference: `AP-CLR-${expense.id.slice(0, 8).toUpperCase()}-${Date.now().toString(36).slice(-4).toUpperCase()}`,
        source_type: 'manual',
        source_id: expense.id,
        lines: [
          { account_id: apId, debit: amt.toNumber(), memo: fullyCleared ? 'Clear A/P' : 'Reduce A/P (partial)' },
          { account_id: accountId, credit: amt.toNumber(), memo: `${fullyCleared ? 'Bill paid' : 'Partial payment'}${refSuffix}` },
        ],
      });
      // Only flip status to 'paid' once fully cleared. Keep last entry as the clearing reference.
      const update: any = {
        clearing_entry_id: entryId,
        payment_method: selectedAccountName,
        payment_reference: reference || null,
      };
      if (fullyCleared) {
        update.payment_status = 'paid';
        update.paid_date = date;
      }
      await supabase.from('acct_expenses').update(update).eq('id', expense.id);
      toast({
        title: fullyCleared ? 'Bill paid in full' : 'Partial payment recorded',
        description: fullyCleared
          ? `${fmtMoney(amt.toNumber(), baseCurrency)} cleared the remaining A/P.`
          : `${fmtMoney(amt.toNumber(), baseCurrency)} paid · ${fmtMoney(D(totalDue).minus(newPaidTotal).toNumber(), baseCurrency)} still owed.`,
      });
      onDone();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'Failed', description: e.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const setFull = () => setPayAmount(outstanding.toFixed(2));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pay bill</DialogTitle>
        </DialogHeader>
        {expense && (
          <div className="space-y-4">
            <div className="rounded-md bg-muted/40 border p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Vendor</span>
                <span>{expense.vendor ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total bill</span>
                <span>{fmtMoney(totalDue, baseCurrency)}</span>
              </div>
              {paidSoFar > 0 && (
                <div className="flex justify-between text-primary">
                  <span>Already paid</span>
                  <span>− {fmtMoney(paidSoFar, baseCurrency)}</span>
                </div>
              )}
              <div className="flex justify-between border-t pt-1 mt-1">
                <span className="text-muted-foreground">Amount due now</span>
                <strong>{loadingPaid ? '…' : fmtMoney(outstanding, baseCurrency)}</strong>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label>Payment amount *</Label>
                <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={setFull}>
                  Pay full ({fmtMoney(outstanding, baseCurrency)})
                </Button>
              </div>
              <Input
                type="number"
                step="0.01"
                min="0"
                max={outstanding}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder="0.00"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Pay less than {fmtMoney(outstanding, baseCurrency)} to record a partial payment — the unpaid balance stays in Accounts payable.
              </p>
            </div>

            <div>
              <Label>Paid from (debited)</Label>
              <AccountPicker
                accounts={accounts}
                value={accountId}
                onChange={setAccountId}
                codePrefixes={['10', '11']}
                placeholder="Search cash, bank, mobile money…"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Defaults to Mobile money — change if you paid from another account.
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label>Payment reference (optional)</Label>
                <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={pasteFromClipboard}>
                  <Copy className="w-3 h-3 mr-1" /> Paste
                </Button>
              </div>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="MPesa code, cheque #, txn ID…"
              />
            </div>

            <div>
              <Label>Date paid *</Label>
              <Input type="date" value={date} max={TODAY()} onChange={(e) => setDate(e.target.value)} />
              <p className="text-[11px] text-muted-foreground mt-1">Cannot be a future date.</p>
            </div>

            <Button onClick={submit} disabled={submitting || loadingPaid || outstanding <= 0} className="w-full">
              {submitting
                ? 'Posting…'
                : D(payAmount || 0).gte(D(outstanding).minus(0.001)) && D(payAmount || 0).gt(0)
                  ? 'Confirm & clear A/P'
                  : 'Confirm partial payment'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
