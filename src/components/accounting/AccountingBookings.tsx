import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Trash2, Wallet, BadgeCheck, Download } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { fmtMoney, D } from '@/lib/accounting/money';
import { createExternalBookingWithJournal } from '@/lib/accounting/posting';
import { format, differenceInDays } from 'date-fns';
import { useBaseCurrency } from '@/hooks/useBaseCurrency';
import { COMMON_CURRENCIES } from '@/lib/accounting/currency';
import { Badge } from '@/components/ui/badge';
import { AccountPicker, type PickerAccount } from './AccountPicker';
import { Separator } from '@/components/ui/separator';
import { ReceivePaymentDialog } from './ReceivePaymentDialog';
import { HostivaNeedsFxPanel } from './HostlyNeedsFxPanel';
import { PinConfirmDialog } from './PinConfirmDialog';

interface Platform { id: string; name: string; commission_percent: number; }
interface Property { id: string; title: string; }
interface ExtBooking {
  id: string; guest_name: string | null; check_in_date: string; check_out_date: string;
  num_nights: number; gross_revenue: number; commission_amount: number; net_payout: number;
  payment_method: string | null; status: string; platform_id: string | null;
  payment_status: string | null; payment_reference: string | null;
  txn_currency: string | null; fx_rate: number | null; base_amount: number | null;
  cleaning_fee: number | null;
}

const TODAY = () => format(new Date(), 'yyyy-MM-dd');

