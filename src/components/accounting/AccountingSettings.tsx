import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { OpeningBalancesWizard } from './OpeningBalancesWizard';
import { COMMON_CURRENCIES } from '@/lib/accounting/currency';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info, KeyRound, ShieldAlert, Trash2 } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

type EntryDateBasis = 'check_in' | 'check_out' | 'booking_created';

interface Settings {
  accounting_method: 'cash' | 'accrual';
  base_currency: string;
  go_live_date: string;
  entry_date_basis: EntryDateBasis;
}

export function AccountingSettings({ hostId }: { hostId: string }) {
  const { toast } = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // PIN state
  const [pinSet, setPinSet] = useState<boolean>(false);
  const [pinSetAt, setPinSetAt] = useState<string | null>(null);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [savingPin, setSavingPin] = useState(false);
  // Reset state
  const [resetPin, setResetPin] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('acct_settings')
        .select('accounting_method, base_currency, go_live_date, entry_date_basis, account_pin_hash, account_pin_set_at')
        .eq('host_id', hostId)
        .maybeSingle();
      // Hard policy: cash basis + revenue recognised at check-out.
      setS({
        accounting_method: 'cash',
        base_currency: (data as any)?.base_currency ?? 'USD',
        go_live_date: (data as any)?.go_live_date ?? new Date().toISOString().slice(0, 10),
        entry_date_basis: 'check_out',
      });
      setPinSet(Boolean((data as any)?.account_pin_hash));
      setPinSetAt((data as any)?.account_pin_set_at ?? null);
      setLoading(false);
    })();
  }, [hostId]);

  const save = async () => {
    if (!s) return;
    setSaving(true);
    const { error } = await supabase
      .from('acct_settings')
      .upsert(
        { host_id: hostId, ...s, accounting_method: 'cash', entry_date_basis: 'check_out' },
        { onConflict: 'host_id' }
      );
    setSaving(false);
    if (error) {
      toast({ title: 'Failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Settings saved' });
  };

  const savePin = async () => {
    if (!/^\d{4,12}$/.test(newPin)) {
      toast({ title: 'PIN must be 4–12 digits', variant: 'destructive' }); return;
    }
    if (newPin !== confirmPin) {
      toast({ title: 'PINs do not match', variant: 'destructive' }); return;
    }
    if (pinSet && !currentPin) {
      toast({ title: 'Enter your current PIN to change it', variant: 'destructive' }); return;
    }
    setSavingPin(true);
    const { error } = await (supabase as any).rpc('acct_set_account_pin', {
      p_new_pin: newPin,
      p_current_pin: pinSet ? currentPin : null,
    });
    setSavingPin(false);
    if (error) {
      toast({ title: 'Could not save PIN', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: pinSet ? 'PIN updated' : 'PIN set — keep it safe' });
    setPinSet(true); setPinSetAt(new Date().toISOString());
    setNewPin(''); setConfirmPin(''); setCurrentPin('');
  };

  const resetBooks = async () => {
    if (!pinSet) {
      toast({ title: 'Set your account PIN first', variant: 'destructive' }); return;
    }
    if (!/^\d{4,12}$/.test(resetPin)) {
      toast({ title: 'Enter your account PIN', variant: 'destructive' }); return;
    }
    if (resetConfirm !== 'RESET') {
      toast({ title: 'Type RESET to confirm', variant: 'destructive' }); return;
    }
    setResetting(true);
    const { data, error } = await (supabase as any).rpc('acct_reset_books', {
      p_pin: resetPin,
      p_confirm: resetConfirm,
    });
    setResetting(false);
    if (error) {
      toast({ title: 'Reset failed', description: error.message, variant: 'destructive' });
      return;
    }
    const counts = (data?.deleted ?? {}) as Record<string, number>;
    const total = Object.values(counts).reduce((a, b) => a + Number(b || 0), 0);
    toast({ title: 'Books reset', description: `${total} record(s) deleted across ${Object.keys(counts).length} tables.` });
    setResetPin(''); setResetConfirm('');
  };

  if (loading) return <Skeleton className="h-64" />;
  if (!s) return null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">General</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 max-w-md">
          <div>
            <Label>Accounting method</Label>
            <Select value="cash" disabled>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash basis (recognize when money moves)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              This system records on <strong>cash basis only</strong>. Income hits revenue when received;
              expenses hit P&amp;L when paid. Unreceived income posts to <strong>1200 — Accounts receivable</strong>;
              unpaid expenses post to <strong>2010 — Accounts payable</strong>.
            </p>
          </div>

          <div>
            <Label>Base currency</Label>
            <Select value={s.base_currency} onValueChange={(v) => setS({ ...s, base_currency: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                {COMMON_CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Your books are kept in this currency. When a booking is paid in another currency
              you'll be asked for the exchange rate at the time of receipt.
            </p>
          </div>

          <div>
            <Label>Go-live date</Label>
            <Input
              type="date"
              value={s.go_live_date}
              onChange={(e) => setS({ ...s, go_live_date: e.target.value })}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Date you started using this accounting system. Used for opening balances.
            </p>
          </div>

          <div>
            <Label>Entry date basis</Label>
            <Select value="check_out" disabled>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="check_out">Check-out date (guest leaves)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              <strong>Policy:</strong> rental income is recognised in full on the
              <strong> check-out date</strong> of every stay. Pending and confirmed bookings
              are not on your books until the guest checks out. Expenses post on the date
              they occur.
            </p>
          </div>

          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button>
        </CardContent>
      </Card>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-sm">
          Onboarding mid-year? Use the wizard below to enter starting balances per account
          (cash on hand, bank balances, loans, equity, etc.). Any imbalance is auto-posted to
          <strong> 3040 — Opening balance equity</strong>.
        </AlertDescription>
      </Alert>

      <OpeningBalancesWizard hostId={hostId} baseCurrency={s.base_currency} />

      {/* Account PIN */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> Account PIN
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 max-w-md">
          <p className="text-xs text-muted-foreground">
            {pinSet
              ? `A PIN is set${pinSetAt ? ` (last changed ${new Date(pinSetAt).toLocaleDateString()})` : ''}. You'll need it to reset your books.`
              : 'Set a 4–12 digit PIN. It is required for destructive actions like resetting all accounting records. Keep it safe — admins cannot recover it.'}
          </p>
          {pinSet && (
            <div>
              <Label>Current PIN</Label>
              <Input
                type="password" inputMode="numeric" autoComplete="off" maxLength={12}
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{pinSet ? 'New PIN' : 'PIN'}</Label>
              <Input
                type="password" inputMode="numeric" autoComplete="new-password" maxLength={12}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <div>
              <Label>Confirm</Label>
              <Input
                type="password" inputMode="numeric" autoComplete="new-password" maxLength={12}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              />
            </div>
          </div>
          <Button onClick={savePin} disabled={savingPin}>
            {savingPin ? 'Saving…' : pinSet ? 'Update PIN' : 'Set PIN'}
          </Button>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2 text-destructive">
            <ShieldAlert className="w-4 h-4" /> Reset all accounting records
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 max-w-md">
          <Alert variant="destructive">
            <AlertDescription className="text-xs">
              This permanently deletes <strong>all journal entries, expenses, fixed assets,
              external bookings, bank charges, opening balances, and reconciliations</strong> for
              your account. Your chart of accounts, expense categories, settings, and PIN are
              preserved. This cannot be undone.
            </AlertDescription>
          </Alert>
          {!pinSet ? (
            <p className="text-xs text-muted-foreground">Set your account PIN above to enable reset.</p>
          ) : (
            <>
              <div>
                <Label>Account PIN</Label>
                <Input
                  type="password" inputMode="numeric" autoComplete="off" maxLength={12}
                  value={resetPin}
                  onChange={(e) => setResetPin(e.target.value.replace(/\D/g, ''))}
                />
              </div>
              <div>
                <Label>Type <span className="font-mono">RESET</span> to confirm</Label>
                <Input
                  value={resetConfirm}
                  onChange={(e) => setResetConfirm(e.target.value.toUpperCase())}
                  placeholder="RESET"
                />
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    disabled={
                      resetting ||
                      !/^\d{4,12}$/.test(resetPin) ||
                      resetConfirm !== 'RESET'
                    }
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    {resetting ? 'Resetting…' : 'Reset all records'}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-destructive">
                      Permanently delete all accounting data?
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-2 text-sm">
                        <p>This will <strong>permanently delete</strong> the following from your books — there is no undo:</p>
                        <ul className="list-disc pl-5 text-xs space-y-1">
                          <li>All <strong>journal entries</strong> and their lines (every double-entry posting)</li>
                          <li>All <strong>expenses</strong> and attached receipts</li>
                          <li>All <strong>fixed assets</strong> and depreciation history</li>
                          <li>All imported <strong>external bookings</strong> (Hostly, Airbnb, Booking.com, Vrbo)</li>
                          <li>All <strong>bank charges</strong> (drafts and posted)</li>
                          <li>All <strong>opening balances</strong></li>
                          <li>All <strong>reconciliations</strong> and their audit trail</li>
                        </ul>
                        <p className="text-xs">
                          Your chart of accounts, expense categories, settings, and PIN
                          will be <strong>kept</strong>. Reports will read $0 immediately after.
                        </p>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={resetBooks}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Yes, delete everything
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
