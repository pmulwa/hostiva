import { useEffect, useMemo, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  CheckCircle2, AlertTriangle, RotateCcw, Banknote, Plus, Search, ScaleIcon,
  Send, Trash2, FileText,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { logAdminAction } from '@/lib/audit';

// ---------- Types ----------
interface BookingRow {
  id: string;
  host_id: string;
  guest_id: string;
  property_id: string;
  status: string;
  currency: string | null;
  total_price: number;
  subtotal: number;
  cleaning_fee: number | null;
  service_fee: number | null;
  check_in_date: string;
  check_out_date: string;
  updated_at: string;
}
interface JournalLine {
  id: string;
  entry_id: string;
  account_id: string;
  debit: number;
  credit: number;
  memo: string | null;
}
interface ChartAccount { id: string; code: string; name: string; type: string; }
interface ExternalBooking { id: string; journal_entry_id: string | null; notes: string | null; }
interface PayoutRow {
  id: string; amount: number; status: string;
  payment_method: string | null; transaction_reference: string | null;
  paid_at: string | null;
}
interface ReconciliationRow {
  id: string; booking_id: string; reconciled_at: string;
  total_debits: number; total_credits: number; is_balanced: boolean;
  notes: string | null; reversed_at: string | null; reversal_reason: string | null;
}
interface BankCharge {
  id: string; host_id: string; booking_id: string | null;
  charge_type: string; amount: number; currency: string;
  charge_date: string; description: string; reference: string | null;
  journal_entry_id: string | null; voided_at: string | null;
  void_reason: string | null; created_at: string;
  status: 'draft' | 'posted' | 'voided';
}

const fmt = (n: number, ccy = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: ccy }).format(n || 0);

/**
 * Comprehensive STR cost catalog. Grouped for the picker; each value
 * matches the CHECK constraint and the routing function on the database.
 */
/**
 * Categories are aligned to the SEEDED chart of accounts. Each value matches
 * the CHECK constraint and the routing function on the database, so every
 * posting lands in the correct CoA code. The label includes the target code
 * so admins can see exactly where a charge will hit the books.
 */
