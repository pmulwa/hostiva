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
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Paperclip, Receipt as ReceiptIcon, Wallet, Share2, X, Save, Bookmark } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { fmtMoney, D } from '@/lib/accounting/money';
import { createExpenseWithJournal } from '@/lib/accounting/posting';
import { format } from 'date-fns';
import { useBaseCurrency } from '@/hooks/useBaseCurrency';
import { COMMON_CURRENCIES } from '@/lib/accounting/currency';
import { AccountPicker, type PickerAccount } from './AccountPicker';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { PayBillDialog } from './PayBillDialog';
import { PinConfirmDialog } from './PinConfirmDialog';

interface Category { id: string; name: string; default_account_id: string | null; }
interface Property { id: string; title: string; }
interface Expense {
  id: string; expense_date: string; description: string; vendor: string | null;
  amount: number; base_amount: number | null; payment_method: string | null; receipt_url: string | null;
  category_id: string | null; is_capitalized: boolean; payment_status: string | null; payment_reference: string | null;
  is_shared?: boolean | null; allocations?: any;
  txn_currency?: string | null; fx_rate?: number | null;
}

export function AccountingExpenses({ hostId }: { hostId: string }) {
  const { toast } = useToast();
  const baseCurrency = useBaseCurrency(hostId);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<PickerAccount[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [partialPaid, setPartialPaid] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [payBillFor, setPayBillFor] = useState<Expense | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Form
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [categoryId, setCategoryId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [vendor, setVendor] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [capitalize, setCapitalize] = useState(false);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [txnCurrency, setTxnCurrency] = useState(baseCurrency);
  const [fxRate, setFxRate] = useState('1');
  const [expenseAccountId, setExpenseAccountId] = useState('');
  const [paidFromAccountId, setPaidFromAccountId] = useState('');
  const [paid, setPaid] = useState(true);
  const [isShared, setIsShared] = useState(false);
  const [allocations, setAllocations] = useState<{ property_id: string; ratio: number }[]>([]);
  const [presets, setPresets] = useState<{ id: string; name: string; allocations: { property_id: string; ratio: number }[] }[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');

  useEffect(() => { setTxnCurrency(baseCurrency); }, [baseCurrency]);
  useEffect(() => { if (txnCurrency === baseCurrency) setFxRate('1'); }, [txnCurrency, baseCurrency]);

  // When capitalizing, force a fixed-asset account (default 1520).
  // When not capitalizing, the user picks the expense account directly from
  // the full chart of accounts via the searchable AccountPicker below.
  useEffect(() => {
    if (!capitalize) return;
    const current = accounts.find((a) => a.id === expenseAccountId);
    // Only flip to 1520 if the current selection isn't already an asset (15xx)
    if (!current || current.type !== 'asset' || !current.code.startsWith('15')) {
      const fa = accounts.find((a) => a.code === '1520')?.id ?? '';
      setExpenseAccountId(fa);
    }
  }, [capitalize, accounts]);

  // Auto-match category_id from the picked expense account (best-effort, optional).
  useEffect(() => {
    if (!expenseAccountId) return;
    const match = categories.find((c) => c.default_account_id === expenseAccountId);
    if (match) setCategoryId(match.id);
  }, [expenseAccountId, categories]);

  // Default paid-from to mobile money (1040), with sensible fallbacks
  useEffect(() => {
    if (accounts.length === 0) return;
    const mm = accounts.find((a) => a.code === '1040');
    const fallback = accounts.find((a) => a.code === '1020') ?? accounts.find((a) => a.code.startsWith('10'));
    setPaidFromAccountId(mm?.id ?? fallback?.id ?? '');
  }, [accounts]);

  const load = async () => {
    setLoading(true);
    const [cats, accs, props, exps, prs] = await Promise.all([
      supabase.from('acct_expense_categories').select('*').eq('host_id', hostId).order('name'),
      supabase.from('acct_chart_of_accounts').select('id, code, name, type').eq('host_id', hostId).eq('is_active', true).order('code'),
      supabase.from('properties').select('id, title').eq('host_id', hostId),
      supabase.from('acct_expenses').select('*').eq('host_id', hostId).order('expense_date', { ascending: false }).limit(100),
      (supabase as any).from('acct_sharing_presets').select('id, name, allocations').eq('host_id', hostId).order('name'),
    ]);
    setCategories((cats.data ?? []) as any);
    const accList = (accs.data ?? []) as any;
    setAccounts(accList);
    setProperties((props.data ?? []) as any);
    const expList = (exps.data ?? []) as Expense[];
    setExpenses(expList);
    setPresets((prs?.data ?? []) as any);

    // Compute partial-payment totals for unpaid expenses
    const unpaidIds = expList.filter((e) => e.payment_status === 'unpaid').map((e) => e.id);
    const apId = accList.find((a: any) => a.code === '2010')?.id;
    if (unpaidIds.length > 0 && apId) {
      const { data: entries } = await supabase
        .from('acct_journal_entries')
        .select('id, source_id')
        .eq('host_id', hostId)
        .eq('source_type', 'manual')
        .in('source_id', unpaidIds);
      const entryToExpense = new Map<string, string>();
      (entries ?? []).forEach((e: any) => entryToExpense.set(e.id, e.source_id));
      const entryIds = Array.from(entryToExpense.keys());
      if (entryIds.length > 0) {
        const { data: lines } = await supabase
          .from('acct_journal_lines')
          .select('debit, account_id, entry_id')
          .in('entry_id', entryIds)
          .eq('account_id', apId);
        const sums: Record<string, number> = {};
        (lines ?? []).forEach((l: any) => {
          const expId = entryToExpense.get(l.entry_id);
          if (!expId) return;
          sums[expId] = (sums[expId] ?? 0) + Number(l.debit ?? 0);
        });
        setPartialPaid(sums);
      } else {
        setPartialPaid({});
      }
    } else {
      setPartialPaid({});
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, [hostId]);

  const submit = async () => {
    try {
      if (!description) { toast({ title: 'Description required', variant: 'destructive' }); return; }
      if (!expenseAccountId) {
        toast({ title: capitalize ? 'Pick a fixed-asset account' : 'Pick an expense account', variant: 'destructive' });
        return;
      }
      if (!isShared && !propertyId) { toast({ title: 'Property is required', variant: 'destructive' }); return; }
      if (isShared) {
        if (allocations.length < 2) { toast({ title: 'Pick at least 2 properties to share across', variant: 'destructive' }); return; }
        const sum = allocations.reduce((s, a) => s + (Number(a.ratio) || 0), 0);
        if (Math.abs(sum - 1) > 0.001) { toast({ title: 'Sharing ratios must add up to 100%', description: `Currently ${(sum * 100).toFixed(1)}%`, variant: 'destructive' }); return; }
        if (allocations.some((a) => !a.property_id)) { toast({ title: 'Pick a property for each allocation row', variant: 'destructive' }); return; }
      }
      const amtN = D(amount || 0);
      if (amtN.lte(0)) { toast({ title: 'Amount must be > 0', variant: 'destructive' }); return; }
      if (!expenseAccountId) { toast({ title: 'Pick an expense account', variant: 'destructive' }); return; }
      if (paid && !paidFromAccountId) { toast({ title: 'Pick the account you paid from', variant: 'destructive' }); return; }

      let receiptUrl: string | undefined;
      if (receipt) {
        const path = `${hostId}/${Date.now()}-${receipt.name}`;
        const { error } = await supabase.storage.from('accounting-receipts').upload(path, receipt);
        if (error) throw error;
        receiptUrl = path;
      }

      const fxN = D(fxRate || 1);
      if (fxN.lte(0)) { toast({ title: 'Exchange rate must be > 0', variant: 'destructive' }); return; }
      await createExpenseWithJournal({
        host_id: hostId,
        property_id: isShared ? null : (propertyId || null),
        category_id: categoryId || null,
        expense_date: date,
        vendor: vendor || undefined,
        description,
        amount: amtN.toNumber(),
        receipt_url: receiptUrl,
        is_capitalized: capitalize,
        expense_account_id: expenseAccountId,
        cash_account_id: paidFromAccountId,
        paid,
        txn_currency: txnCurrency,
        fx_rate: fxN.toNumber(),
        is_shared: isShared,
        allocations: isShared ? allocations : [],
      });
      toast({ title: paid ? 'Expense recorded' : 'Expense recorded as A/P (unpaid)' });
      setOpen(false);
      setDate(format(new Date(), 'yyyy-MM-dd')); setCategoryId('');
      setPropertyId(''); setVendor(''); setDescription(''); setAmount(''); setReceipt(null); setCapitalize(false);
      setExpenseAccountId(''); setTxnCurrency(baseCurrency); setFxRate('1'); setPaid(true);
      setIsShared(false); setAllocations([]); setSelectedPresetId('');
      load();
    } catch (e: any) {
      toast({ title: 'Failed', description: e.message, variant: 'destructive' });
    }
  };

  const applyPreset = (id: string) => {
    setSelectedPresetId(id);
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    // Filter out properties that no longer exist for this host
    const valid = (p.allocations ?? []).filter((a) => properties.some((pr) => pr.id === a.property_id));
    setAllocations(valid.map((a) => ({ property_id: a.property_id, ratio: Number(a.ratio) || 0 })));
  };

  const savePreset = async () => {
    const name = newPresetName.trim();
    if (!name) { toast({ title: 'Give the preset a name', variant: 'destructive' }); return; }
    if (allocations.length < 2) { toast({ title: 'Add at least 2 properties first', variant: 'destructive' }); return; }
    const sum = allocations.reduce((s, a) => s + (Number(a.ratio) || 0), 0);
    if (Math.abs(sum - 1) > 0.001) { toast({ title: 'Ratios must total 100% before saving', variant: 'destructive' }); return; }
    if (allocations.some((a) => !a.property_id)) { toast({ title: 'Pick a property for every row', variant: 'destructive' }); return; }
    const { data, error } = await (supabase as any)
      .from('acct_sharing_presets')
      .upsert(
        { host_id: hostId, name, allocations: allocations as any },
        { onConflict: 'host_id,name' }
      )
      .select('id, name, allocations')
      .single();
    if (error) { toast({ title: 'Could not save preset', description: error.message, variant: 'destructive' }); return; }
    toast({ title: `Preset "${name}" saved` });
    const others = presets.filter((p) => p.id !== data.id && p.name !== data.name);
    setPresets([...others, data].sort((a, b) => a.name.localeCompare(b.name)));
    setSelectedPresetId(data.id);
    setNewPresetName('');
    setSavePresetOpen(false);
  };

  const deletePreset = async () => {
    if (!selectedPresetId) return;
    const p = presets.find((x) => x.id === selectedPresetId);
    if (!p) return;
    if (!confirm(`Delete preset "${p.name}"?`)) return;
    const { error } = await (supabase as any).from('acct_sharing_presets').delete().eq('id', selectedPresetId);
    if (error) { toast({ title: 'Delete failed', description: error.message, variant: 'destructive' }); return; }
    setPresets(presets.filter((x) => x.id !== selectedPresetId));
    setSelectedPresetId('');
    toast({ title: 'Preset deleted' });
  };
  const del = async (id: string) => {
    // PIN-gated to prevent accidental deletion. Trigger the dialog only.
    setPendingDeleteId(id);
  };

  const performDelete = async () => {
    const id = pendingDeleteId;
    if (!id) return;
    const { data } = await supabase.from('acct_expenses').select('journal_entry_id').eq('id', id).single();
    if (data?.journal_entry_id) await supabase.from('acct_journal_entries').delete().eq('id', data.journal_entry_id);
    await supabase.from('acct_expenses').delete().eq('id', id);
    setPendingDeleteId(null);
    toast({ title: 'Expense deleted' });
    load();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Expenses</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">All expenses post a balanced journal entry automatically.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 mr-1" />Add expense</Button></DialogTrigger>
          <DialogContent className="max-w-5xl w-[95vw] max-h-[95vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Record an expense</DialogTitle></DialogHeader>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Column 1 — Details */}
              <section className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Details</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
                  <div><Label>Amount *</Label><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                </div>
                <div>
                  <Label>Category * {capitalize ? '(asset account)' : '(expense account)'}</Label>
                  <AccountPicker
                    accounts={accounts}
                    value={expenseAccountId}
                    onChange={setExpenseAccountId}
                    types={capitalize ? ['asset'] : ['expense']}
                    codePrefixes={capitalize ? ['15'] : undefined}
                    placeholder={capitalize
                      ? 'Search by code or name (1500–1590)…'
                      : 'Search by code or name (5xxx, 6xxx, 7xxx)…'}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {capitalize
                      ? 'Pick any fixed-asset account (Land, Building, Furniture, Appliances, Electronics…).'
                      : 'Searchable across every expense account in your chart of accounts.'}
                  </p>
                </div>
                <div><Label>Vendor</Label><Input value={vendor} onChange={(e) => setVendor(e.target.value)} /></div>
                <div><Label>Description *</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></div>
                <div className="flex items-center gap-2 rounded-md border p-2">
                  <Switch checked={capitalize} onCheckedChange={setCapitalize} id="cap" />
                  <Label htmlFor="cap" className="text-xs cursor-pointer">Capitalize as fixed asset</Label>
                </div>
                <div>
                  <Label>Receipt (optional)</Label>
                  <Input type="file" accept="image/*,.pdf" onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} />
                </div>
              </section>

              {/* Column 2 — Property allocation */}
              <section className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Property allocation</h4>
                <div className="flex items-center justify-between gap-3 rounded-md border p-3 bg-muted/30">
                  <div className="space-y-0.5">
                    <Label htmlFor="shared" className="cursor-pointer flex items-center gap-1.5 text-sm">
                      <Share2 className="w-3.5 h-3.5" /> Shared across properties?
                    </Label>
                    <p className="text-[10px] text-muted-foreground">
                      Toggle on for pooled costs (supplies, internet…).
                    </p>
                  </div>
                  <Switch
                    id="shared"
                    checked={isShared}
                    onCheckedChange={(v) => {
                      setIsShared(v);
                      if (v && allocations.length === 0 && properties.length >= 2) {
                        const first2 = properties.slice(0, 2);
                        setAllocations(first2.map((p) => ({ property_id: p.id, ratio: 0.5 })));
                      }
                      if (v) setPropertyId('');
                    }}
                  />
                </div>

                {!isShared ? (
                  <div>
                    <Label>Property *</Label>
                    <Select value={propertyId} onValueChange={setPropertyId}>
                      <SelectTrigger><SelectValue placeholder="Select a property" /></SelectTrigger>
                      <SelectContent>{properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center gap-2 pb-2 border-b">
                      <Bookmark className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <Select value={selectedPresetId || 'none'} onValueChange={(v) => v !== 'none' && applyPreset(v)}>
                        <SelectTrigger className="h-8 text-xs flex-1">
                          <SelectValue placeholder={presets.length ? 'Load preset…' : 'No presets yet'} />
                        </SelectTrigger>
                        <SelectContent>
                          {presets.length === 0 ? (
                            <div className="px-2 py-1.5 text-xs text-muted-foreground">Save a split to reuse it.</div>
                          ) : (
                            presets.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)
                          )}
                        </SelectContent>
                      </Select>
                      {selectedPresetId && (
                        <Button type="button" variant="ghost" size="sm" className="h-8 text-xs text-destructive" onClick={deletePreset}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button
                        type="button" variant="outline" size="sm" className="h-8 text-xs"
                        onClick={() => setSavePresetOpen(true)}
                        disabled={allocations.length < 2}
                      >
                        <Save className="w-3.5 h-3.5 mr-1" /> Save
                      </Button>
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Sharing ratios *</Label>
                      <div className="flex gap-1">
                        <Button
                          type="button" variant="ghost" size="sm" className="h-7 text-xs"
                          onClick={() => {
                            if (allocations.length === 0) return;
                            const r = +(1 / allocations.length).toFixed(4);
                            setAllocations(allocations.map((a) => ({ ...a, ratio: r })));
                          }}
                        >
                          Even
                        </Button>
                        <Button
                          type="button" variant="outline" size="sm" className="h-7 text-xs"
                          onClick={() => setAllocations([...allocations, { property_id: '', ratio: 0 }])}
                        >
                          <Plus className="w-3 h-3 mr-1" /> Add
                        </Button>
                      </div>
                    </div>

                    {allocations.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">Click <strong>Add</strong> to start splitting.</p>
                    )}

                    {allocations.map((a, i) => {
                      const used = new Set(allocations.map((x, j) => (j === i ? '' : x.property_id)));
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <Select
                            value={a.property_id}
                            onValueChange={(v) => {
                              const next = [...allocations]; next[i] = { ...next[i], property_id: v }; setAllocations(next);
                            }}
                          >
                            <SelectTrigger className="flex-1"><SelectValue placeholder="Pick property" /></SelectTrigger>
                            <SelectContent>
                              {properties.filter((p) => !used.has(p.id)).map((p) => (
                                <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="relative w-20">
                            <Input
                              type="number" step="0.1" min="0" max="100"
                              value={a.ratio === 0 ? '' : +(a.ratio * 100).toFixed(2)}
                              onChange={(e) => {
                                const pct = parseFloat(e.target.value || '0');
                                const next = [...allocations]; next[i] = { ...next[i], ratio: pct / 100 }; setAllocations(next);
                              }}
                              className="pr-6"
                              placeholder="0"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                          </div>
                          <Button
                            type="button" variant="ghost" size="icon" className="h-8 w-8"
                            onClick={() => setAllocations(allocations.filter((_, j) => j !== i))}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      );
                    })}

                    {allocations.length > 0 && (() => {
                      const sum = allocations.reduce((s, a) => s + (a.ratio || 0), 0);
                      const pct = +(sum * 100).toFixed(2);
                      const ok = Math.abs(sum - 1) < 0.001;
                      return (
                        <p className={`text-[11px] mt-1 ${ok ? 'text-emerald-600' : 'text-destructive'}`}>
                          Total: {pct}% {ok ? '✓' : '— must equal 100%'}
                        </p>
                      );
                    })()}
                  </div>
                )}
              </section>

              {/* Column 3 — Payment, accounts & currency */}
              <section className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment & accounts</h4>
                <div className="flex items-start justify-between gap-3 rounded-md border p-3 bg-muted/30">
                  <div className="space-y-0.5">
                    <Label htmlFor="paid" className="cursor-pointer text-sm">Already paid?</Label>
                    <p className="text-[10px] text-muted-foreground">
                      {paid ? 'Credits “Paid from” account.' : 'Credits A/P (2010).'}
                    </p>
                  </div>
                  <Switch id="paid" checked={paid} onCheckedChange={setPaid} />
                </div>

                <div>
                  <Label>{capitalize ? 'Asset account (auto)' : 'Expense account (auto)'}</Label>
                  <AccountPicker
                    accounts={accounts}
                    value={expenseAccountId}
                    onChange={() => {}}
                    types={capitalize ? ['asset'] : ['expense']}
                    codePrefixes={capitalize ? ['15'] : undefined}
                    placeholder={capitalize ? 'Pick a fixed-asset account' : 'Pick an expense account'}
                    disabled
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Locked — automatically set by the Category you pick on the left.
                  </p>
                </div>

                {paid ? (
                  <div>
                    <Label>Paid from *</Label>
                    <AccountPicker
                      accounts={accounts}
                      value={paidFromAccountId}
                      onChange={setPaidFromAccountId}
                      types={['asset']}
                      codePrefixes={['10', '11']}
                      placeholder="Cash, bank, mobile money…"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">Defaults to mobile money (1040).</p>
                  </div>
                ) : (
                  <div>
                    <Label>Will be credited to</Label>
                    <AccountPicker
                      accounts={accounts}
                      value={accounts.find((a) => a.code === '2010')?.id ?? ''}
                      onChange={() => {}}
                      types={['liability']}
                      codePrefixes={['20']}
                      disabled
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">2010 — Accounts payable (auto).</p>
                  </div>
                )}

                <Separator className="my-2" />

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
                {txnCurrency !== baseCurrency && D(fxRate || 0).gt(0) && D(amount || 0).gt(0) && (
                  <p className="text-xs text-muted-foreground">
                    Posts as <strong>{fmtMoney(D(amount).times(D(fxRate)).toNumber(), baseCurrency)}</strong>.
                  </p>
                )}
              </section>
            </div>

            <Button onClick={submit} className="w-full mt-6">Save & post journal</Button>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : expenses.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted-foreground">
            <ReceiptIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
            No expenses yet. Click <strong>Add expense</strong> to record cleaning, utilities, repairs, or anything else.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead>Vendor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead><TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs">{e.expense_date}</TableCell>
                    <TableCell>
                      {e.description}
                      {e.is_capitalized && <span className="ml-2 text-xs text-muted-foreground">(capitalized)</span>}
                      {e.is_shared && (
                        <Badge variant="outline" className="ml-2 gap-1 text-[10px] py-0 h-5">
                          <Share2 className="w-3 h-3" /> Shared × {Array.isArray(e.allocations) ? e.allocations.length : 0}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{e.vendor ?? '—'}</TableCell>
                    <TableCell>
                      {(() => {
                        if (e.payment_status !== 'unpaid') return <Badge variant="secondary">Paid</Badge>;
                        const paid = partialPaid[e.id] ?? 0;
                        const total = Number(e.base_amount ?? e.amount);
                        const owed = Math.max(0, D(total).minus(D(paid)).toNumber());
                        if (paid > 0 && owed > 0) {
                          return (
                            <div className="space-y-0.5">
                              <Badge variant="destructive">Partial</Badge>
                              <div className="text-[10px] text-muted-foreground font-mono">
                                Owed: {fmtMoney(owed, baseCurrency)}
                              </div>
                            </div>
                          );
                        }
                        return <Badge variant="destructive">Unpaid (A/P)</Badge>;
                      })()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {e.payment_reference ? (
                        <span className="text-foreground">{e.payment_reference}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {(() => {
                        const txnCcy = (e.txn_currency || baseCurrency).toUpperCase();
                        const isFx = txnCcy !== baseCurrency.toUpperCase();
                        const baseAmt = e.base_amount != null
                          ? Number(e.base_amount)
                          : D(e.amount).times(D(e.fx_rate ?? 1)).toNumber();
                        return (
                          <>
                            {fmtMoney(baseAmt, baseCurrency)}
                            {isFx && (
                              <div className="text-xs text-muted-foreground font-normal">
                                {fmtMoney(e.amount, txnCcy)}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 items-center justify-end">
                        {e.receipt_url && <Paperclip className="w-4 h-4 text-muted-foreground" />}
                        {e.payment_status === 'unpaid' && (
                          <Button size="sm" variant="outline" onClick={() => setPayBillFor(e)}>
                            <Wallet className="w-3.5 h-3.5 mr-1" /> Pay bill
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" onClick={() => del(e.id)}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={savePresetOpen} onOpenChange={setSavePresetOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Save sharing preset</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Save this {allocations.length}-property split as a reusable preset (e.g. "Beach house 70 / Cabin 30").
            </p>
            <div>
              <Label>Preset name</Label>
              <Input
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                placeholder="e.g. 3-property even split"
                autoFocus
              />
              {presets.some((p) => p.name.toLowerCase() === newPresetName.trim().toLowerCase()) && (
                <p className="text-[11px] text-muted-foreground mt-1">A preset with this name will be overwritten.</p>
              )}
            </div>
            <div className="rounded-md bg-muted/40 p-2 text-xs space-y-1">
              {allocations.map((a, i) => {
                const prop = properties.find((p) => p.id === a.property_id);
                return (
                  <div key={i} className="flex justify-between">
                    <span>{prop?.title ?? '—'}</span>
                    <span className="font-mono">{(a.ratio * 100).toFixed(2)}%</span>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSavePresetOpen(false)}>Cancel</Button>
              <Button onClick={savePreset}>Save preset</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <PayBillDialog
        open={!!payBillFor}
        onOpenChange={(v) => !v && setPayBillFor(null)}
        hostId={hostId}
        baseCurrency={baseCurrency}
        expense={payBillFor}
        accounts={accounts}
        onDone={load}
      />
      <PinConfirmDialog
        open={!!pendingDeleteId}
        onOpenChange={(v) => { if (!v) setPendingDeleteId(null); }}
        title="Delete this expense?"
        description="This will remove the expense and its balanced journal entry. Enter your accounting PIN to confirm."
        confirmLabel="Delete expense"
        onConfirmed={performDelete}
      />
    </Card>
  );
}
