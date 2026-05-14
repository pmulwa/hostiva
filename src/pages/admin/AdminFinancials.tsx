import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { usePlatformSettings, calculateFees } from '@/hooks/usePlatformSettings';
import { useAuth } from '@/contexts/AuthContext';
import { logAdminAction } from '@/lib/audit';
import { toast } from 'sonner';
import {
  DollarSign, Users, Building2, TrendingUp, ArrowUpRight, ArrowDownRight,
  Receipt, Wallet, PiggyBank, CreditCard, FileText, Download, Landmark, RotateCcw,
  Clock, AlertTriangle, CheckCircle2, XCircle, Send, Pause, Ban, History
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Database } from '@/integrations/supabase/types';

type Booking = Database['public']['Tables']['bookings']['Row'];
type Profile = Database['public']['Tables']['profiles']['Row'];
type Property = Database['public']['Tables']['properties']['Row'];

interface Payout {
  id: string;
  host_id: string;
  booking_id: string;
  amount: number;
  status: string;
  payment_method: string | null;
  transaction_reference: string | null;
  notes: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
  processed_by: string | null;
}

const fmt = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function getDaysBefore(checkInDate: string, cancelledAt: string) {
  const checkIn = new Date(checkInDate);
  const cancelled = new Date(cancelledAt);
  const diff = (checkIn.getTime() - cancelled.getTime()) / (1000 * 60 * 60 * 24);
  return Math.floor(diff);
}

function getRefundPolicy(daysBefore: number) {
  if (daysBefore > 7) return { percent: 100, label: 'Full Refund', tier: 'full' as const };
  if (daysBefore >= 2) return { percent: 50, label: 'Partial Refund', tier: 'partial' as const };
  return { percent: 0, label: 'No Refund', tier: 'none' as const };
}