const CHARGE_GROUPS: Array<{ group: string; items: Array<{ value: string; label: string }> }> = [
  { group: 'Banking & payments', items: [
    { value: 'bank_fee', label: 'Bank fee → 6400' },
    { value: 'wire_fee', label: 'Wire / transfer fee → 6400' },
    { value: 'chargeback', label: 'Chargeback → 6400' },
    { value: 'reversal', label: 'Payment reversal → 6400' },
    { value: 'payment_processing_fee', label: 'Payment processing fee → 5100' },
    { value: 'currency_conversion', label: 'Currency conversion fee → 5100' },
    { value: 'fx_adjustment', label: 'FX loss → 7030' },
    { value: 'fx_gain', label: 'FX gain (income) → 4910' },
  ]},
  { group: 'Platform commissions', items: [
    { value: 'hostly_commission', label: 'Hostly commission → 5010' },
    { value: 'airbnb_commission', label: 'Airbnb commission → 5020' },
    { value: 'booking_com_commission', label: 'Booking.com commission → 5030' },
    { value: 'vrbo_commission', label: 'Vrbo commission → 5040' },
    { value: 'direct_commission', label: 'Direct booking fee → 5050' },
    { value: 'other_platform_commission', label: 'Other platform commission → 5050' },
  ]},
  { group: 'Operations & cleaning', items: [
    { value: 'cleaning_labor', label: 'Cleaning — labor → 5200' },
    { value: 'cleaning_supplies', label: 'Cleaning — supplies → 5210' },
    { value: 'linen_laundry', label: 'Linen & laundry → 5220' },
    { value: 'guest_amenities', label: 'Guest amenities → 5230' },
  ]},
  { group: 'Maintenance & management', items: [
    { value: 'repairs_maintenance', label: 'Repairs & maintenance → 6100' },
    { value: 'property_management_fee', label: 'Property management fee → 6110' },
    { value: 'damage_repair', label: 'Damage repair (cost) → 6100' },
  ]},
  { group: 'Utilities', items: [
    { value: 'electricity', label: 'Electricity → 6010' },
    { value: 'water', label: 'Water → 6020' },
    { value: 'internet', label: 'Internet → 6030' },
    { value: 'gas', label: 'Gas → 6040' },
  ]},
  { group: 'Insurance, tax & legal', items: [
    { value: 'insurance', label: 'Insurance → 6200' },
    { value: 'property_tax', label: 'Property tax → 6210' },
    { value: 'tourism_levy', label: 'Tourism / occupancy levy → 6230' },
    { value: 'license_permit', label: 'License & permits → 6220' },
    { value: 'professional_fees', label: 'Legal / accounting fees → 6420' },
  ]},
  { group: 'Software, office & travel', items: [
    { value: 'software_subscriptions', label: 'Software subscriptions → 6320' },
    { value: 'office_admin', label: 'Office & admin → 6410' },
    { value: 'travel', label: 'Travel → 6430' },
    { value: 'hoa_fees', label: 'HOA fees → 6410' },
    { value: 'rent_paid', label: 'Rent paid (master lease) → 6410' },
  ]},
  { group: 'Marketing', items: [
    { value: 'marketing_advertising', label: 'Marketing & advertising → 6300' },
    { value: 'photography', label: 'Photography → 6310' },
  ]},
  { group: 'Property finance', items: [
    { value: 'mortgage_interest', label: 'Mortgage interest → 7010' },
    { value: 'loan_interest', label: 'Loan interest → 7020' },
    { value: 'mortgage_principal', label: 'Mortgage principal payment → 2500' },
    { value: 'loan_principal', label: 'Loan principal payment → 2400' },
    { value: 'depreciation', label: 'Depreciation (non-cash) → 6500 / 1590' },
  ]},
  { group: 'Asset purchases', items: [
    { value: 'asset_purchase_land', label: 'Buy land → 1500' },
    { value: 'asset_purchase_building', label: 'Buy building → 1510' },
    { value: 'asset_purchase_furniture', label: 'Buy furniture & fixtures → 1520' },
    { value: 'asset_purchase_appliances', label: 'Buy appliances → 1530' },
    { value: 'asset_purchase_electronics', label: 'Buy electronics → 1540' },
    { value: 'prepaid_insurance', label: 'Prepaid insurance → 1300' },
    { value: 'prepaid_subscription', label: 'Prepaid subscription → 1310' },
  ]},
  { group: 'Liabilities settled / received', items: [
    { value: 'pay_accounts_payable', label: 'Pay accounts payable → 2010' },
    { value: 'pay_credit_card', label: 'Pay credit card → 2020' },
    { value: 'pay_vat', label: 'Pay VAT → 2300' },
    { value: 'pay_tourism_levy_due', label: 'Remit tourism levy → 2310' },
    { value: 'pay_income_tax_due', label: 'Pay income tax → 2320' },
    { value: 'short_term_loan_received', label: 'Short-term loan received → 2400' },
    { value: 'short_term_loan_repayment', label: 'Short-term loan repayment → 2400' },
  ]},
  { group: 'Guest related', items: [
    { value: 'security_deposit_hold', label: 'Security deposit hold → 2100' },
    { value: 'security_deposit_release', label: 'Security deposit release → 2100' },
    { value: 'damage_recovery', label: 'Damage recovery (income) → 4900' },
    { value: 'guest_refund', label: 'Guest refund → 4010' },
    { value: 'goodwill_credit', label: 'Goodwill credit → 4900' },
    { value: 'guest_compensation', label: 'Guest compensation → 6410' },
    { value: 'extra_guest_fee_income', label: 'Extra guest fee (income) → 4110' },
    { value: 'pet_fee_income', label: 'Pet fee (income) → 4120' },
    { value: 'cancellation_fee_income', label: 'Cancellation fee (income) → 4130' },
  ]},
  { group: 'Owner / equity', items: [
    { value: 'owner_capital_contribution', label: 'Owner capital contribution → 3010' },
    { value: 'owner_draw', label: 'Owner draw → 3020' },
    { value: 'opening_balance_equity', label: 'Opening balance equity → 3040' },
  ]},
  { group: 'Misc', items: [
    { value: 'other_income', label: 'Other income → 4900' },
    { value: 'other_expense', label: 'Other expense → 6410' },
    { value: 'other', label: 'Other (uncategorised) → 6410' },
  ]},
];

const CHARGE_LABELS: Record<string, string> = Object.fromEntries(
  CHARGE_GROUPS.flatMap(g => g.items.map(i => [i.value, i.label.replace(/ → .*$/, '')]))
);

