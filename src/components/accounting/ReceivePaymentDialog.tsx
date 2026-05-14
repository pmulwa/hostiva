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

interface Booking {
  id: string;
  net_payout: number;
  payment_status: string | null;
  check_out_date: string;
  guest_name: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  hostId: string;
  baseCurrency: string;
  booking: Booking | null;
  accounts: PickerAccount[];
  onDone: () => void;
}

const TODAY = () => format(new Date(), 'yyyy-MM-dd');

export function ReceivePaymentDialog({
  open, onOpenChange, hostId, baseCurrency, booking, accounts, onDone,
}: Props) {
  const { toast } = useToast();
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(TODAY());
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // On open: default to Mobile money (1040), fallback to first cash/bank/payout account
  useEffect(() => {
    if (!open) return;
    setDate(TODAY());
    setReference('');
    const mm = accounts.find((a) => a.code === '1040');
    const fallback = accounts.find((a) => a.code.startsWith('10') || a.code.startsWith('11'));
    setAccountId(mm?.id ?? fallback?.id ?? '');
  }, [open, accounts]);

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
    if (!booking) return;
    if (!accountId) { toast({ title: 'Pick the account where money landed', variant: 'destructive' }); return; }
    if (date > TODAY()) { toast({ title: 'Date cannot be in the future', description: 'Receive money for today or an earlier date.', variant: 'destructive' }); return; }
    setSubmitting(true);
    try {
      const arId = await getAccountByCode(hostId, '1200');
      if (!arId) throw new Error('Accounts receivable account (1200) missing.');
      const amt = D(booking.net_payout).toNumber();
      const refSuffix = reference ? ` — ref ${reference}` : '';
      const entryId = await postJournalEntry({
        host_id: hostId,
        entry_date: date,
        description: `Receive payment — booking ${booking.id.slice(0, 8).toUpperCase()}${refSuffix}`,
        reference: `AR-CLR-${booking.id.slice(0, 8).toUpperCase()}`,
        source_type: 'manual',
        source_id: booking.id,
        lines: [
          { account_id: accountId, debit: amt, memo: `Cash/bank received${refSuffix}` },
          { account_id: arId, credit: amt, memo: 'Clear A/R' },
        ],
      });
      await supabase
        .from('acct_external_bookings')
        .update({
          payment_status: 'cleared',
          clearing_entry_id: entryId,
          payment_received_date: date,
          payment_method: selectedAccountName,
          payment_reference: reference || null,
        } as any)
        .eq('id', booking.id);
      toast({ title: 'Payment received', description: `${fmtMoney(amt, baseCurrency)} cleared from A/R.` });
      onDone();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'Failed', description: e.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Receive payment</DialogTitle>
        </DialogHeader>
        {booking && (
          <div className="space-y-4">
            <div className="rounded-md bg-muted/40 border p-3 text-sm flex justify-between">
              <span className="text-muted-foreground">Amount due</span>
              <strong>{fmtMoney(booking.net_payout, baseCurrency)}</strong>
            </div>

            <div>
              <Label>Deposit account (debited) *</Label>
              <AccountPicker
                accounts={accounts}
                value={accountId}
                onChange={setAccountId}
                codePrefixes={['10', '11']}
                placeholder="Search cash, bank, mobile money, payouts…"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Defaults to Mobile money — search and pick any cash, bank, or pending-payout account.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between">
                  <Label>Payment reference / code</Label>
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
                <Label>Date received *</Label>
                <Input
                  type="date"
                  value={date}
                  max={TODAY()}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground -mt-2">Date cannot be in the future.</p>

            <Button onClick={submit} disabled={submitting} className="w-full">
              {submitting ? 'Posting…' : 'Confirm & post clearing entry'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