export default function AdminFinancials() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { settings, loading: settingsLoading } = usePlatformSettings();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('guests');

  // Mark as paid dialog
  const [payDialog, setPayDialog] = useState<{ bookingId: string; hostId: string; amount: number; hostName: string } | null>(null);
  const [payMethod, setPayMethod] = useState('bank_transfer');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [processing, setProcessing] = useState(false);

  const fetchPayouts = async () => {
    const { data } = await supabase.from('payouts' as any).select('*');
    if (data) setPayouts(data as any);
  };

  useEffect(() => {
    Promise.all([
      supabase.from('bookings').select('*'),
      supabase.from('profiles').select('*'),
      supabase.from('properties').select('*'),
      supabase.from('payouts' as any).select('*'),
    ]).then(([bRes, pRes, prRes, pyRes]) => {
      if (bRes.data) setBookings(bRes.data);
      if (pRes.data) setProfiles(pRes.data);
      if (prRes.data) setProperties(prRes.data);
      if (pyRes.data) setPayouts(pyRes.data as any);
      setIsLoading(false);
    });
  }, []);

  const markAsPaid = async () => {
    if (!payDialog || !user) return;
    setProcessing(true);
    try {
      const existing = payouts.find(p => p.booking_id === payDialog.bookingId);
      if (existing) {
        await supabase.from('payouts' as any).update({
          status: 'paid', paid_at: new Date().toISOString(),
          payment_method: payMethod, transaction_reference: payRef || null,
          notes: payNotes || null, processed_by: user.id,
        } as any).eq('id', existing.id);
      } else {
        await supabase.from('payouts' as any).insert({
          host_id: payDialog.hostId, booking_id: payDialog.bookingId,
          amount: payDialog.amount, status: 'paid', paid_at: new Date().toISOString(),
          payment_method: payMethod, transaction_reference: payRef || null,
          notes: payNotes || null, processed_by: user.id,
        } as any);
      }
      await logAdminAction('mark_payout_paid', 'payout', payDialog.bookingId, {
        host: payDialog.hostName, amount: payDialog.amount, method: payMethod, ref: payRef,
      });
      toast.success(`Payout of ${fmt(payDialog.amount)} marked as paid to ${payDialog.hostName}`);
      await fetchPayouts();
      setPayDialog(null);
      setPayMethod('bank_transfer');
      setPayRef('');
      setPayNotes('');
    } catch (e) {
      toast.error('Failed to process payout');
    }
    setProcessing(false);
  };

  const updatePayoutStatus = async (bookingId: string, hostId: string, amount: number, status: 'on_hold' | 'failed' | 'pending') => {
    if (!user) return;
    const existing = payouts.find(p => p.booking_id === bookingId);
    if (existing) {
      await supabase.from('payouts' as any).update({ status } as any).eq('id', existing.id);
    } else {
      await supabase.from('payouts' as any).insert({
        host_id: hostId, booking_id: bookingId, amount, status,
        processed_by: user.id,
      } as any);
    }
    await logAdminAction(`payout_${status}`, 'payout', bookingId, { status });
    toast.success(`Payout status updated to ${status}`);
    await fetchPayouts();
  };

  // ── Computed financial data ──
  const financials = useMemo(() => {
    if (!settings) return null;
    const completed = bookings.filter(b => b.status === 'completed');
    const confirmed = bookings.filter(b => b.status === 'confirmed');
    const active = [...completed, ...confirmed];

    const bookingDetails = active.map(b => {
      const prop = properties.find(p => p.id === b.property_id);
      const chargedTo = (prop?.service_fee_charged_to as 'guest' | 'host' | 'split') || 'guest';
      const fees = calculateFees(Number(b.subtotal), settings, chargedTo);
      const hostProfile = profiles.find(p => p.user_id === b.host_id);
      const guestProfile = profiles.find(p => p.user_id === b.guest_id);
      const payout = payouts.find(py => py.booking_id === b.id);
      return {
        booking: b, property: prop, fees,
        hostName: hostProfile?.full_name || hostProfile?.email || 'Unknown Host',
        guestName: guestProfile?.full_name || guestProfile?.email || 'Unknown Guest',
        cleaningFee: Number(b.cleaning_fee || 0),
        payoutRecord: payout || null,
      };
    });

    // GUEST aggregates
    const totalGuestSubtotals = bookingDetails.reduce((s, d) => s + d.fees.subtotal, 0);
    const totalGuestServiceFee = bookingDetails.reduce((s, d) => s + d.fees.guestServiceFee, 0);
    const totalGuestCleaningFee = bookingDetails.reduce((s, d) => s + d.cleaningFee, 0);
    const totalGuestPaid = totalGuestSubtotals + totalGuestServiceFee + totalGuestCleaningFee;

    // CANCELLATIONS
    const cancelledBookings = bookings.filter(b => b.status === 'cancelled');
    const cancellationDetails = cancelledBookings.map(b => {
      const guestProfile = profiles.find(p => p.user_id === b.guest_id);
      const prop = properties.find(p => p.id === b.property_id);
      const totalPaid = Number(b.total_price);
      const cancelledAt = b.updated_at || b.created_at;
      const daysBefore = getDaysBefore(b.check_in_date, cancelledAt);
      const policy = getRefundPolicy(daysBefore);
      const refundAmount = Number(b.refund_amount || 0) || (totalPaid * policy.percent / 100);
      const platformRetained = totalPaid - refundAmount;
      return {
        booking: b,
        guestName: guestProfile?.full_name || guestProfile?.email || 'Unknown',
        propertyTitle: prop?.title || '-',
        totalPaid, daysBefore, policy, refundAmount, platformRetained, cancelledAt,
      };
    });
    const totalRefundAmount = cancellationDetails.reduce((s, c) => s + c.refundAmount, 0);
    const totalRetainedFromCancellations = cancellationDetails.reduce((s, c) => s + c.platformRetained, 0);

    // HOST aggregates
    const hostMap = new Map<string, {
      name: string; hostId: string; totalPayout: number; totalHostFee: number;
      totalHostCommission: number; totalHostCommissionTax: number; bookingCount: number;
      totalSubtotal: number; totalCleaningFee: number; pendingPayout: number; pendingCount: number;
      completedPayout: number; completedCount: number;
      paidAmount: number; paidCount: number;
    }>();
    bookingDetails.forEach(d => {
      const existing = hostMap.get(d.booking.host_id) || {
        name: d.hostName, hostId: d.booking.host_id,
        totalPayout: 0, totalHostFee: 0, totalHostCommission: 0,
        totalHostCommissionTax: 0, bookingCount: 0, totalSubtotal: 0, totalCleaningFee: 0,
        pendingPayout: 0, pendingCount: 0, completedPayout: 0, completedCount: 0,
        paidAmount: 0, paidCount: 0,
      };
      const payout = d.fees.hostPayout + d.cleaningFee;
      existing.totalPayout += payout;
      existing.totalHostFee += d.fees.hostServiceFee;
      existing.totalHostCommission += d.fees.hostCommission;
      existing.totalHostCommissionTax += d.fees.hostCommissionTax;
      existing.totalSubtotal += d.fees.subtotal;
      existing.totalCleaningFee += d.cleaningFee;
      existing.bookingCount += 1;
      if (d.payoutRecord?.status === 'paid') {
        existing.paidAmount += payout;
        existing.paidCount += 1;
      } else if (d.booking.status === 'confirmed') {
        existing.pendingPayout += payout;
        existing.pendingCount += 1;
      } else {
        existing.completedPayout += payout;
        existing.completedCount += 1;
      }
      hostMap.set(d.booking.host_id, existing);
    });
    const hostBreakdowns = Array.from(hostMap.values()).sort((a, b) => b.totalPayout - a.totalPayout);
    const totalHostPayouts = hostBreakdowns.reduce((s, h) => s + h.totalPayout, 0);
    const totalHostServiceFee = bookingDetails.reduce((s, d) => s + d.fees.hostServiceFee, 0);
    const totalHostCommission = bookingDetails.reduce((s, d) => s + d.fees.hostCommission, 0);
    const totalHostCommissionTax = bookingDetails.reduce((s, d) => s + d.fees.hostCommissionTax, 0);
    const pendingPayouts = bookingDetails.filter(d => d.booking.status === 'confirmed')
      .reduce((s, d) => s + d.fees.hostPayout + d.cleaningFee, 0);
    const totalPaidOut = payouts.filter(p => p.status === 'paid').reduce((s, p) => s + Number(p.amount), 0);

    // PLATFORM aggregates
    const totalServiceTax = bookingDetails.reduce((s, d) => s + d.fees.serviceTax, 0);
    const totalServiceFeeNet = bookingDetails.reduce((s, d) => s + d.fees.serviceFeeTotal, 0);
    const platformGrossProfit = totalServiceFeeNet + totalHostCommission + totalRetainedFromCancellations;
    const platformTaxPayable = totalServiceTax + totalHostCommissionTax;
    const platformNetProfit = platformGrossProfit - platformTaxPayable;
    const platformRevenue = bookingDetails.reduce((s, d) => s + d.fees.platformRevenue, 0) + totalRetainedFromCancellations;

    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const thisMonthRev = bookingDetails
      .filter(d => d.booking.status === 'completed' && new Date(d.booking.created_at) >= thisMonthStart)
      .reduce((s, d) => s + d.fees.platformRevenue, 0);
    const lastMonthRev = bookingDetails
      .filter(d => d.booking.status === 'completed' && new Date(d.booking.created_at) >= lastMonthStart && new Date(d.booking.created_at) < thisMonthStart)
      .reduce((s, d) => s + d.fees.platformRevenue, 0);
    const growth = lastMonthRev > 0 ? Math.round(((thisMonthRev - lastMonthRev) / lastMonthRev) * 100) : 0;

    return {
      bookingDetails, totalGuestSubtotals, totalGuestServiceFee, totalGuestCleaningFee, totalGuestPaid,
      hostBreakdowns, totalHostPayouts, totalHostServiceFee, totalHostCommission, totalHostCommissionTax,
      totalServiceTax, totalServiceFeeNet,
      platformGrossProfit, platformTaxPayable, platformNetProfit, platformRevenue,
      pendingPayouts, totalPaidOut, thisMonthRev, lastMonthRev, growth,
      cancellationDetails, totalRefundAmount, totalRetainedFromCancellations,
      settings,
    };
  }, [bookings, properties, profiles, settings, payouts]);

  const exportCSV = (filename: string, rows: string[][]) => {
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  };

  if (isLoading || settingsLoading || !financials) {
    return <AdminLayout><div className="animate-pulse h-64 bg-muted rounded-xl" /></AdminLayout>;
  }

  const f = financials;

  const getPayoutStatus = (bookingId: string) => {
    const p = payouts.find(py => py.booking_id === bookingId);
    return p?.status || null;
  };

  const getPayoutBadge = (bookingId: string) => {
    const status = getPayoutStatus(bookingId);
    if (status === 'paid') return <Badge className="bg-green-500/10 text-green-600 border-green-500/30 text-xs">Paid</Badge>;
    if (status === 'on_hold') return <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30 text-xs">On Hold</Badge>;
    if (status === 'failed') return <Badge className="bg-destructive/10 text-destructive border-destructive/30 text-xs">Failed</Badge>;
    return <Badge variant="outline" className="text-xs">Unpaid</Badge>;
  };

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl font-bold">Financial Management</h1>
          <p className="text-muted-foreground text-sm">Comprehensive platform financial breakdown</p>
        </div>
        <Select value={activeSection} onValueChange={setActiveSection}>
          <SelectTrigger className="w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="guests"><span className="flex items-center gap-2"><Users className="w-4 h-4" /> Guest Financials</span></SelectItem>
            <SelectItem value="hosts"><span className="flex items-center gap-2"><Building2 className="w-4 h-4" /> Host Payouts</span></SelectItem>
            <SelectItem value="platform"><span className="flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Platform Financials</span></SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Top-level summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <Card className="card-luxury"><CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center"><CreditCard className="w-5 h-5 text-blue-500" /></div>
            <div><p className="text-xs text-muted-foreground">Total Guest Payments</p><p className="font-display text-xl font-bold">{fmt(f.totalGuestPaid)}</p></div>
          </div>
        </CardContent></Card>
        <Card className="card-luxury"><CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center"><Wallet className="w-5 h-5 text-orange-500" /></div>
            <div><p className="text-xs text-muted-foreground">Total Host Payouts</p><p className="font-display text-xl font-bold">{fmt(f.totalHostPayouts)}</p></div>
          </div>
        </CardContent></Card>
        <Card className="card-luxury"><CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center"><PiggyBank className="w-5 h-5 text-green-500" /></div>
            <div><p className="text-xs text-muted-foreground">Platform Net Profit</p><p className="font-display text-xl font-bold text-green-600">{fmt(f.platformNetProfit)}</p></div>
          </div>
        </CardContent></Card>
        <Card className="card-luxury"><CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-yellow-500/10 flex items-center justify-center"><Landmark className="w-5 h-5 text-yellow-500" /></div>
            <div><p className="text-xs text-muted-foreground">Tax Payable</p><p className="font-display text-xl font-bold text-yellow-600">{fmt(f.platformTaxPayable)}</p></div>
          </div>
        </CardContent></Card>
      </div>

      {/* ═══════════ GUEST FINANCIALS ═══════════ */}
      {activeSection === 'guests' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="card-luxury"><CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground">Accommodation Subtotals</p>
              <p className="font-display text-2xl font-bold">{fmt(f.totalGuestSubtotals)}</p>
            </CardContent></Card>
            <Card className="card-luxury"><CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground">Service Fees (Guests)</p>
              <p className="font-display text-2xl font-bold text-primary">{fmt(f.totalGuestServiceFee)}</p>
            </CardContent></Card>
            <Card className="card-luxury"><CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground">Cleaning Fees</p>
              <p className="font-display text-2xl font-bold">{fmt(f.totalGuestCleaningFee)}</p>
            </CardContent></Card>
          </div>

          <Card className="card-luxury">
            <CardContent className="p-6">
              <h3 className="font-display text-lg font-bold mb-4 flex items-center gap-2"><Receipt className="w-5 h-5" /> Guest Payment Breakdown</h3>
              <div className="space-y-2">
                <div className="flex justify-between py-2"><span className="text-sm text-muted-foreground">Accommodation Subtotal</span><span className="text-sm font-bold">{fmt(f.totalGuestSubtotals)}</span></div>
                <div className="flex justify-between py-2"><span className="text-sm text-muted-foreground">+ Cleaning Fees</span><span className="text-sm font-bold">{fmt(f.totalGuestCleaningFee)}</span></div>
                <Separator />
                <div className="flex justify-between py-2"><span className="text-sm text-muted-foreground">Service Fee ({f.settings.service_fee_percent}%)</span><span className="text-sm font-bold">{fmt(f.totalGuestServiceFee / (1 + f.settings.service_tax_percent / 100))}</span></div>
                <div className="flex justify-between py-2"><span className="text-sm text-muted-foreground">+ Service Tax ({f.settings.service_tax_percent}%)</span><span className="text-sm font-bold">{fmt(f.totalGuestServiceFee - f.totalGuestServiceFee / (1 + f.settings.service_tax_percent / 100))}</span></div>
                <Separator />
                <div className="flex justify-between py-2 bg-muted/50 rounded px-2"><span className="text-sm font-bold">Total Paid by Guests</span><span className="text-sm font-bold text-primary">{fmt(f.totalGuestPaid)}</span></div>
              </div>
            </CardContent>
          </Card>

          <Card className="card-luxury">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display text-lg font-bold flex items-center gap-2"><FileText className="w-5 h-5" /> Guest Payment Ledger</h3>
                <Button size="sm" variant="outline" onClick={() => {
                  const rows = [['Guest', 'Property', 'Subtotal', 'Service Fee', 'Cleaning', 'Total', 'Status']];
                  f.bookingDetails.forEach(d => rows.push([d.guestName, d.property?.title || '-', d.fees.subtotal.toFixed(2), d.fees.guestServiceFee.toFixed(2), d.cleaningFee.toFixed(2), (d.fees.guestTotal + d.cleaningFee).toFixed(2), d.booking.status]));
                  exportCSV('guest-financials.csv', rows);
                }}><Download className="w-4 h-4 mr-1" /> Export CSV</Button>
              </div>
              <div className="max-h-[400px] overflow-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Guest</TableHead><TableHead>Property</TableHead><TableHead className="text-right">Subtotal</TableHead><TableHead className="text-right">Service Fee</TableHead><TableHead className="text-right">Cleaning</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {f.bookingDetails.map(d => (
                      <TableRow key={d.booking.id}>
                        <TableCell className="font-medium text-sm">{d.guestName}</TableCell>
                        <TableCell className="text-sm max-w-[150px] truncate">{d.property?.title || '-'}</TableCell>
                        <TableCell className="text-right text-sm">{fmt(d.fees.subtotal)}</TableCell>
                        <TableCell className="text-right text-sm text-primary">{fmt(d.fees.guestServiceFee)}</TableCell>
                        <TableCell className="text-right text-sm">{fmt(d.cleaningFee)}</TableCell>
                        <TableCell className="text-right text-sm font-bold">{fmt(d.fees.guestTotal + d.cleaningFee)}</TableCell>
                        <TableCell><Badge variant={d.booking.status === 'completed' ? 'default' : 'secondary'} className="text-xs">{d.booking.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Cancellation & Refund Section */}
          <Card className="card-luxury">
            <CardContent className="p-6">
              <h3 className="font-display text-lg font-bold mb-4 flex items-center gap-2"><RotateCcw className="w-5 h-5" /> Cancellation & Refund Tracker</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="p-3 rounded-lg bg-muted/50 text-center"><p className="text-2xl font-bold">{f.cancellationDetails.length}</p><p className="text-xs text-muted-foreground">Total Cancellations</p></div>
                <div className="p-3 rounded-lg bg-green-500/10 text-center"><p className="text-2xl font-bold text-green-600">{fmt(f.totalRefundAmount)}</p><p className="text-xs text-muted-foreground">Total Refunded</p></div>
                <div className="p-3 rounded-lg bg-primary/10 text-center"><p className="text-2xl font-bold text-primary">{fmt(f.totalRetainedFromCancellations)}</p><p className="text-xs text-muted-foreground">Retained by Platform</p></div>
                <div className="p-3 rounded-lg bg-yellow-500/10 text-center"><p className="text-2xl font-bold text-yellow-600">{f.cancellationDetails.filter(c => c.policy.tier === 'partial').length}</p><p className="text-xs text-muted-foreground">Partial Refunds</p></div>
              </div>
              <div className="rounded-lg border border-border p-4 mb-6">
                <h4 className="text-sm font-bold mb-3">Refund Policy</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="p-2 rounded bg-green-500/5 border border-green-500/20 flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" /><div><p className="text-xs font-semibold text-green-600">100% Refund</p><p className="text-xs text-muted-foreground">Cancelled &gt;7 days before check-in</p></div></div>
                  <div className="p-2 rounded bg-yellow-500/5 border border-yellow-500/20 flex items-start gap-2"><AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5 shrink-0" /><div><p className="text-xs font-semibold text-yellow-600">50% Refund</p><p className="text-xs text-muted-foreground">Cancelled 2–7 days before check-in</p></div></div>
                  <div className="p-2 rounded bg-destructive/5 border border-destructive/20 flex items-start gap-2"><XCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" /><div><p className="text-xs font-semibold text-destructive">No Refund</p><p className="text-xs text-muted-foreground">Cancelled &lt;48 hours before check-in</p></div></div>
                </div>
              </div>
              {f.cancellationDetails.length > 0 && (
                <div className="max-h-[400px] overflow-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Guest</TableHead><TableHead>Property</TableHead><TableHead className="text-right">Total Paid</TableHead><TableHead className="text-center">Days Before</TableHead><TableHead className="text-center">Policy</TableHead><TableHead className="text-right">Refund</TableHead><TableHead className="text-right">Retained</TableHead><TableHead>Reason</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {f.cancellationDetails.map(c => (
                        <TableRow key={c.booking.id}>
                          <TableCell className="text-sm font-medium">{c.guestName}</TableCell>
                          <TableCell className="text-sm max-w-[120px] truncate">{c.propertyTitle}</TableCell>
                          <TableCell className="text-right text-sm">{fmt(c.totalPaid)}</TableCell>
                          <TableCell className="text-center text-sm"><Badge variant="outline" className="text-xs">{c.daysBefore}d</Badge></TableCell>
                          <TableCell className="text-center"><Badge className={c.policy.tier === 'full' ? 'bg-green-500/10 text-green-600 border-green-500/30' : c.policy.tier === 'partial' ? 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30' : 'bg-destructive/10 text-destructive border-destructive/30'}>{c.policy.percent}%</Badge></TableCell>
                          <TableCell className="text-right text-sm font-bold text-green-600">{fmt(c.refundAmount)}</TableCell>
                          <TableCell className="text-right text-sm font-bold text-primary">{fmt(c.platformRetained)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[150px] truncate">{c.booking.cancellation_reason || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ═══════════ HOST PAYOUTS ═══════════ */}
      {activeSection === 'hosts' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <Card className="card-luxury"><CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground">Total Due</p>
              <p className="font-display text-2xl font-bold">{fmt(f.totalHostPayouts)}</p>
            </CardContent></Card>
            <Card className="card-luxury"><CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-500" /><p className="text-xs text-muted-foreground">Paid Out</p></div>
              <p className="font-display text-2xl font-bold text-green-600">{fmt(f.totalPaidOut)}</p>
            </CardContent></Card>
            <Card className="card-luxury"><CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-yellow-500" /><p className="text-xs text-muted-foreground">Pending</p></div>
              <p className="font-display text-2xl font-bold text-yellow-600">{fmt(f.totalHostPayouts - f.totalPaidOut)}</p>
            </CardContent></Card>
            <Card className="card-luxury"><CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground">Commission Deducted</p>
              <p className="font-display text-2xl font-bold text-destructive">{fmt(f.totalHostCommission + f.totalHostCommissionTax)}</p>
            </CardContent></Card>
            <Card className="card-luxury"><CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground">Svc Fee Deducted</p>
              <p className="font-display text-2xl font-bold text-orange-500">{fmt(f.totalHostServiceFee)}</p>
            </CardContent></Card>
          </div>

          {/* Payout Formula */}
          <Card className="card-luxury">
            <CardContent className="p-6">
              <h3 className="font-display text-lg font-bold mb-4 flex items-center gap-2"><Wallet className="w-5 h-5" /> Host Payout Formula</h3>
              <div className="space-y-2">
                <div className="flex justify-between py-2"><span className="text-sm text-muted-foreground">Accommodation Subtotal</span><span className="text-sm font-bold">{fmt(f.totalGuestSubtotals)}</span></div>
                <div className="flex justify-between py-2"><span className="text-sm text-muted-foreground">+ Cleaning Fees</span><span className="text-sm font-bold">{fmt(f.totalGuestCleaningFee)}</span></div>
                <Separator />
                <div className="flex justify-between py-2 text-destructive"><span className="text-sm">− Commission ({f.settings.host_commission_percent}%)</span><span className="text-sm font-bold">-{fmt(f.totalHostCommission)}</span></div>
                <div className="flex justify-between py-2 text-destructive"><span className="text-sm">− Commission Tax ({f.settings.host_tax_percent}%)</span><span className="text-sm font-bold">-{fmt(f.totalHostCommissionTax)}</span></div>
                <div className="flex justify-between py-2 text-destructive"><span className="text-sm">− Service Fee (host portion)</span><span className="text-sm font-bold">-{fmt(f.totalHostServiceFee)}</span></div>
                <Separator />
                <div className="flex justify-between py-2 bg-muted/50 rounded px-2"><span className="text-sm font-bold">Net Payout to All Hosts</span><span className="text-sm font-bold text-green-600">{fmt(f.totalHostPayouts)}</span></div>
              </div>
            </CardContent>
          </Card>

          {/* Per-Host Summary */}
          <Card className="card-luxury">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display text-lg font-bold flex items-center gap-2"><FileText className="w-5 h-5" /> All Host Payments</h3>
                <Button size="sm" variant="outline" onClick={() => {
                  const rows = [['Host', 'Bookings', 'Gross', 'Commission', 'Comm Tax', 'Svc Fee', 'Net Payout', 'Paid', 'Unpaid']];
                  f.hostBreakdowns.forEach(h => rows.push([h.name, String(h.bookingCount), (h.totalSubtotal + h.totalCleaningFee).toFixed(2), h.totalHostCommission.toFixed(2), h.totalHostCommissionTax.toFixed(2), h.totalHostFee.toFixed(2), h.totalPayout.toFixed(2), h.paidAmount.toFixed(2), (h.totalPayout - h.paidAmount).toFixed(2)]));
                  exportCSV('host-payouts.csv', rows);
                }}><Download className="w-4 h-4 mr-1" /> Export CSV</Button>
              </div>
              <div className="max-h-[500px] overflow-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Host</TableHead><TableHead className="text-right">Bookings</TableHead><TableHead className="text-right">Gross</TableHead><TableHead className="text-right">Deductions</TableHead><TableHead className="text-right">Net Payout</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Unpaid</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {f.hostBreakdowns.map(h => (
                      <TableRow key={h.hostId}>
                        <TableCell className="font-medium text-sm">{h.name}</TableCell>
                        <TableCell className="text-right text-sm">{h.bookingCount}</TableCell>
                        <TableCell className="text-right text-sm">{fmt(h.totalSubtotal + h.totalCleaningFee)}</TableCell>
                        <TableCell className="text-right text-sm text-destructive">-{fmt(h.totalHostCommission + h.totalHostCommissionTax + h.totalHostFee)}</TableCell>
                        <TableCell className="text-right text-sm font-bold">{fmt(h.totalPayout)}</TableCell>
                        <TableCell className="text-right text-sm"><Badge className="bg-green-500/10 text-green-600 border-green-500/30 text-xs">{fmt(h.paidAmount)}</Badge></TableCell>
                        <TableCell className="text-right text-sm">{h.totalPayout - h.paidAmount > 0 ? <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30 text-xs">{fmt(h.totalPayout - h.paidAmount)}</Badge> : <span className="text-muted-foreground text-xs">—</span>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Payout Management - Per Booking */}
          <Card className="card-luxury">
            <CardContent className="p-6">
              <h3 className="font-display text-lg font-bold mb-2 flex items-center gap-2"><Send className="w-5 h-5" /> Payout Management</h3>
              <p className="text-sm text-muted-foreground mb-4">Mark individual booking payouts as paid, on hold, or failed. Each action is audit-logged.</p>
              <div className="max-h-[500px] overflow-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Host</TableHead><TableHead>Guest</TableHead><TableHead>Property</TableHead><TableHead>Dates</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-center">Booking</TableHead><TableHead className="text-center">Payout Status</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {f.bookingDetails.map(d => {
                      const payoutAmount = d.fees.hostPayout + d.cleaningFee;
                      const pStatus = getPayoutStatus(d.booking.id);
                      return (
                        <TableRow key={d.booking.id}>
                          <TableCell className="text-sm font-medium">{d.hostName}</TableCell>
                          <TableCell className="text-sm">{d.guestName}</TableCell>
                          <TableCell className="text-sm max-w-[100px] truncate">{d.property?.title || '-'}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{new Date(d.booking.check_in_date).toLocaleDateString()} – {new Date(d.booking.check_out_date).toLocaleDateString()}</TableCell>
                          <TableCell className="text-right text-sm font-bold">{fmt(payoutAmount)}</TableCell>
                          <TableCell className="text-center"><Badge variant={d.booking.status === 'completed' ? 'default' : 'secondary'} className="text-xs">{d.booking.status}</Badge></TableCell>
                          <TableCell className="text-center">{getPayoutBadge(d.booking.id)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {pStatus !== 'paid' && (
                                <Button size="sm" variant="default" className="h-7 text-xs px-2" onClick={() => setPayDialog({ bookingId: d.booking.id, hostId: d.booking.host_id, amount: payoutAmount, hostName: d.hostName })}>
                                  <CheckCircle2 className="w-3 h-3 mr-1" /> Pay
                                </Button>
                              )}
                              {pStatus !== 'on_hold' && pStatus !== 'paid' && (
                                <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => updatePayoutStatus(d.booking.id, d.booking.host_id, payoutAmount, 'on_hold')}>
                                  <Pause className="w-3 h-3 mr-1" /> Hold
                                </Button>
                              )}
                              {pStatus === 'on_hold' && (
                                <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => updatePayoutStatus(d.booking.id, d.booking.host_id, payoutAmount, 'pending')}>
                                  Resume
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Payment History */}
          {payouts.filter(p => p.status === 'paid').length > 0 && (
            <Card className="card-luxury">
              <CardContent className="p-6">
                <h3 className="font-display text-lg font-bold mb-4 flex items-center gap-2"><History className="w-5 h-5" /> Payment History</h3>
                <div className="max-h-[400px] overflow-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Host</TableHead><TableHead>Amount</TableHead><TableHead>Method</TableHead><TableHead>Reference</TableHead><TableHead>Notes</TableHead><TableHead>Paid At</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {payouts.filter(p => p.status === 'paid').sort((a, b) => new Date(b.paid_at || '').getTime() - new Date(a.paid_at || '').getTime()).map(p => {
                        const host = profiles.find(pr => pr.user_id === p.host_id);
                        return (
                          <TableRow key={p.id}>
                            <TableCell className="text-sm font-medium">{host?.full_name || host?.email || 'Unknown'}</TableCell>
                            <TableCell className="text-sm font-bold text-green-600">{fmt(Number(p.amount))}</TableCell>
                            <TableCell className="text-sm capitalize">{p.payment_method?.replace('_', ' ') || '-'}</TableCell>
                            <TableCell className="text-sm text-muted-foreground font-mono text-xs">{p.transaction_reference || '-'}</TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-[150px] truncate">{p.notes || '-'}</TableCell>
                            <TableCell className="text-sm">{p.paid_at ? new Date(p.paid_at).toLocaleString() : '-'}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ═══════════ PLATFORM FINANCIALS ═══════════ */}
      {activeSection === 'platform' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="card-luxury"><CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground">Service Fee Revenue</p>
              <p className="font-display text-2xl font-bold text-primary">{fmt(f.totalServiceFeeNet)}</p>
            </CardContent></Card>
            <Card className="card-luxury"><CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground">Host Commission</p>
              <p className="font-display text-2xl font-bold text-primary">{fmt(f.totalHostCommission)}</p>
            </CardContent></Card>
            <Card className="card-luxury"><CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground">Cancellation Revenue</p>
              <p className="font-display text-2xl font-bold text-primary">{fmt(f.totalRetainedFromCancellations)}</p>
            </CardContent></Card>
            <Card className="card-luxury"><CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-xs text-muted-foreground">Monthly Growth</p>
                {f.growth >= 0 ? <ArrowUpRight className="w-3 h-3 text-green-500" /> : <ArrowDownRight className="w-3 h-3 text-destructive" />}
              </div>
              <p className={`font-display text-2xl font-bold ${f.growth >= 0 ? 'text-green-600' : 'text-destructive'}`}>{f.growth}%</p>
            </CardContent></Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="card-luxury">
              <CardContent className="p-6">
                <h3 className="font-display text-lg font-bold mb-4 flex items-center gap-2"><PiggyBank className="w-5 h-5" /> Profit & Loss</h3>
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Revenue</p>
                  <div className="flex justify-between py-1.5"><span className="text-sm text-muted-foreground">Guest Service Fees</span><span className="text-sm font-bold">{fmt(f.totalGuestServiceFee)}</span></div>
                  <div className="flex justify-between py-1.5"><span className="text-sm text-muted-foreground">Host Service Fees</span><span className="text-sm font-bold">{fmt(f.totalHostServiceFee)}</span></div>
                  <div className="flex justify-between py-1.5"><span className="text-sm text-muted-foreground">Host Commission</span><span className="text-sm font-bold">{fmt(f.totalHostCommission)}</span></div>
                  <div className="flex justify-between py-1.5"><span className="text-sm text-muted-foreground">Cancellation Retained</span><span className="text-sm font-bold">{fmt(f.totalRetainedFromCancellations)}</span></div>
                  <Separator />
                  <div className="flex justify-between py-1.5"><span className="text-sm font-bold">Gross Profit</span><span className="text-sm font-bold">{fmt(f.platformGrossProfit)}</span></div>
                  <Separator />
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-2">Tax Liabilities</p>
                  <div className="flex justify-between py-1.5 text-yellow-600"><span className="text-sm">Service Tax ({f.settings.service_tax_percent}%)</span><span className="text-sm font-bold">-{fmt(f.totalServiceTax)}</span></div>
                  <div className="flex justify-between py-1.5 text-yellow-600"><span className="text-sm">Commission Tax ({f.settings.host_tax_percent}%)</span><span className="text-sm font-bold">-{fmt(f.totalHostCommissionTax)}</span></div>
                  <Separator />
                  <div className="flex justify-between py-2 bg-green-500/10 rounded px-2"><span className="text-sm font-bold">Net Profit</span><span className="text-sm font-bold text-green-600">{fmt(f.platformNetProfit)}</span></div>
                </div>
              </CardContent>
            </Card>

            <Card className="card-luxury">
              <CardContent className="p-6">
                <h3 className="font-display text-lg font-bold mb-4 flex items-center gap-2"><Landmark className="w-5 h-5" /> Cash Flow</h3>
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Inflows</p>
                  <div className="flex justify-between py-1.5"><span className="text-sm text-muted-foreground">Guest Payments</span><span className="text-sm font-bold text-green-600">{fmt(f.totalGuestPaid)}</span></div>
                  <div className="flex justify-between py-1.5"><span className="text-sm text-muted-foreground">Cancellation Retained</span><span className="text-sm font-bold text-green-600">{fmt(f.totalRetainedFromCancellations)}</span></div>
                  <Separator />
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-2">Outflows</p>
                  <div className="flex justify-between py-1.5"><span className="text-sm text-muted-foreground">Paid to Hosts</span><span className="text-sm font-bold text-destructive">-{fmt(f.totalPaidOut)}</span></div>
                  <div className="flex justify-between py-1.5"><span className="text-sm text-muted-foreground">Pending Payouts</span><span className="text-sm font-bold text-yellow-600">-{fmt(f.totalHostPayouts - f.totalPaidOut)}</span></div>
                  <div className="flex justify-between py-1.5"><span className="text-sm text-muted-foreground">Refunds Issued</span><span className="text-sm font-bold text-destructive">-{fmt(f.totalRefundAmount)}</span></div>
                  <div className="flex justify-between py-1.5"><span className="text-sm text-muted-foreground">Tax Payable</span><span className="text-sm font-bold text-yellow-600">-{fmt(f.platformTaxPayable)}</span></div>
                  <Separator />
                  <div className="flex justify-between py-2 bg-muted/50 rounded px-2"><span className="text-sm font-bold">Net Cash Position</span><span className="text-sm font-bold">{fmt(f.totalGuestPaid + f.totalRetainedFromCancellations - f.totalPaidOut - (f.totalHostPayouts - f.totalPaidOut) - f.platformTaxPayable - f.totalRefundAmount)}</span></div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="card-luxury">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display text-lg font-bold flex items-center gap-2"><DollarSign className="w-5 h-5" /> Active Fee Configuration</h3>
                <Button size="sm" variant="outline" onClick={() => {
                  const rows = [['Metric', 'Value'], ['Service Fee %', String(f.settings.service_fee_percent)], ['Service Tax %', String(f.settings.service_tax_percent)], ['Host Commission %', String(f.settings.host_commission_percent)], ['Host Tax %', String(f.settings.host_tax_percent)], ['Gross Profit', f.platformGrossProfit.toFixed(2)], ['Tax Payable', f.platformTaxPayable.toFixed(2)], ['Net Profit', f.platformNetProfit.toFixed(2)]];
                  exportCSV('platform-financials.csv', rows);
                }}><Download className="w-4 h-4 mr-1" /> Export</Button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-3 rounded-lg bg-muted/50 text-center"><p className="text-2xl font-bold text-primary">{f.settings.service_fee_percent}%</p><p className="text-xs text-muted-foreground">Service Fee</p></div>
                <div className="p-3 rounded-lg bg-muted/50 text-center"><p className="text-2xl font-bold text-yellow-600">{f.settings.service_tax_percent}%</p><p className="text-xs text-muted-foreground">Service Tax</p></div>
                <div className="p-3 rounded-lg bg-muted/50 text-center"><p className="text-2xl font-bold text-primary">{f.settings.host_commission_percent}%</p><p className="text-xs text-muted-foreground">Host Commission</p></div>
                <div className="p-3 rounded-lg bg-muted/50 text-center"><p className="text-2xl font-bold text-yellow-600">{f.settings.host_tax_percent}%</p><p className="text-xs text-muted-foreground">Host Tax</p></div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Mark as Paid Dialog */}
      <Dialog open={!!payDialog} onOpenChange={() => setPayDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Payout as Paid</DialogTitle>
          </DialogHeader>
          {payDialog && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-sm"><strong>Host:</strong> {payDialog.hostName}</p>
                <p className="text-sm"><strong>Amount:</strong> <span className="text-green-600 font-bold">{fmt(payDialog.amount)}</span></p>
              </div>
              <div className="space-y-2">
                <Label>Payment Method</Label>
                <Select value={payMethod} onValueChange={setPayMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    <SelectItem value="paypal">PayPal</SelectItem>
                    <SelectItem value="stripe">Stripe</SelectItem>
                    <SelectItem value="check">Check</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Transaction Reference (optional)</Label>
                <Input placeholder="e.g. TXN-2026-04-001" value={payRef} onChange={e => setPayRef(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Textarea placeholder="Any additional notes..." value={payNotes} onChange={e => setPayNotes(e.target.value)} rows={2} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDialog(null)}>Cancel</Button>
            <Button onClick={markAsPaid} disabled={processing}>{processing ? 'Processing...' : 'Confirm Payment'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