export default function AdminReconciliation() {
  const [loading, setLoading] = useState(true);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [externals, setExternals] = useState<Record<string, ExternalBooking>>({});
  const [linesByEntry, setLinesByEntry] = useState<Record<string, JournalLine[]>>({});
  const [payoutsByBooking, setPayoutsByBooking] = useState<Record<string, PayoutRow[]>>({});
  const [reconByBooking, setReconByBooking] = useState<Record<string, ReconciliationRow>>({});
  const [accounts, setAccounts] = useState<Record<string, ChartAccount>>({});
  const [bankCharges, setBankCharges] = useState<BankCharge[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'unbalanced' | 'unreconciled' | 'reconciled'>('all');

  // Reconcile / unreconcile dialogs
  const [actionBooking, setActionBooking] = useState<BookingRow | null>(null);
  const [actionMode, setActionMode] = useState<'reconcile' | 'reverse' | null>(null);
  const [actionNote, setActionNote] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  // Bank charge form
  const [bcOpen, setBcOpen] = useState(false);
  const [bcEditingId, setBcEditingId] = useState<string | null>(null);
  const [bcForm, setBcForm] = useState({
    host_id: '', booking_id: '', charge_type: 'bank_fee',
    amount: '', currency: 'USD', charge_date: new Date().toISOString().slice(0, 10),
    description: '', reference: '',
  });
  const [bcBusy, setBcBusy] = useState(false);

  // Charges tab filter
  const [chargeFilter, setChargeFilter] = useState<'all' | 'draft' | 'posted' | 'voided'>('all');

  async function loadAll() {
    setLoading(true);
    try {
      // Completed bookings (most recent first, reasonable cap)
      const { data: bks, error: bkErr } = await supabase
        .from('bookings')
        .select('id, host_id, guest_id, property_id, status, currency, total_price, subtotal, cleaning_fee, service_fee, check_in_date, check_out_date, updated_at')
        .eq('status', 'completed')
        .order('updated_at', { ascending: false })
        .limit(500);
      if (bkErr) throw bkErr;
      const list = (bks ?? []) as BookingRow[];
      setBookings(list);

      const ids = list.map(b => b.id);
      if (ids.length === 0) {
        setExternals({}); setLinesByEntry({}); setPayoutsByBooking({}); setReconByBooking({});
        return;
      }

      // Auto-posted external bookings tagged AUTO:HOSTLY:<booking_id>
      const tags = ids.map(id => `AUTO:HOSTLY:${id}`);
      const { data: ext } = await supabase
        .from('acct_external_bookings')
        .select('id, journal_entry_id, notes')
        .in('notes', tags);
      const extMap: Record<string, ExternalBooking> = {};
      (ext ?? []).forEach((e: any) => {
        const m = (e.notes as string | null)?.match(/^AUTO:HOSTLY:(.+)$/);
        if (m) extMap[m[1]] = e as ExternalBooking;
      });
      setExternals(extMap);

      // Journal lines for those entries
      const entryIds = Object.values(extMap).map(e => e.journal_entry_id).filter(Boolean) as string[];
      const lines: Record<string, JournalLine[]> = {};
      if (entryIds.length) {
        const { data: jl } = await supabase
          .from('acct_journal_lines')
          .select('id, entry_id, account_id, debit, credit, memo')
          .in('entry_id', entryIds);
        (jl ?? []).forEach((l: any) => {
          (lines[l.entry_id] ||= []).push(l as JournalLine);
        });
      }
      setLinesByEntry(lines);

      // Accounts dictionary
      const accIds = Array.from(new Set(Object.values(lines).flat().map(l => l.account_id)));
      if (accIds.length) {
        const { data: accs } = await supabase
          .from('acct_chart_of_accounts')
          .select('id, code, name, type')
          .in('id', accIds);
        const accMap: Record<string, ChartAccount> = {};
        (accs ?? []).forEach((a: any) => { accMap[a.id] = a as ChartAccount; });
        setAccounts(accMap);
      } else {
        setAccounts({});
      }

      // Payouts per booking
      const { data: pys } = await supabase
        .from('payouts')
        .select('id, booking_id, amount, status, payment_method, transaction_reference, paid_at')
        .in('booking_id', ids);
      const pyMap: Record<string, PayoutRow[]> = {};
      (pys ?? []).forEach((p: any) => { (pyMap[p.booking_id] ||= []).push(p as PayoutRow); });
      setPayoutsByBooking(pyMap);

      // Existing reconciliations
      const { data: rcs } = await supabase
        .from('acct_reconciliations')
        .select('id, booking_id, reconciled_at, total_debits, total_credits, is_balanced, notes, reversed_at, reversal_reason')
        .in('booking_id', ids);
      const rcMap: Record<string, ReconciliationRow> = {};
      (rcs ?? []).forEach((r: any) => { rcMap[r.booking_id] = r as ReconciliationRow; });
      setReconByBooking(rcMap);

      // Bank charges (most recent 100)
      const { data: bcs } = await supabase
        .from('acct_bank_charges')
        .select('id, host_id, booking_id, charge_type, amount, currency, charge_date, description, reference, journal_entry_id, voided_at, void_reason, created_at, status')
        .order('charge_date', { ascending: false })
        .limit(100);
      setBankCharges((bcs ?? []) as BankCharge[]);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? 'Failed to load reconciliation data');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  // ---------- Derived rows ----------
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bookings
      .map(b => {
        const ext = externals[b.id];
        const entryId = ext?.journal_entry_id ?? null;
        const lines = entryId ? (linesByEntry[entryId] ?? []) : [];
        const debits = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
        const credits = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
        const diff = +(debits - credits).toFixed(2);
        const balanced = lines.length > 0 && diff === 0;
        const recon = reconByBooking[b.id];
        const payouts = payoutsByBooking[b.id] ?? [];
        return { booking: b, entryId, lines, debits, credits, diff, balanced, recon, payouts };
      })
      .filter(r => {
        if (filter === 'unbalanced' && r.balanced) return false;
        if (filter === 'unreconciled' && r.recon && !r.recon.reversed_at) return false;
        if (filter === 'reconciled' && (!r.recon || r.recon.reversed_at)) return false;
        if (q) {
          const hay = `${r.booking.id} ${r.booking.host_id} ${r.booking.guest_id}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
  }, [bookings, externals, linesByEntry, reconByBooking, payoutsByBooking, filter, search]);

  const summary = useMemo(() => {
    const balanced = rows.filter(r => r.balanced).length;
    const unbalanced = rows.filter(r => r.lines.length > 0 && !r.balanced).length;
    const unposted = rows.filter(r => r.lines.length === 0).length;
    const reconciled = rows.filter(r => r.recon && !r.recon.reversed_at).length;
    return { balanced, unbalanced, unposted, reconciled, total: rows.length };
  }, [rows]);

  // ---------- Actions ----------
  async function submitReconcile() {
    if (!actionBooking || !actionMode) return;
    setActionBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      if (actionMode === 'reconcile') {
        const r = rows.find(x => x.booking.id === actionBooking.id);
        if (!r) throw new Error('Booking not loaded');
        const existing = reconByBooking[actionBooking.id];
        const payload = {
          booking_id: actionBooking.id,
          host_id: actionBooking.host_id,
          reconciled_by: user.id,
          reconciled_at: new Date().toISOString(),
          total_debits: r.debits,
          total_credits: r.credits,
          is_balanced: r.balanced,
          notes: actionNote || null,
          reversed_at: null,
          reversed_by: null,
          reversal_reason: null,
        };
        const { error } = existing
          ? await supabase.from('acct_reconciliations').update(payload).eq('id', existing.id)
          : await supabase.from('acct_reconciliations').insert(payload);
        if (error) throw error;
        await logAdminAction('reconcile_booking', 'booking', actionBooking.id, {
          balanced: r.balanced, debits: r.debits, credits: r.credits,
        });
        toast.success('Booking reconciled');
      } else {
        const existing = reconByBooking[actionBooking.id];
        if (!existing) throw new Error('No reconciliation to reverse');
        const { error } = await supabase
          .from('acct_reconciliations')
          .update({
            reversed_at: new Date().toISOString(),
            reversed_by: user.id,
            reversal_reason: actionNote || 'Back-reconciliation',
          })
          .eq('id', existing.id);
        if (error) throw error;
        await logAdminAction('reverse_reconciliation', 'booking', actionBooking.id, {
          reason: actionNote,
        });
        toast.success('Reconciliation reversed');
      }
      setActionBooking(null); setActionMode(null); setActionNote('');
      await loadAll();
    } catch (e: any) {
      toast.error(e?.message ?? 'Action failed');
    } finally {
      setActionBusy(false);
    }
  }

  function resetBcForm() {
    setBcForm({
      host_id: '', booking_id: '', charge_type: 'bank_fee',
      amount: '', currency: 'USD', charge_date: new Date().toISOString().slice(0, 10),
      description: '', reference: '',
    });
    setBcEditingId(null);
  }

  /**
   * Save a bank charge.
   *  - mode 'draft'      => insert/update draft, do NOT post to journal
   *  - mode 'post'       => insert/update then call acct_post_bank_charge
   */
  async function submitBankCharge(mode: 'draft' | 'post') {
    setBcBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');
      const amt = Number(bcForm.amount);
      if (!bcForm.host_id) throw new Error('Host is required');
      if (!bcForm.description.trim()) throw new Error('Description is required');
      if (!Number.isFinite(amt) || amt <= 0) throw new Error('Amount must be > 0');

      const payload = {
        host_id: bcForm.host_id,
        booking_id: bcForm.booking_id || null,
        charge_type: bcForm.charge_type,
        amount: amt,
        currency: bcForm.currency || 'USD',
        charge_date: bcForm.charge_date,
        description: bcForm.description.trim(),
        reference: bcForm.reference.trim() || null,
      };

      let chargeId = bcEditingId;
      if (chargeId) {
        // Update existing draft. Posted/voided charges are not editable here.
        const existing = bankCharges.find(c => c.id === chargeId);
        if (!existing || existing.status !== 'draft') {
          throw new Error('Only draft charges can be edited');
        }
        const { error: upErr } = await supabase
          .from('acct_bank_charges')
          .update(payload)
          .eq('id', chargeId);
        if (upErr) {
          if ((upErr as any).code === '23505') {
            throw new Error('A draft with the same host, booking, date, amount, type and reference already exists.');
          }
          throw upErr;
        }
      } else {
        // Friendly client-side pre-check (DB still enforces via unique index).
        const dup = bankCharges.find(c =>
          c.status === 'draft' &&
          c.host_id === payload.host_id &&
          (c.booking_id ?? null) === (payload.booking_id ?? null) &&
          c.charge_date === payload.charge_date &&
          Number(c.amount) === amt &&
          c.charge_type === payload.charge_type &&
          (c.reference ?? '') === (payload.reference ?? '')
        );
        if (dup) {
          throw new Error('A matching draft already exists. Edit it instead of creating a new one.');
        }

        const { data: ins, error } = await supabase
          .from('acct_bank_charges')
          .insert({ ...payload, created_by: user.id, status: 'draft' })
          .select('id')
          .single();
        if (error) {
          if ((error as any).code === '23505') {
            throw new Error('A draft with the same host, booking, date, amount, type and reference already exists.');
          }
          throw error;
        }
        chargeId = ins!.id;
      }

      if (mode === 'post') {
        const { error: postErr } = await supabase.rpc('acct_post_bank_charge', {
          p_charge_id: chargeId!,
        });
        if (postErr) throw postErr;
        await logAdminAction('post_bank_charge', 'bank_charge', chargeId!, {
          amount: amt, charge_type: bcForm.charge_type, host_id: bcForm.host_id,
        });
        toast.success('Bank charge posted to journal');
      } else {
        await logAdminAction(
          bcEditingId ? 'update_draft_bank_charge' : 'create_draft_bank_charge',
          'bank_charge', chargeId!,
          { amount: amt, charge_type: bcForm.charge_type, host_id: bcForm.host_id },
        );
        toast.success(bcEditingId ? 'Draft updated' : 'Draft saved — post when ready');
      }

      setBcOpen(false);
      resetBcForm();
      await loadAll();
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to post bank charge');
    } finally {
      setBcBusy(false);
    }
  }

  async function postExistingDraft(c: BankCharge) {
    try {
      const { error } = await supabase.rpc('acct_post_bank_charge', { p_charge_id: c.id });
      if (error) throw error;
      await logAdminAction('post_bank_charge', 'bank_charge', c.id, {
        amount: c.amount, charge_type: c.charge_type, host_id: c.host_id,
      });
      toast.success('Draft posted to journal');
      await loadAll();
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to post draft');
    }
  }

  async function deleteDraft(c: BankCharge) {
    if (!window.confirm('Delete this draft? This cannot be undone.')) return;
    try {
      const { error } = await supabase.rpc('acct_delete_draft_bank_charge', { p_charge_id: c.id });
      if (error) throw error;
      await logAdminAction('delete_draft_bank_charge', 'bank_charge', c.id, {});
      toast.success('Draft deleted');
      await loadAll();
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to delete draft');
    }
  }

  function openEditDraft(c: BankCharge) {
    setBcEditingId(c.id);
    setBcForm({
      host_id: c.host_id,
      booking_id: c.booking_id ?? '',
      charge_type: c.charge_type,
      amount: String(c.amount),
      currency: c.currency,
      charge_date: c.charge_date,
      description: c.description,
      reference: c.reference ?? '',
    });
    setBcOpen(true);
  }

  async function voidBankCharge(c: BankCharge) {
    const reason = window.prompt('Reason for voiding this charge?');
    if (reason === null) return;
    try {
      const { error } = await supabase.rpc('acct_void_bank_charge', {
        p_charge_id: c.id, p_reason: reason || 'No reason given',
      });
      if (error) throw error;
      await logAdminAction('void_bank_charge', 'bank_charge', c.id, { reason });
      toast.success('Bank charge voided');
      await loadAll();
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to void');
    }
  }

  // ---------- Render ----------
  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ScaleIcon className="h-6 w-6 text-primary" />
              Reconciliation
            </h1>
            <p className="text-muted-foreground text-sm">
              Review every completed booking's journal lines and payouts. Sign off when balanced, reverse if needed,
              and post bank charges or other deductions.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={loadAll}>Refresh</Button>
            <Button onClick={() => setBcOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> New bank charge
            </Button>
          </div>
        </div>

        {/* Summary */}
        <div className="grid gap-3 md:grid-cols-5">
          {[
            { label: 'Total', value: summary.total },
            { label: 'Balanced', value: summary.balanced, tone: 'text-emerald-600' },
            { label: 'Unbalanced', value: summary.unbalanced, tone: 'text-destructive' },
            { label: 'Not posted', value: summary.unposted, tone: 'text-amber-600' },
            { label: 'Reconciled', value: summary.reconciled, tone: 'text-primary' },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="p-4">
                <div className="text-xs uppercase text-muted-foreground">{s.label}</div>
                <div className={`text-2xl font-semibold ${s.tone ?? ''}`}>{s.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="bookings" className="w-full">
          <TabsList>
            <TabsTrigger value="bookings">Bookings</TabsTrigger>
            <TabsTrigger value="charges">Bank charges & deductions</TabsTrigger>
          </TabsList>

          {/* ---------- Bookings tab ---------- */}
          <TabsContent value="bookings" className="space-y-4">
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Search by booking / host / guest id"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
                <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All completed</SelectItem>
                  <SelectItem value="unbalanced">Unbalanced only</SelectItem>
                  <SelectItem value="unreconciled">Unreconciled only</SelectItem>
                  <SelectItem value="reconciled">Reconciled only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
              </div>
            ) : rows.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground">
                No completed bookings match this filter.
              </CardContent></Card>
            ) : (
              <div className="space-y-3">
                {rows.map(r => (
                  <Card key={r.booking.id}>
                    <CardHeader className="pb-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <CardTitle className="text-base font-mono">
                            {r.booking.id.slice(0, 8)}…
                          </CardTitle>
                          <div className="text-xs text-muted-foreground">
                            Host {r.booking.host_id.slice(0, 8)} · Guest {r.booking.guest_id.slice(0, 8)}
                            {' · '}{r.booking.check_in_date} → {r.booking.check_out_date}
                            {' · '}{fmt(r.booking.total_price, r.booking.currency ?? 'USD')}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {r.lines.length === 0 ? (
                            <Badge variant="outline" className="text-amber-600 border-amber-300">
                              <AlertTriangle className="h-3 w-3 mr-1" /> Not posted
                            </Badge>
                          ) : r.balanced ? (
                            <Badge variant="outline" className="text-emerald-700 border-emerald-300">
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Balanced
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-destructive border-destructive/40">
                              <AlertTriangle className="h-3 w-3 mr-1" /> Δ {fmt(r.diff, r.booking.currency ?? 'USD')}
                            </Badge>
                          )}
                          {r.recon && !r.recon.reversed_at && (
                            <Badge className="bg-primary/10 text-primary border-primary/30">
                              Reconciled {new Date(r.recon.reconciled_at).toLocaleDateString()}
                            </Badge>
                          )}
                          {r.recon?.reversed_at && (
                            <Badge variant="outline">Reversed</Badge>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Journal lines */}
                      <div>
                        <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                          Journal lines
                        </div>
                        {r.lines.length === 0 ? (
                          <div className="text-sm text-muted-foreground">
                            No journal entry yet — host has not enabled the books or auto-post is pending.
                          </div>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Account</TableHead>
                                <TableHead className="text-right">Debit</TableHead>
                                <TableHead className="text-right">Credit</TableHead>
                                <TableHead>Memo</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {r.lines.map(l => {
                                const a = accounts[l.account_id];
                                return (
                                  <TableRow key={l.id}>
                                    <TableCell className="font-mono text-xs">
                                      {a ? `${a.code} · ${a.name}` : l.account_id.slice(0, 8)}
                                    </TableCell>
                                    <TableCell className="text-right">{Number(l.debit) ? fmt(Number(l.debit), r.booking.currency ?? 'USD') : ''}</TableCell>
                                    <TableCell className="text-right">{Number(l.credit) ? fmt(Number(l.credit), r.booking.currency ?? 'USD') : ''}</TableCell>
                                    <TableCell className="text-xs text-muted-foreground">{l.memo}</TableCell>
                                  </TableRow>
                                );
                              })}
                              <TableRow className="font-semibold border-t-2">
                                <TableCell>Total</TableCell>
                                <TableCell className="text-right">{fmt(r.debits, r.booking.currency ?? 'USD')}</TableCell>
                                <TableCell className="text-right">{fmt(r.credits, r.booking.currency ?? 'USD')}</TableCell>
                                <TableCell className={r.balanced ? 'text-emerald-600' : 'text-destructive'}>
                                  {r.balanced ? 'Debits = Credits' : `Out of balance by ${fmt(r.diff, r.booking.currency ?? 'USD')}`}
                                </TableCell>
                              </TableRow>
                            </TableBody>
                          </Table>
                        )}
                      </div>

                      {/* Payouts */}
                      <div>
                        <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Payouts</div>
                        {r.payouts.length === 0 ? (
                          <div className="text-sm text-muted-foreground">No payout records.</div>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                                <TableHead>Method</TableHead>
                                <TableHead>Reference</TableHead>
                                <TableHead>Paid</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {r.payouts.map(p => (
                                <TableRow key={p.id}>
                                  <TableCell><Badge variant="outline">{p.status}</Badge></TableCell>
                                  <TableCell className="text-right">{fmt(Number(p.amount), r.booking.currency ?? 'USD')}</TableCell>
                                  <TableCell>{p.payment_method ?? '—'}</TableCell>
                                  <TableCell className="font-mono text-xs">{p.transaction_reference ?? '—'}</TableCell>
                                  <TableCell>{p.paid_at ? new Date(p.paid_at).toLocaleString() : '—'}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </div>

                      {/* Reconciliation footer */}
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t">
                        <div className="text-xs text-muted-foreground">
                          {r.recon
                            ? r.recon.reversed_at
                              ? `Reversed: ${r.recon.reversal_reason ?? '—'}`
                              : `Reconciled · D ${fmt(Number(r.recon.total_debits), r.booking.currency ?? 'USD')} = C ${fmt(Number(r.recon.total_credits), r.booking.currency ?? 'USD')}${r.recon.notes ? ` · ${r.recon.notes}` : ''}`
                            : 'Awaiting reconciliation'}
                        </div>
                        <div className="flex gap-2">
                          {(!r.recon || r.recon.reversed_at) ? (
                            <Button
                              size="sm"
                              disabled={r.lines.length === 0}
                              onClick={() => { setActionBooking(r.booking); setActionMode('reconcile'); setActionNote(''); }}
                            >
                              <CheckCircle2 className="h-4 w-4 mr-1" /> Reconcile
                            </Button>
                          ) : (
                            <Button
                              size="sm" variant="outline"
                              onClick={() => { setActionBooking(r.booking); setActionMode('reverse'); setActionNote(''); }}
                            >
                              <RotateCcw className="h-4 w-4 mr-1" /> Reverse
                            </Button>
                          )}
                          <Button
                            size="sm" variant="outline"
                            onClick={() => {
                              setBcForm(f => ({ ...f, host_id: r.booking.host_id, booking_id: r.booking.id, currency: r.booking.currency ?? 'USD' }));
                              setBcOpen(true);
                            }}
                          >
                            <Banknote className="h-4 w-4 mr-1" /> Add bank charge
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ---------- Bank charges tab ---------- */}
          <TabsContent value="charges" className="space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <Select value={chargeFilter} onValueChange={(v) => setChargeFilter(v as typeof chargeFilter)}>
                <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All charges</SelectItem>
                  <SelectItem value="draft">Drafts only</SelectItem>
                  <SelectItem value="posted">Posted only</SelectItem>
                  <SelectItem value="voided">Voided only</SelectItem>
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground">
                Drafts are saved but not yet posted to the journal.
              </div>
            </div>
            {loading ? (
              <Skeleton className="h-40 w-full" />
            ) : bankCharges.filter(c => chargeFilter === 'all' || c.status === chargeFilter).length === 0 ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground">
                No charges match this filter. Click <em>New bank charge</em> to record one.
              </CardContent></Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Host / Booking</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bankCharges
                        .filter(c => chargeFilter === 'all' || c.status === chargeFilter)
                        .map(c => (
                        <TableRow key={c.id}>
                          <TableCell>{c.charge_date}</TableCell>
                          <TableCell><Badge variant="outline">{CHARGE_LABELS[c.charge_type] ?? c.charge_type}</Badge></TableCell>
                          <TableCell>
                            <div className="text-sm">{c.description}</div>
                            {c.reference && <div className="text-xs text-muted-foreground font-mono">{c.reference}</div>}
                          </TableCell>
                          <TableCell className="text-xs font-mono">
                            {c.host_id.slice(0, 8)}{c.booking_id ? ` / ${c.booking_id.slice(0, 8)}` : ''}
                          </TableCell>
                          <TableCell className="text-right">{fmt(Number(c.amount), c.currency)}</TableCell>
                          <TableCell>
                            {c.status === 'voided' ? (
                              <Badge variant="outline">Voided</Badge>
                            ) : c.status === 'posted' ? (
                              <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">Posted</Badge>
                            ) : (
                              <Badge className="bg-amber-50 text-amber-700 border-amber-200">
                                <FileText className="h-3 w-3 mr-1" /> Draft
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            {c.status === 'draft' && (
                              <>
                                <Button size="sm" variant="ghost" onClick={() => openEditDraft(c)}>Edit</Button>
                                <Button size="sm" variant="ghost" onClick={() => postExistingDraft(c)}>
                                  <Send className="h-3.5 w-3.5 mr-1" /> Post
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => deleteDraft(c)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                            {c.status === 'posted' && (
                              <Button size="sm" variant="ghost" onClick={() => voidBankCharge(c)}>Void</Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* ---- Reconcile / reverse dialog ---- */}
      <Dialog
        open={!!actionBooking && !!actionMode}
        onOpenChange={(o) => { if (!o) { setActionBooking(null); setActionMode(null); } }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionMode === 'reconcile' ? 'Reconcile booking' : 'Reverse reconciliation'}
            </DialogTitle>
            <DialogDescription>
              {actionMode === 'reconcile'
                ? 'Confirms the journal entry has been reviewed and matches bank/payout records.'
                : 'Marks the reconciliation as reversed (back-reconciliation). The history is preserved.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>{actionMode === 'reconcile' ? 'Notes (optional)' : 'Reason'}</Label>
            <Textarea
              value={actionNote}
              onChange={(e) => setActionNote(e.target.value)}
              placeholder={actionMode === 'reconcile' ? 'Matched against statement…' : 'Why is this being reversed?'}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setActionBooking(null); setActionMode(null); }}>
              Cancel
            </Button>
            <Button onClick={submitReconcile} disabled={actionBusy}>
              {actionBusy ? 'Saving…' : actionMode === 'reconcile' ? 'Confirm reconcile' : 'Reverse'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- New bank charge dialog ---- */}
      <Dialog open={bcOpen} onOpenChange={(o) => { setBcOpen(o); if (!o) resetBcForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{bcEditingId ? 'Edit draft charge' : 'New bank charge / cost'}</DialogTitle>
            <DialogDescription>
              Save as a draft to review later, or post immediately. Posting writes a balanced
              double-entry routed to the right account for the chosen category.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Category</Label>
                <Select
                  value={bcForm.charge_type}
                  onValueChange={(v) => setBcForm(f => ({ ...f, charge_type: v }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-80">
                    {CHARGE_GROUPS.map(g => (
                      <div key={g.group}>
                        <div className="px-2 py-1 text-xs font-semibold uppercase text-muted-foreground">{g.group}</div>
                        {g.items.map(t => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </div>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Date</Label>
                <Input
                  type="date" value={bcForm.charge_date}
                  onChange={(e) => setBcForm(f => ({ ...f, charge_date: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Amount</Label>
                <Input
                  type="number" step="0.01" min="0.01"
                  value={bcForm.amount}
                  onChange={(e) => setBcForm(f => ({ ...f, amount: e.target.value }))}
                />
              </div>
              <div>
                <Label>Currency</Label>
                <Input
                  value={bcForm.currency}
                  onChange={(e) => setBcForm(f => ({ ...f, currency: e.target.value.toUpperCase() }))}
                />
              </div>
            </div>
            <div>
              <Label>Host ID</Label>
              <Input
                value={bcForm.host_id} placeholder="uuid"
                onChange={(e) => setBcForm(f => ({ ...f, host_id: e.target.value }))}
              />
            </div>
            <div>
              <Label>Booking ID (optional)</Label>
              <Input
                value={bcForm.booking_id} placeholder="uuid"
                onChange={(e) => setBcForm(f => ({ ...f, booking_id: e.target.value }))}
              />
            </div>
            <div>
              <Label>Description</Label>
              <Input
                value={bcForm.description}
                onChange={(e) => setBcForm(f => ({ ...f, description: e.target.value }))}
                placeholder="e.g. Wise wire transfer fee"
              />
            </div>
            <div>
              <Label>Reference (optional)</Label>
              <Input
                value={bcForm.reference}
                onChange={(e) => setBcForm(f => ({ ...f, reference: e.target.value }))}
                placeholder="Statement / TXN ref"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBcOpen(false); resetBcForm(); }}>
              Cancel
            </Button>
            <Button variant="secondary" onClick={() => submitBankCharge('draft')} disabled={bcBusy}>
              <FileText className="h-4 w-4 mr-1" />
              {bcBusy ? 'Saving…' : bcEditingId ? 'Save draft' : 'Save as draft'}
            </Button>
            <Button onClick={() => submitBankCharge('post')} disabled={bcBusy}>
              <Send className="h-4 w-4 mr-1" />
              {bcBusy ? 'Posting…' : 'Save & post'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}