export function AccountingBookings({ hostId }: { hostId: string }) {
  const { toast } = useToast();
  const baseCurrency = useBaseCurrency(hostId);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [accounts, setAccounts] = useState<PickerAccount[]>([]);
  const [bookings, setBookings] = useState<ExtBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [receivingBooking, setReceivingBooking] = useState<ExtBooking | null>(null);
  const [importing, setImporting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const importHostiva = async () => {
    setImporting(true);
    try {
      const { data, error } = await (supabase as any).rpc('acct_import_hostly_bookings', { _host_id: hostId });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const imported = row?.imported ?? 0;
      const needsFx = row?.needs_fx ?? 0;
      const skipped = row?.skipped ?? 0;
      toast({
        title: 'Hostiva bookings imported',
        description: `Posted ${imported} • Needs FX ${needsFx} • Already imported ${skipped}`,
      });
      load();
    } catch (e: any) {
      toast({ title: 'Import failed', description: e.message, variant: 'destructive' });
    } finally {
      setImporting(false);
    }
  };

  // Form state
  const [platformId, setPlatformId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [checkIn, setCheckIn] = useState(TODAY());
  const [checkOut, setCheckOut] = useState(TODAY());
  const [gross, setGross] = useState('');
  const [cleaning, setCleaning] = useState('');
  const [commission, setCommission] = useState('');
  const [taxes, setTaxes] = useState('');
  const [notes, setNotes] = useState('');
  const [txnCurrency, setTxnCurrency] = useState(baseCurrency);
  const [fxRate, setFxRate] = useState('1');
  const [paymentReceived, setPaymentReceived] = useState(true);
  const [paymentReceivedDate, setPaymentReceivedDate] = useState(TODAY());

  // Account pickers (driven from CoA)
  const [depositAccountId, setDepositAccountId] = useState('');
  const [revenueAccountId, setRevenueAccountId] = useState('');
  const [commissionAccountId, setCommissionAccountId] = useState('');

  useEffect(() => { setTxnCurrency(baseCurrency); }, [baseCurrency]);
  useEffect(() => { if (txnCurrency === baseCurrency) setFxRate('1'); }, [txnCurrency, baseCurrency]);

  // When platform changes, refresh CoA mappings for revenue/commission and a sensible default deposit account.
  useEffect(() => {
    const platform = platforms.find((p) => p.id === platformId);
    if (!platform || accounts.length === 0) return;
    const codeFor = (code: string) => accounts.find((a) => a.code === code)?.id ?? '';
    const revMap: Record<string, string> = {
      'Hostiva': '4010', 'Airbnb': '4020', 'Booking.com': '4030',
      'Vrbo': '4040', 'Direct': '4050', 'Walk-in': '4060',
    };
    const commMap: Record<string, string> = {
      'Hostiva': '5010', 'Airbnb': '5020', 'Booking.com': '5030', 'Vrbo': '5040',
    };
    setRevenueAccountId(codeFor(revMap[platform.name] ?? '4070'));
    setCommissionAccountId(codeFor(commMap[platform.name] ?? '5050'));
    // Default deposit account = Mobile money (1040); host can change if needed.
    // Falls back to any cash/bank account if 1040 is missing.
    const mobileMoney = accounts.find((a) => a.code === '1040');
    const fallback = accounts.find((a) => a.code.startsWith('10') || a.code.startsWith('11'));
    setDepositAccountId(mobileMoney?.id ?? fallback?.id ?? '');
  }, [platformId, platforms, accounts]);

  const load = async () => {
    setLoading(true);
    const [plat, prop, accs, books] = await Promise.all([
      supabase.from('acct_platforms').select('id, name, commission_percent').eq('host_id', hostId).order('name'),
      supabase.from('properties').select('id, title').eq('host_id', hostId),
      supabase.from('acct_chart_of_accounts').select('id, code, name, type').eq('host_id', hostId).eq('is_active', true).order('code'),
      supabase.from('acct_external_bookings').select('*').eq('host_id', hostId).order('check_in_date', { ascending: false }).limit(100),
    ]);
    setPlatforms((plat.data ?? []) as any);
    setProperties((prop.data ?? []) as any);
    setAccounts((accs.data ?? []) as any);
    setBookings((books.data ?? []) as any);
    setLoading(false);
  };

  // Auto-run the Hostiva import once per host on first load.
  // Triggers only when the host has zero auto-imported Hostiva bookings yet.
  useEffect(() => {
    if (!hostId) return;
    const flagKey = `acct_hostly_autoimport_done_${hostId}`;
    if (typeof window !== 'undefined' && window.localStorage.getItem(flagKey)) {
      load();
      return;
    }
    (async () => {
      try {
        const { count } = await supabase
          .from('acct_external_bookings')
          .select('id', { count: 'exact', head: true })
          .eq('host_id', hostId)
          .like('notes', 'AUTO:HOSTLY:%');
        if ((count ?? 0) === 0) {
          const { data, error } = await (supabase as any).rpc('acct_import_hostly_bookings', { _host_id: hostId });
          if (!error) {
            const row = Array.isArray(data) ? data[0] : data;
            const imported = row?.imported ?? 0;
            const needsFx = row?.needs_fx ?? 0;
            if (imported > 0 || needsFx > 0) {
              toast({
                title: 'Hostiva bookings auto-imported',
                description: `Posted ${imported} • Needs FX ${needsFx}. Cancelled bookings with full refund were skipped.`,
              });
            }
          }
        }
        if (typeof window !== 'undefined') window.localStorage.setItem(flagKey, '1');
      } catch {
        // Silent fail — host can still click the manual button.
      } finally {
        load();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId]);

  const reset = () => {
    setPlatformId(''); setPropertyId(''); setGuestName('');
    setCheckIn(TODAY()); setCheckOut(TODAY());
    setGross(''); setCleaning(''); setCommission(''); setTaxes(''); setNotes('');
    setTxnCurrency(baseCurrency); setFxRate('1');
    setDepositAccountId(''); setRevenueAccountId(''); setCommissionAccountId('');
    setPaymentReceived(true); setPaymentReceivedDate(TODAY());
  };

  const arAccount = useMemo(() => accounts.find((a) => a.code === '1200'), [accounts]);

  const netPreview = useMemo(() => {
    // Net payout = Gross revenue − commission − commission tax
    const g = D(gross || 0), co = D(commission || 0), t = D(taxes || 0);
    return g.minus(co).minus(t);
  }, [gross, commission, taxes]);

  // Helper: derive a human-readable payment_method from the picked deposit account
  const depositAccountName = useMemo(
    () => accounts.find((a) => a.id === depositAccountId)?.name ?? null,
    [accounts, depositAccountId],
  );

  const submit = async () => {
    try {
      const platform = platforms.find((p) => p.id === platformId);
      if (!platform) { toast({ title: 'Pick a platform', variant: 'destructive' }); return; }
      if (!propertyId) { toast({ title: 'Pick a property', description: 'Property is required for booking entries.', variant: 'destructive' }); return; }
      if (!depositAccountId) { toast({ title: 'Pick a deposit account', description: 'Where does the money land?', variant: 'destructive' }); return; }
      if (!revenueAccountId) { toast({ title: 'Pick a revenue account', variant: 'destructive' }); return; }
      const grossN = D(gross || 0);
      if (grossN.lte(0)) { toast({ title: 'Gross revenue must be > 0', variant: 'destructive' }); return; }
      const fxN = D(fxRate || 1);
      if (fxN.lte(0)) { toast({ title: 'Exchange rate must be > 0', variant: 'destructive' }); return; }
      if (paymentReceived && paymentReceivedDate > TODAY()) {
        toast({ title: 'Date received cannot be in the future', variant: 'destructive' });
        return;
      }
      const nights = Math.max(1, differenceInDays(new Date(checkOut), new Date(checkIn)));

      await createExternalBookingWithJournal({
        host_id: hostId,
        platform_id: platformId,
        platform_name: platform.name,
        property_id: propertyId || null,
        guest_name: guestName || undefined,
        check_in_date: checkIn,
        check_out_date: checkOut,
        num_nights: nights,
        gross_revenue: grossN.toNumber(),
        cleaning_fee: D(cleaning || 0).toNumber(),
        commission_amount: D(commission || 0).toNumber(),
        taxes_collected: D(taxes || 0).toNumber(),
        net_payout: netPreview.toNumber(),
        payment_method: paymentReceived ? (depositAccountName ?? undefined) : undefined,
        payment_received_date: paymentReceived ? paymentReceivedDate : undefined,
        payment_received: paymentReceived,
        notes: notes || undefined,
        txn_currency: txnCurrency,
        fx_rate: fxN.toNumber(),
        deposit_account_id: depositAccountId,
        revenue_account_id: revenueAccountId,
        commission_account_id: commissionAccountId || null,
      });
      // Mark the new row's payment_status so the UI can offer "Receive payment" later.
      // (Newest row by created_at for this host.)
      const { data: newest } = await supabase
        .from('acct_external_bookings')
        .select('id')
        .eq('host_id', hostId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (newest?.id) {
        await supabase
          .from('acct_external_bookings')
          .update({ payment_status: paymentReceived ? 'received' : 'receivable' })
          .eq('id', newest.id);
      }
      toast({
        title: 'Booking recorded',
        description: txnCurrency !== baseCurrency
          ? `Posted ${fmtMoney(netPreview.times(fxN).toNumber(), baseCurrency)} (${txnCurrency} @ ${fxN.toFixed(4)}).`
          : 'Journal entry posted.',
      });
      reset(); setOpen(false); load();
    } catch (e: any) {
      toast({ title: 'Failed', description: e.message, variant: 'destructive' });
    }
  };

  const del = async (id: string) => {
    setPendingDeleteId(id);
  };

  const performDelete = async () => {
    const id = pendingDeleteId;
    if (!id) return;
    const { data } = await supabase.from('acct_external_bookings').select('journal_entry_id, clearing_entry_id').eq('id', id).single();
    if (data?.journal_entry_id) await supabase.from('acct_journal_entries').delete().eq('id', data.journal_entry_id);
    if (data?.clearing_entry_id) await supabase.from('acct_journal_entries').delete().eq('id', data.clearing_entry_id);
    await supabase.from('acct_external_bookings').delete().eq('id', id);
    setPendingDeleteId(null);
    toast({ title: 'Booking deleted' });
    load();
  };

  const renderStatusBadge = (s: string | null) => {
    if (s === 'cleared') return <Badge className="bg-primary/10 text-primary hover:bg-primary/10 border-primary/20">Received</Badge>;
    if (s === 'receivable') return <Badge variant="outline" className="border-destructive/40 text-destructive">A/R — Unpaid</Badge>;
    return <Badge variant="secondary">Received</Badge>;
  };

  return (
    <div className="space-y-4">
      <HostivaNeedsFxPanel hostId={hostId} baseCurrency={baseCurrency} onPosted={load} />
      <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Bookings (off-platform / walk-in / direct)</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Hostiva bookings auto-post on confirmation. Use this to record direct, walk-in, and other channels.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={importHostiva} disabled={importing}>
            <Download className="w-4 h-4 mr-1" />
            {importing ? 'Importing…' : 'Import Hostiva bookings'}
          </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 mr-1" />Add booking</Button></DialogTrigger>
          <DialogContent className="max-w-5xl w-[95vw] max-h-[95vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Record a booking</DialogTitle></DialogHeader>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Column 1 — Source */}
              <section className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source</h4>
                <div>
                  <Label>Platform *</Label>
                  <Select value={platformId} onValueChange={setPlatformId}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{platforms.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Property *</Label>
                  <Select value={propertyId} onValueChange={setPropertyId}>
                    <SelectTrigger><SelectValue placeholder="Select property" /></SelectTrigger>
                    <SelectContent>{properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Guest name (optional)</Label>
                  <Input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Walk-in / anonymous" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Check-in</Label><Input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} /></div>
                  <div><Label>Check-out</Label><Input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} /></div>
                </div>
                <div>
                  <Label>Notes</Label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
                </div>
              </section>

              {/* Column 2 — Amounts */}
              <section className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Amounts</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Gross revenue *</Label><Input type="number" step="0.01" value={gross} onChange={(e) => setGross(e.target.value)} /></div>
                  <div><Label>Cleaning fee</Label><Input type="number" step="0.01" value={cleaning} onChange={(e) => setCleaning(e.target.value)} placeholder="0.00" /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Commission</Label><Input type="number" step="0.01" value={commission} onChange={(e) => setCommission(e.target.value)} /></div>
                  <div><Label>Commission tax</Label><Input type="number" step="0.01" value={taxes} onChange={(e) => setTaxes(e.target.value)} placeholder="0.00" /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Currency</Label>
                    <Select value={txnCurrency} onValueChange={setTxnCurrency}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent className="max-h-72">
                        {COMMON_CURRENCIES.map((c) => (
                          <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>FX rate</Label>
                    <Input type="number" step="0.0001" value={fxRate} onChange={(e) => setFxRate(e.target.value)} disabled={txnCurrency === baseCurrency} />
                    <p className="text-[10px] text-muted-foreground mt-1">1 {txnCurrency} = ? {baseCurrency}</p>
                  </div>
                </div>
                <div className="rounded-md bg-muted/40 border p-3 text-sm flex justify-between">
                  <span className="text-muted-foreground">Net payout</span>
                  <strong className="text-right">
                    {fmtMoney(netPreview.toNumber(), txnCurrency)}
                    {txnCurrency !== baseCurrency && D(fxRate || 0).gt(0) && (
                      <div className="text-xs text-muted-foreground font-normal">
                        = {fmtMoney(netPreview.times(D(fxRate)).toNumber(), baseCurrency)}
                      </div>
                    )}
                  </strong>
                </div>
              </section>

              {/* Column 3 — Payment & Accounts */}
              <section className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment & accounts</h4>
                <div className="flex items-start justify-between gap-3 rounded-md border p-3 bg-muted/30">
                  <div className="space-y-0.5">
                    <Label htmlFor="received" className="cursor-pointer text-sm">Payment received?</Label>
                    <p className="text-[10px] text-muted-foreground">
                      {paymentReceived ? 'Debits deposit account.' : 'Debits A/R (1200).'}
                    </p>
                  </div>
                  <Switch id="received" checked={paymentReceived} onCheckedChange={setPaymentReceived} />
                </div>
                {paymentReceived && (
                  <div>
                    <Label>Date received</Label>
                    <Input
                      type="date"
                      value={paymentReceivedDate}
                      max={TODAY()}
                      onChange={(e) => setPaymentReceivedDate(e.target.value)}
                    />
                  </div>
                )}
                <div>
                  <Label>{paymentReceived ? 'Deposit account *' : 'Receivable account'}</Label>
                  <AccountPicker
                    accounts={accounts}
                    value={paymentReceived ? depositAccountId : (arAccount?.id ?? '')}
                    onChange={setDepositAccountId}
                    {...(paymentReceived ? { codePrefixes: ['10', '11'] } : { codes: ['1200'] })}
                    placeholder="Pick deposit account"
                    disabled={!paymentReceived}
                  />
                </div>
                <div>
                  <Label>Revenue account</Label>
                  <AccountPicker
                    accounts={accounts}
                    value={revenueAccountId}
                    onChange={setRevenueAccountId}
                    types={['revenue']}
                    disabled
                  />
                </div>
                <div>
                  <Label>Commission expense</Label>
                  <AccountPicker
                    accounts={accounts}
                    value={commissionAccountId}
                    onChange={setCommissionAccountId}
                    types={['expense']}
                    codePrefixes={['50']}
                    disabled
                  />
                </div>
              </section>
            </div>
            <Button onClick={submit} className="w-full mt-6">Record booking & post journal</Button>
          </DialogContent>
        </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : bookings.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted-foreground">
            <Wallet className="w-8 h-8 mx-auto mb-2 opacity-50" />
            No off-platform bookings yet. Click <strong>Add booking</strong> to record a walk-in, direct, or external reservation.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dates</TableHead>
                  <TableHead>Guest</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Net payout</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookings.map((b) => {
                  const plat = platforms.find((p) => p.id === b.platform_id);
                  const isReceivable = b.payment_status === 'receivable';
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="text-xs">{b.check_in_date} → {b.check_out_date}</TableCell>
                      <TableCell>{b.guest_name ?? '—'}</TableCell>
                      <TableCell><Badge variant="secondary">{plat?.name ?? 'Unknown'}</Badge></TableCell>
                      <TableCell>{renderStatusBadge(b.payment_status)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {b.payment_reference ? (
                          <span className="text-foreground">{b.payment_reference}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      {(() => {
                        const fx = D(b.fx_rate ?? 1);
                        const txnCcy = (b.txn_currency || baseCurrency).toUpperCase();
                        const isFx = txnCcy !== baseCurrency.toUpperCase() && fx.gt(0);
                        const grossBase = D(b.gross_revenue ?? 0).plus(D(b.cleaning_fee ?? 0)).times(fx).toNumber();
                        const netBase = b.base_amount != null ? Number(b.base_amount) : D(b.net_payout ?? 0).times(fx).toNumber();
                        return (
                          <>
                            <TableCell className="text-right">
                              {fmtMoney(grossBase, baseCurrency)}
                              {isFx && (
                                <div className="text-xs text-muted-foreground font-normal">
                                  {fmtMoney(D(b.gross_revenue ?? 0).plus(D(b.cleaning_fee ?? 0)).toNumber(), txnCcy)} @ {fx.toFixed(2)}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {fmtMoney(netBase, baseCurrency)}
                              {isFx && (
                                <div className="text-xs text-muted-foreground font-normal">
                                  {fmtMoney(b.net_payout, txnCcy)}
                                </div>
                              )}
                            </TableCell>
                          </>
                        );
                      })()}
                      <TableCell>
                        <div className="flex gap-1 justify-end">
                          {isReceivable && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setReceivingBooking(b)}
                              className="h-8 text-xs"
                            >
                              <BadgeCheck className="w-3.5 h-3.5 mr-1" />Receive payment
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" onClick={() => del(b.id)}><Trash2 className="w-4 h-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <ReceivePaymentDialog
        open={!!receivingBooking}
        onOpenChange={(v) => !v && setReceivingBooking(null)}
        hostId={hostId}
        baseCurrency={baseCurrency}
        booking={receivingBooking}
        accounts={accounts}
        onDone={load}
      />
      <PinConfirmDialog
        open={!!pendingDeleteId}
        onOpenChange={(v) => { if (!v) setPendingDeleteId(null); }}
        title="Delete this booking?"
        description="Removes the booking and any related journal entries. Enter your accounting PIN to confirm."
        confirmLabel="Delete booking"
        onConfirmed={performDelete}
      />
    </Card>
    </div>
  );
}
