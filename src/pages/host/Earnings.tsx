import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Layout } from '@/components/layout/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { usePlatformSettings, calculateFees } from '@/hooks/usePlatformSettings';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import {
  TrendingUp, ArrowUpRight, ArrowDownRight,
  Check, Link2, AlertCircle, Receipt,
  Download, FileText, BarChart3, MinusCircle, Award,
  Wallet, Clock, Sparkles, Filter, ArrowUpDown, ChevronUp, ChevronDown,
  Info, CheckCircle2, CalendarDays, Shield, Settings as SettingsIcon, History,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useHostDeductions } from '@/hooks/useHostDeductions';
import { usePayoutTiers } from '@/hooks/usePayoutTiers';
import { determineTier, TIER_LABELS, tierProgress, RELEASE_MODES, PAYOUT_METHODS } from '@/lib/payouts/tiers';
import { Switch } from '@/components/ui/switch';
import { EarningsPdfSettingsDialog, type PdfExportOptions, DEFAULT_PDF_OPTIONS } from '@/components/host/EarningsPdfSettingsDialog';
import { PdfCoverPreviewDialog } from '@/components/host/PdfCoverPreviewDialog';

export default function HostEarnings() {
  const { user, isHost, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { toast } = useToast();
  const { settings: platformSettings } = usePlatformSettings();
  const { pending: pendingDeductions, totalPending: pendingDeductionsTotal, history: settledDeductions } = useHostDeductions();
  const { config: tierConfig } = usePayoutTiers();
  const [earnings, setEarnings] = useState({
    totalEarnings: 0,
    thisMonth: 0,
    lastMonth: 0,
    pendingPayout: 0,
    completedBookings: 0,
    confirmedBookings: 0,
    cancelledAmount: 0,
    serviceFees: 0,
    netEarnings: 0,
  });
  const [breakdown, setBreakdown] = useState({
    grossRevenue: 0,
    totalServiceFee: 0,
    totalCommission: 0,
    totalCommissionTax: 0,
    totalCleaningFees: 0,
    totalDeductions: 0,
    takeHome: 0,
    pendingGross: 0,
    pendingTakeHome: 0,
  });
  const [recentBookings, setRecentBookings] = useState<any[]>([]);
  const [allBookings, setAllBookings] = useState<any[]>([]);
  const [monthlyData, setMonthlyData] = useState<{ month: string; gross: number; deductions: number; takeHome: number }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [paypalEmail, setPaypalEmail] = useState('');
  const [isSavingPaypal, setIsSavingPaypal] = useState(false);
  const [showPaypalInput, setShowPaypalInput] = useState(false);
  // Payout method settings (moved here from /host/payout-settings)
  const [payoutMethod, setPayoutMethod] = useState<keyof typeof PAYOUT_METHODS>('bank_swift');
  const [accountReference, setAccountReference] = useState('');
  const [longStayInstallments, setLongStayInstallments] = useState(true);
  const [savingPayout, setSavingPayout] = useState(false);
  const [installments, setInstallments] = useState<any[]>([]);
  // Enriched deduction info (booking + property)
  const [deductionDetails, setDeductionDetails] = useState<Record<string, { propertyTitle?: string; propertyId?: string; checkIn?: string; checkOut?: string; bookingStatus?: string }>>({});
  // History filters & sorting
  const [dateRange, setDateRange] = useState<'all' | '7d' | '30d' | '90d' | 'ytd'>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [payoutFilter, setPayoutFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<'date' | 'nights' | 'payout' | 'status'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const [penaltiesPreviewOpen, setPenaltiesPreviewOpen] = useState(false);
  const [upcomingPreviewOpen, setUpcomingPreviewOpen] = useState(false);

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    if (!isHost) { navigate('/become-host'); return; }
    import('@/hooks/useHostModeGuard').then(m => m.setHostMode('host'));
    fetchEarnings();
    fetchPayoutConfig();
  }, [user, isHost, navigate, platformSettings]);

  useEffect(() => {
    if (profile) {
      setPaypalEmail((profile as any).paypal_email || '');
    }
  }, [profile]);

  // Enrich pending deductions with booking + property info
  useEffect(() => {
    const ids = pendingDeductions.map(d => d.booking_id).filter(Boolean) as string[];
    if (ids.length === 0) { setDeductionDetails({}); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('bookings')
        .select('id, status, check_in_date, check_out_date, property_id, properties(id, title)')
        .in('id', ids);
      if (cancelled || !data) return;
      const map: Record<string, any> = {};
      for (const b of data as any[]) {
        map[b.id] = {
          propertyTitle: b.properties?.title,
          propertyId: b.property_id,
          checkIn: b.check_in_date,
          checkOut: b.check_out_date,
          bookingStatus: b.status,
        };
      }
      setDeductionDetails(map);
    })();
    return () => { cancelled = true; };
  }, [pendingDeductions]);

  const fetchEarnings = async () => {
    if (!user || !platformSettings) return;
    setIsLoading(true);

    const { data: bookings } = await supabase
      .from('bookings')
      .select('*, properties(service_fee_charged_to, cleaning_fee)')
      .eq('host_id', user.id)
      .order('created_at', { ascending: false });

    if (bookings) {
      const now = new Date();
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

      const completed = bookings.filter(b => b.status === 'completed');
      const confirmed = bookings.filter(b => b.status === 'confirmed');
      const cancelled = bookings.filter(b => b.status === 'cancelled');

      const calcForBookings = (list: typeof bookings) => {
        let grossRevenue = 0;
        let totalServiceFee = 0;
        let totalCommission = 0;
        let totalCommissionTax = 0;
        let totalCleaningFees = 0;

        for (const b of list) {
          const subtotal = Number(b.nightly_rate) * b.num_nights;
          const cleaningFee = Number(b.cleaning_fee || 0);
          const chargedTo = ((b as any).properties?.service_fee_charged_to || 'guest') as 'guest' | 'host' | 'split';
          const fees = calculateFees(subtotal, platformSettings, chargedTo);

          grossRevenue += subtotal;
          totalServiceFee += fees.hostServiceFee;
          totalCommission += fees.hostCommission;
          totalCommissionTax += fees.hostCommissionTax;
          totalCleaningFees += cleaningFee;
        }

        const totalDeductions = totalServiceFee + totalCommission + totalCommissionTax;
        const takeHome = grossRevenue + totalCleaningFees - totalDeductions;

        return { grossRevenue, totalServiceFee, totalCommission, totalCommissionTax, totalCleaningFees, totalDeductions, takeHome };
      };

      const completedCalc = calcForBookings(completed);
      const confirmedCalc = calcForBookings(confirmed);

      const totalEarnings = completedCalc.grossRevenue;
      const thisMonth = completed
        .filter(b => new Date(b.created_at) >= thisMonthStart)
        .reduce((s, b) => s + Number(b.nightly_rate) * b.num_nights, 0);
      const lastMonth = completed
        .filter(b => new Date(b.created_at) >= lastMonthStart && new Date(b.created_at) < thisMonthStart)
        .reduce((s, b) => s + Number(b.nightly_rate) * b.num_nights, 0);
      const cancelledAmount = cancelled.reduce((s, b) => s + Number(b.total_price), 0);

      setEarnings({
        totalEarnings,
        thisMonth,
        lastMonth,
        pendingPayout: confirmedCalc.takeHome,
        completedBookings: completed.length,
        confirmedBookings: confirmed.length,
        cancelledAmount,
        serviceFees: completedCalc.totalDeductions,
        netEarnings: completedCalc.takeHome,
      });

      setBreakdown({
        grossRevenue: completedCalc.grossRevenue,
        totalServiceFee: completedCalc.totalServiceFee,
        totalCommission: completedCalc.totalCommission,
        totalCommissionTax: completedCalc.totalCommissionTax,
        totalCleaningFees: completedCalc.totalCleaningFees,
        totalDeductions: completedCalc.totalDeductions,
        takeHome: completedCalc.takeHome,
        pendingGross: confirmedCalc.grossRevenue,
        pendingTakeHome: confirmedCalc.takeHome,
      });

      setRecentBookings(bookings.slice(0, 10));
      setAllBookings(bookings);

      const chartNow = new Date();
      const monthly: { month: string; gross: number; deductions: number; takeHome: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const mDate = subMonths(chartNow, i);
        const mStart = startOfMonth(mDate);
        const mEnd = endOfMonth(mDate);
        const mBookings = completed.filter(b => {
          const d = new Date(b.created_at);
          return d >= mStart && d <= mEnd;
        });
        const mCalc = calcForBookings(mBookings);
        monthly.push({
          month: format(mDate, 'MMM'),
          gross: Math.round(mCalc.grossRevenue * 100) / 100,
          deductions: Math.round(mCalc.totalDeductions * 100) / 100,
          takeHome: Math.round(mCalc.takeHome * 100) / 100,
        });
      }
      setMonthlyData(monthly);
    }
    setIsLoading(false);
  };

  const savePaypalEmail = async () => {
    if (!user || !paypalEmail.trim()) return;
    setIsSavingPaypal(true);
    const { error } = await supabase
      .from('profiles')
      .update({ paypal_email: paypalEmail.trim() } as any)
      .eq('user_id', user.id);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'PayPal linked!', description: 'Your PayPal account has been saved for payouts.' });
      setShowPaypalInput(false);
      await refreshProfile();
    }
    setIsSavingPaypal(false);
  };

  const fetchPayoutConfig = async () => {
    if (!user) return;
    const [{ data: existing }, { data: instData }] = await Promise.all([
      supabase.from('host_payout_settings' as any).select('*').eq('host_id', user.id).maybeSingle(),
      supabase.from('payout_installments' as any).select('*').eq('host_id', user.id).order('scheduled_release_date', { ascending: true }),
    ]);
    if (existing) {
      const e = existing as any;
      setPayoutMethod((e.payout_method as keyof typeof PAYOUT_METHODS) || 'bank_swift');
      setLongStayInstallments(!!e.long_stay_installments_enabled);
      setAccountReference(e.payout_account?.account_reference || '');
    } else {
      await supabase.from('host_payout_settings' as any).insert({ host_id: user.id } as any);
    }
    setInstallments((instData as any[]) || []);
  };

  const savePayoutMethod = async () => {
    if (!user) return;
    setSavingPayout(true);
    const { error } = await supabase
      .from('host_payout_settings' as any)
      .update({
        payout_method: payoutMethod,
        long_stay_installments_enabled: longStayInstallments,
        payout_account: { account_reference: accountReference, method: payoutMethod },
      } as any)
      .eq('host_id', user.id);
    setSavingPayout(false);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Payout method saved', description: 'Changes apply to your next payout.' });
    }
  };

  const growthPercent = earnings.lastMonth > 0
    ? Math.round(((earnings.thisMonth - earnings.lastMonth) / earnings.lastMonth) * 100)
    : earnings.thisMonth > 0 ? 100 : 0;

  const isPaypalLinked = !!(profile as any)?.paypal_email;

  const tierInfo = determineTier(
    { completed_bookings: earnings.completedBookings, avg_rating: 0, response_rate: 100, cancellation_rate: 0 },
    tierConfig
  );
  const tierProg = tierProgress(
    { completed_bookings: earnings.completedBookings, avg_rating: 0, response_rate: 100, cancellation_rate: 0 },
    tierConfig
  );

  const exportCSV = () => {
    const rows = [
      ['Booking ID', 'Check-in', 'Check-out', 'Nights', 'Nightly Rate', 'Subtotal', 'Cleaning Fee', 'Service Fee', 'Commission', 'Commission Tax', 'Take Home', 'Status'],
      ...allBookings.map(b => {
        const subtotal = Number(b.nightly_rate) * b.num_nights;
        const cleaning = Number(b.cleaning_fee || 0);
        const chargedTo = ((b as any).properties?.service_fee_charged_to || 'guest') as 'guest' | 'host' | 'split';
        const fees = platformSettings ? calculateFees(subtotal, platformSettings, chargedTo) : { hostServiceFee: 0, hostCommission: 0, hostCommissionTax: 0, hostPayout: subtotal };
        const takeHome = fees.hostPayout + cleaning;
        return [
          b.id.slice(0, 8), b.check_in_date, b.check_out_date, b.num_nights,
          `$${Number(b.nightly_rate).toFixed(2)}`, `$${subtotal.toFixed(2)}`, `$${cleaning.toFixed(2)}`,
          `$${fees.hostServiceFee.toFixed(2)}`, `$${fees.hostCommission.toFixed(2)}`, `$${fees.hostCommissionTax.toFixed(2)}`,
          `$${takeHome.toFixed(2)}`, b.status,
        ];
      }),
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hostly-earnings-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'CSV exported!', description: 'Your earnings report has been downloaded.' });
  };

  // Apply PDF export filter to allBookings.
  const filterBookingsForPdf = (opts: PdfExportOptions) => {
    let list = [...allBookings];
    if (opts.statusFilter !== 'all') {
      list = list.filter((b) => b.status === opts.statusFilter);
    }
    let from: Date | null = null;
    let to: Date | null = null;
    const now = new Date();
    if (opts.dateRange === '30d') from = new Date(now.getTime() - 30 * 86400000);
    else if (opts.dateRange === '90d') from = new Date(now.getTime() - 90 * 86400000);
    else if (opts.dateRange === 'ytd') from = new Date(now.getFullYear(), 0, 1);
    else if (opts.dateRange === 'custom') {
      from = opts.customStart ? new Date(opts.customStart) : null;
      // Include the entire end day (set to 23:59:59.999) so same-day check-ins are kept.
      if (opts.customEnd) {
        to = new Date(opts.customEnd);
        to.setHours(23, 59, 59, 999);
      } else {
        to = null;
      }
    }
    if (from || to) {
      list = list.filter((b) => {
        const ci = new Date(b.check_in_date);
        if (from && ci < from) return false;
        if (to && ci > to) return false;
        return true;
      });
    }
    return list;
  };

  const exportPDF = async (opts: PdfExportOptions = { ...DEFAULT_PDF_OPTIONS, fileName: `hostly-earnings-${format(new Date(), 'yyyy-MM-dd')}` }) => {
    try {
      const [{ default: jsPDF }, autoTableModule] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ]);
      const autoTable = (autoTableModule as any).default || (autoTableModule as any);

      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 40;
      const today = format(new Date(), 'MMMM d, yyyy');
      const filteredBookings = filterBookingsForPdf(opts);

      // Brand colours
      const brandRgb: [number, number, number] = [255, 56, 92];   // #FF385C
      const dangerRgb: [number, number, number] = [193, 18, 31];  // #C1121F
      const mutedRgb: [number, number, number] = [102, 102, 102];

      const money = (n: number) =>
        `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      // Helper: ensure enough vertical room before drawing a section title; otherwise add page.
      const ensureSpace = (yRef: { y: number }, needed: number) => {
        if (yRef.y + needed > pageHeight - 60) {
          doc.addPage();
          yRef.y = 60;
        }
      };

      // ── Header ────────────────────────────────────────────────
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.setTextColor(17, 17, 17);
      doc.text('Earnings Report', margin, 60);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(...mutedRgb);
      doc.text(`Generated ${today}`, margin, 78);
      if (profile?.full_name) {
        doc.text(`Host: ${profile.full_name}`, margin, 92);
      }
      // Filter summary line (so the reader knows what is in the report)
      const filterBits: string[] = [];
      if (opts.statusFilter !== 'all') filterBits.push(`Status: ${opts.statusFilter}`);
      if (opts.dateRange !== 'all') {
        if (opts.dateRange === 'custom') {
          filterBits.push(`Range: ${opts.customStart || '…'} → ${opts.customEnd || '…'}`);
        } else {
          filterBits.push(`Range: ${opts.dateRange.toUpperCase()}`);
        }
      }
      if (filterBits.length > 0) {
        doc.text(`Filters: ${filterBits.join(' · ')}`, margin, 106);
      }

      // Brand stripe
      doc.setFillColor(...brandRgb);
      doc.rect(0, 0, pageWidth, 6, 'F');

      // ── Summary cards (3 columns) ─────────────────────────────
      const cardY = filterBits.length > 0 ? 124 : 110;
      const cardH = 64;
      const gap = 12;
      const cardW = (pageWidth - margin * 2 - gap * 2) / 3;
      const cards: Array<{ label: string; value: string; brand?: boolean }> = [
        { label: 'Gross revenue', value: money(breakdown.grossRevenue) },
        { label: 'Total deductions', value: `-${money(breakdown.totalDeductions)}` },
        { label: 'Take home', value: money(breakdown.takeHome), brand: true },
      ];
      cards.forEach((c, i) => {
        const x = margin + i * (cardW + gap);
        if (c.brand) {
          doc.setFillColor(255, 245, 247);
          doc.setDrawColor(...brandRgb);
        } else {
          doc.setFillColor(249, 249, 249);
          doc.setDrawColor(224, 224, 224);
        }
        doc.roundedRect(x, cardY, cardW, cardH, 6, 6, 'FD');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(...mutedRgb);
        doc.text(c.label.toUpperCase(), x + 12, cardY + 20);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.setTextColor(c.brand ? brandRgb[0] : 17, c.brand ? brandRgb[1] : 17, c.brand ? brandRgb[2] : 17);
        doc.text(c.value, x + 12, cardY + 46);
      });

      const cur = { y: cardY + cardH + 28 };

      // ── Earnings breakdown table ─────────────────────────────
      if (opts.includeBreakdown) {
        ensureSpace(cur, 80);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(17, 17, 17);
        doc.text('Earnings breakdown', margin, cur.y);

        const breakdownRows: any[] = [
        ['Gross booking revenue (completed)', money(breakdown.grossRevenue)],
        ];
        if (breakdown.totalCleaningFees > 0) {
          breakdownRows.push(['Cleaning fees collected', money(breakdown.totalCleaningFees)]);
        }
        if (breakdown.totalServiceFee > 0) {
          breakdownRows.push([
            { content: 'Service fee (host portion)', styles: { textColor: dangerRgb } },
            { content: `-${money(breakdown.totalServiceFee)}`, styles: { textColor: dangerRgb, halign: 'right' } },
          ]);
        }
        breakdownRows.push([
          { content: `Platform commission (${platformSettings?.host_commission_percent ?? 0}%)`, styles: { textColor: dangerRgb } },
          { content: `-${money(breakdown.totalCommission)}`, styles: { textColor: dangerRgb, halign: 'right' } },
        ]);
        breakdownRows.push([
          { content: `Commission tax (${platformSettings?.host_tax_percent ?? 0}%)`, styles: { textColor: dangerRgb } },
          { content: `-${money(breakdown.totalCommissionTax)}`, styles: { textColor: dangerRgb, halign: 'right' } },
        ]);
        breakdownRows.push([
          { content: 'Total deductions', styles: { fontStyle: 'bold', fillColor: [255, 240, 243], textColor: dangerRgb } },
          { content: `-${money(breakdown.totalDeductions)}`, styles: { fontStyle: 'bold', fillColor: [255, 240, 243], textColor: dangerRgb, halign: 'right' } },
        ]);
        breakdownRows.push([
          { content: 'Your take home', styles: { fontStyle: 'bold', fillColor: [255, 245, 247], textColor: brandRgb, fontSize: 12 } },
          { content: money(breakdown.takeHome), styles: { fontStyle: 'bold', fillColor: [255, 245, 247], textColor: brandRgb, fontSize: 12, halign: 'right' } },
        ]);

        autoTable(doc, {
          startY: cur.y + 10,
          margin: { left: margin, right: margin, bottom: 50 },
          body: breakdownRows,
          theme: 'grid',
          rowPageBreak: 'avoid',
          styles: { fontSize: 10, cellPadding: 8, textColor: [60, 60, 60], lineColor: [240, 240, 240], overflow: 'linebreak' },
          columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 140, halign: 'right' } },
        });
        cur.y = (doc as any).lastAutoTable.finalY + 28;
      }

      // ── Payouts summary ──────────────────────────────────────
      if (opts.includePayoutsSummary) {
        ensureSpace(cur, 130);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(17, 17, 17);
        doc.text('Payouts summary', margin, cur.y);

        // Compute summary numbers from filtered bookings + upcoming releases
        const cancelledZero = filteredBookings.filter((b) => {
          if (b.status !== 'cancelled') return false;
          const totalPrice = Number(b.total_price || 0);
          const refunded = Number(b.refund_amount || 0);
          return refunded >= totalPrice || totalPrice - refunded <= 0;
        }).length;
        const next7 = upcomingReleases.filter((i) => i.releaseDate.getTime() - Date.now() < 7 * 86400000);
        const next7Total = next7.reduce((s, i) => s + i.amount, 0);
        const nextRelease = upcomingReleases[0];

        const summaryRows: any[] = [
          ['Currently available balance', money(earnings.pendingPayout)],
          ['Scheduled in next 7 days', `${money(next7Total)}  (${next7.length} payout${next7.length === 1 ? '' : 's'})`],
          ['Total scheduled (all upcoming)', `${money(upcomingTotal)}  (${upcomingReleases.length} payout${upcomingReleases.length === 1 ? '' : 's'})`],
          ['Next payout date', nextRelease ? format(nextRelease.releaseDate, 'EEE, MMM d, yyyy') : '—'],
          ['Pending penalty deductions', `-${money(pendingDeductionsTotal)}  (${pendingDeductions.length} item${pendingDeductions.length === 1 ? '' : 's'})`],
          [
            { content: 'Cancelled bookings · $0 take-home', styles: { textColor: mutedRgb } },
            { content: `${cancelledZero} booking${cancelledZero === 1 ? '' : 's'}`, styles: { halign: 'right', textColor: mutedRgb } },
          ],
        ];

        autoTable(doc, {
          startY: cur.y + 10,
          margin: { left: margin, right: margin, bottom: 50 },
          body: summaryRows,
          theme: 'grid',
          rowPageBreak: 'avoid',
          styles: { fontSize: 10, cellPadding: 8, textColor: [60, 60, 60], lineColor: [240, 240, 240], overflow: 'linebreak' },
          columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 200, halign: 'right' } },
        });
        cur.y = (doc as any).lastAutoTable.finalY + 28;
      }

      // ── Pending penalty deductions ───────────────────────────
      if (opts.includePenalties && pendingDeductions.length > 0) {
        ensureSpace(cur, 80);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(17, 17, 17);
        doc.text('Pending penalty deductions', margin, cur.y);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(...mutedRgb);
        doc.text(
          `Total to deduct: -${money(pendingDeductionsTotal)} · Auto-applied to next payout`,
          margin, cur.y + 14,
        );

        const penaltyBody = pendingDeductions.map((d) => {
          const detail = d.booking_id ? deductionDetails[d.booking_id] : undefined;
          const reason = d.reason_code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
          const detailLine = [
            d.reason_detail,
            detail?.propertyTitle ? `Listing: ${detail.propertyTitle}` : null,
            d.booking_id ? `Booking #${d.booking_id.slice(0, 8)}` : null,
            detail?.checkIn && detail?.checkOut
              ? `${format(new Date(detail.checkIn), 'MMM d')} – ${format(new Date(detail.checkOut), 'MMM d, yyyy')}`
              : null,
          ].filter(Boolean).join(' · ');
          return [
            reason,
            detailLine || '—',
            { content: `-${money(Number(d.amount))}`, styles: { halign: 'right', textColor: dangerRgb, fontStyle: 'bold' } },
          ];
        });

        autoTable(doc, {
          startY: cur.y + 22,
          margin: { left: margin, right: margin, bottom: 50 },
          head: [['Reason', 'Details', 'Amount']],
          body: penaltyBody,
          theme: 'striped',
          rowPageBreak: 'avoid',
          headStyles: { fillColor: [255, 240, 243], textColor: dangerRgb, fontSize: 9, halign: 'left' },
          styles: { fontSize: 9, cellPadding: 6, textColor: [60, 60, 60], overflow: 'linebreak', valign: 'top' },
          columnStyles: { 0: { cellWidth: 110 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 90, halign: 'right' } },
        });
        cur.y = (doc as any).lastAutoTable.finalY + 28;
      }

      // ── Bookings table ────────────────────────────────────────
      if (opts.includeBookings && filteredBookings.length > 0) {
        ensureSpace(cur, 80);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(17, 17, 17);
        doc.text(`Bookings (${filteredBookings.length})`, margin, cur.y);

        const bookingsBody = filteredBookings.map((b) => {
        const subtotal = Number(b.nightly_rate) * b.num_nights;
        const cleaning = Number(b.cleaning_fee || 0);
        const chargedTo = ((b as any).properties?.service_fee_charged_to || 'guest') as 'guest' | 'host' | 'split';
        const fees = platformSettings
          ? calculateFees(subtotal, platformSettings, chargedTo)
          : { hostServiceFee: 0, hostCommission: 0, hostCommissionTax: 0, hostPayout: subtotal };
        let takeHome = fees.hostPayout + cleaning;
        let statusLabel = b.status;
        if (b.status === 'cancelled') {
          const totalPrice = Number(b.total_price || 0);
          const refunded = Number(b.refund_amount || 0);
          const kept = Math.max(0, totalPrice - refunded);
          if (kept <= 0 || refunded >= totalPrice) {
            takeHome = 0;
            statusLabel = 'cancelled';
          } else {
            takeHome = Math.round(takeHome * (kept / totalPrice) * 100) / 100;
          }
        }
        const totalDed = fees.hostServiceFee + fees.hostCommission + fees.hostCommissionTax;
        const propertyTitle = (b as any).properties?.title || '—';
        return [
          { content: `#${b.id.slice(0, 8)}\n${propertyTitle}`, styles: { fontSize: 8 } as any },
          `${b.check_in_date} – ${b.check_out_date}`,
          String(b.num_nights),
          money(subtotal),
          `-${money(totalDed)}`,
          {
            content: money(takeHome),
            styles: {
              fontStyle: 'bold',
              textColor: takeHome === 0 ? mutedRgb : [17, 17, 17],
              halign: 'right',
            } as any,
          },
          statusLabel,
        ];
        });

        autoTable(doc, {
          startY: cur.y + 10,
          margin: { left: margin, right: margin, bottom: 50 },
          head: [['Booking / Listing', 'Dates', 'Nights', 'Subtotal', 'Deductions', 'Take home', 'Status']],
          body: bookingsBody,
          theme: 'striped',
          rowPageBreak: 'avoid',
          headStyles: { fillColor: brandRgb, textColor: 255, fontSize: 9 },
          styles: { fontSize: 8.5, cellPadding: 5, textColor: [60, 60, 60], overflow: 'linebreak', valign: 'top' },
          columnStyles: {
            0: { cellWidth: 120 },
            1: { cellWidth: 'auto' },
            2: { halign: 'right', cellWidth: 36 },
            3: { halign: 'right', cellWidth: 60 },
            4: { halign: 'right', cellWidth: 60, textColor: dangerRgb },
            5: { halign: 'right', cellWidth: 60 },
            6: { cellWidth: 56 },
          },
        });
      } else if (opts.includeBookings) {
        ensureSpace(cur, 60);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(...mutedRgb);
        doc.text('No bookings match the selected filter.', margin, cur.y + 10);
      }

      // ── Footer with page numbers ─────────────────────────────
      const pageCount = (doc as any).internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...mutedRgb);
        const footerY = doc.internal.pageSize.getHeight() - 20;
        doc.text('Hostiva · Earnings Report', margin, footerY);
        doc.text(
          `Page ${i} of ${pageCount}`,
          pageWidth - margin,
          footerY,
          { align: 'right' },
        );
      }

      doc.save(`${opts.fileName}.pdf`);
      toast({ title: 'PDF downloaded!', description: `Saved as ${opts.fileName}.pdf` });
    } catch (err: any) {
      console.error('PDF export failed:', err);
      toast({
        title: 'PDF export failed',
        description: err?.message || 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  // ── Penalty deductions: CSV + PDF export ────────────────────────────────
  const formatReason = (code: string) =>
    code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const exportPenaltiesCSV = () => {
    if (pendingDeductions.length === 0) {
      toast({ title: 'No pending deductions', description: 'Nothing to export right now.' });
      return;
    }
    const rows = [
      ['Reason', 'Detail', 'Listing', 'Booking ID', 'Check-in', 'Check-out', 'Logged', 'Amount', 'Currency', 'Status'],
      ...pendingDeductions.map((d) => {
        const detail = d.booking_id ? deductionDetails[d.booking_id] : undefined;
        return [
          formatReason(d.reason_code),
          d.reason_detail || '',
          detail?.propertyTitle || '',
          d.booking_id ? d.booking_id.slice(0, 8) : '',
          detail?.checkIn || '',
          detail?.checkOut || '',
          format(new Date(d.created_at), 'yyyy-MM-dd'),
          `-${Number(d.amount).toFixed(2)}`,
          d.currency,
          d.status,
        ];
      }),
      [],
      ['', '', '', '', '', '', 'TOTAL', `-${pendingDeductionsTotal.toFixed(2)}`, '', ''],
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hostly-pending-penalties-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'CSV exported!', description: `${pendingDeductions.length} pending penalty record(s) downloaded.` });
  };

  // ── Shared cover-page renderer ─────────────────────────────────────────
  // Draws a polished standalone cover sheet (totals, payout method, host info,
  // generation metadata) and adds a fresh page so subsequent content starts clean.
  const drawCoverPage = (
    doc: any,
    opts: {
      title: string;
      subtitle: string;
      accent: [number, number, number];
      muted: [number, number, number];
      totalLabel: string;
      totalValue: string;
      totalIsNegative?: boolean;
      stats: Array<{ label: string; value: string }>;
      methodLabel?: string;
      methodTime?: string;
      methodAccount?: string;
      footnote?: string;
    }
  ) => {
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 40;

    // Top brand stripe
    doc.setFillColor(...opts.accent);
    doc.rect(0, 0, pageWidth, 6, 'F');

    // Tiny brand mark
    doc.setFillColor(...opts.accent);
    doc.circle(margin + 8, 56, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text('H', margin + 8, 60, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(17, 17, 17);
    doc.text('Hostiva', margin + 22, 60);

    // Doc kind label (top-right)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...opts.muted);
    doc.text('OFFICIAL REPORT', pageWidth - margin, 60, { align: 'right' });

    // Title block (vertically centred-ish)
    const titleY = pageHeight * 0.28;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(...opts.muted);
    doc.text(opts.subtitle.toUpperCase(), margin, titleY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(28);
    doc.setTextColor(17, 17, 17);
    doc.text(opts.title, margin, titleY + 32);
    // accent underline
    doc.setDrawColor(...opts.accent);
    doc.setLineWidth(2);
    doc.line(margin, titleY + 44, margin + 60, titleY + 44);

    // Hero total card
    const cardX = margin;
    const cardY = titleY + 70;
    const cardW = pageWidth - margin * 2;
    const cardH = 90;
    doc.setFillColor(opts.accent[0], opts.accent[1], opts.accent[2]);
    doc.roundedRect(cardX, cardY, cardW, cardH, 10, 10, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text(opts.totalLabel.toUpperCase(), cardX + 20, cardY + 28);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(34);
    doc.text(opts.totalValue, cardX + 20, cardY + 66);
    if (opts.footnote) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(255, 255, 255);
      doc.text(opts.footnote, cardX + cardW - 20, cardY + cardH - 14, { align: 'right' });
    }

    // Stats grid (2 columns)
    const statsStart = cardY + cardH + 30;
    const colW = (cardW - 16) / 2;
    opts.stats.forEach((s, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = cardX + col * (colW + 16);
      const y = statsStart + row * 56;
      doc.setDrawColor(232, 232, 232);
      doc.setFillColor(250, 250, 250);
      doc.roundedRect(x, y, colW, 46, 6, 6, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...opts.muted);
      doc.text(s.label.toUpperCase(), x + 12, y + 16);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(17, 17, 17);
      doc.text(s.value, x + 12, y + 36);
    });

    // Payout method panel (if provided)
    let panelBottom = statsStart + Math.ceil(opts.stats.length / 2) * 56;
    if (opts.methodLabel) {
      const panelY = panelBottom + 14;
      const panelH = 62;
      doc.setDrawColor(...opts.accent);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(cardX, panelY, cardW, panelH, 8, 8, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...opts.muted);
      doc.text('PAYOUT METHOD', cardX + 14, panelY + 16);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(17, 17, 17);
      doc.text(opts.methodLabel, cardX + 14, panelY + 36);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...opts.muted);
      const sub = [opts.methodTime, opts.methodAccount].filter(Boolean).join(' · ');
      if (sub) doc.text(sub, cardX + 14, panelY + 52);
      panelBottom = panelY + panelH;
    }

    // Footer block — generated metadata + host info
    const footerY = pageHeight - 90;
    doc.setDrawColor(232, 232, 232);
    doc.setLineWidth(0.5);
    doc.line(margin, footerY, pageWidth - margin, footerY);

    const generated = format(new Date(), "MMMM d, yyyy 'at' h:mm a");
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const left: string[] = ['GENERATED FOR', profile?.full_name || profile?.email || 'Host'];
    if (profile?.email) left.push(profile.email);
    const right: string[] = ['DOCUMENT INFO', generated, `Timezone: ${tz}`];

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...opts.muted);
    doc.text(left[0], margin, footerY + 16);
    doc.text(right[0], pageWidth - margin, footerY + 16, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(17, 17, 17);
    doc.text(left[1], margin, footerY + 32);
    doc.text(right[1], pageWidth - margin, footerY + 32, { align: 'right' });

    doc.setFontSize(9);
    doc.setTextColor(...opts.muted);
    if (left[2]) doc.text(left[2], margin, footerY + 46);
    doc.text(right[2], pageWidth - margin, footerY + 46, { align: 'right' });

    // bottom brand stripe
    doc.setFillColor(...opts.accent);
    doc.rect(0, pageHeight - 6, pageWidth, 6, 'F');

    // Move to next page so callers start clean
    doc.addPage();
  };

  const exportPenaltiesPDF = async () => {
    if (pendingDeductions.length === 0) {
      toast({ title: 'No pending deductions', description: 'Nothing to export right now.' });
      return;
    }
    try {
      const [{ default: jsPDF }, autoTableModule] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ]);
      const autoTable = (autoTableModule as any).default || (autoTableModule as any);
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 40;
      const dangerRgb: [number, number, number] = [193, 18, 31];
      const mutedRgb: [number, number, number] = [102, 102, 102];
      const money = (n: number) =>
        `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      // ── Cover page ──────────────────────────────────────────
      const reasonsCount = new Set(pendingDeductions.map((d) => d.reason_code)).size;
      const bookingsCount = new Set(pendingDeductions.map((d) => d.booking_id).filter(Boolean)).size;
      const oldest = pendingDeductions.reduce<Date | null>((a, d) => {
        const t = new Date(d.created_at);
        return !a || t < a ? t : a;
      }, null);
      drawCoverPage(doc, {
        title: 'Pending Penalty Deductions',
        subtitle: 'Hostiva · Penalty Statement',
        accent: dangerRgb,
        muted: mutedRgb,
        totalLabel: 'Total to deduct',
        totalValue: `-${money(pendingDeductionsTotal)}`,
        footnote: 'Auto-applied to your next payout',
        stats: [
          { label: 'Pending items', value: String(pendingDeductions.length) },
          { label: 'Distinct reasons', value: String(reasonsCount) },
          { label: 'Affected bookings', value: String(bookingsCount) },
          { label: 'Oldest entry', value: oldest ? format(oldest, 'MMM d, yyyy') : '—' },
        ],
        methodLabel: PAYOUT_METHODS[payoutMethod].label,
        methodTime: PAYOUT_METHODS[payoutMethod].time,
        methodAccount: accountReference || undefined,
      });

      // ── Detail page header ──────────────────────────────────
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(17, 17, 17);
      doc.text('Penalty details', margin, 60);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...mutedRgb);
      doc.text(`${pendingDeductions.length} item${pendingDeductions.length === 1 ? '' : 's'} · Total -${money(pendingDeductionsTotal)}`, margin, 76);

      const body = pendingDeductions.map((d) => {
        const detail = d.booking_id ? deductionDetails[d.booking_id] : undefined;
        const ctx = [
          detail?.propertyTitle ? `Listing: ${detail.propertyTitle}` : null,
          d.booking_id ? `Booking #${d.booking_id.slice(0, 8)}` : null,
          detail?.checkIn && detail?.checkOut
            ? `${format(new Date(detail.checkIn), 'MMM d')} – ${format(new Date(detail.checkOut), 'MMM d, yyyy')}`
            : null,
          d.reason_detail || null,
        ].filter(Boolean).join(' · ');
        return [
          formatReason(d.reason_code),
          ctx || '—',
          format(new Date(d.created_at), 'MMM d, yyyy'),
          { content: `-${money(Number(d.amount))}`, styles: { halign: 'right', textColor: dangerRgb, fontStyle: 'bold' } },
        ];
      });

      autoTable(doc, {
        startY: 96,
        margin: { left: margin, right: margin, bottom: 50 },
        head: [['Reason', 'Details', 'Logged', 'Amount']],
        body,
        theme: 'striped',
        rowPageBreak: 'avoid',
        headStyles: { fillColor: [255, 240, 243], textColor: dangerRgb, fontSize: 9 },
        styles: { fontSize: 9, cellPadding: 6, textColor: [60, 60, 60], overflow: 'linebreak', valign: 'top' },
        columnStyles: { 2: { cellWidth: 80 }, 3: { cellWidth: 80, halign: 'right' } },
      });

      doc.save(`hostly-pending-penalties-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
      toast({ title: 'PDF downloaded!', description: 'Pending penalties report saved.' });
    } catch (err: any) {
      toast({ title: 'PDF export failed', description: err?.message || 'Please try again.', variant: 'destructive' });
    }
  };

  // ── Settled deduction history exports ───────────────────────────────────
  const settledTotal = settledDeductions.reduce((s, d) => s + Number(d.amount || 0), 0);

  const exportSettledCSV = () => {
    if (settledDeductions.length === 0) {
      toast({ title: 'No history yet', description: 'Settled deductions will appear here.' });
      return;
    }
    const rows = [
      ['Reason', 'Detail', 'Booking ID', 'Logged', 'Settled', 'Status', 'Amount', 'Currency'],
      ...settledDeductions.map((d) => [
        formatReason(d.reason_code),
        d.reason_detail || '',
        d.booking_id ? d.booking_id.slice(0, 8) : '',
        format(new Date(d.created_at), 'yyyy-MM-dd'),
        (d as any).settled_at ? format(new Date((d as any).settled_at), 'yyyy-MM-dd') : '',
        d.status,
        `-${Number(d.amount).toFixed(2)}`,
        d.currency,
      ]),
      [],
      ['', '', '', '', '', 'TOTAL', `-${settledTotal.toFixed(2)}`, ''],
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hostly-deduction-history-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'CSV exported!', description: `${settledDeductions.length} settled deduction(s) downloaded.` });
  };

  // ── Upcoming payouts: PDF + Excel export ───────────────────────────────
  const exportUpcomingPDF = async () => {
    if (upcomingReleases.length === 0) {
      toast({ title: 'No upcoming payouts', description: 'Nothing scheduled right now.' });
      return;
    }
    try {
      const [{ default: jsPDF }, autoTableModule] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ]);
      const autoTable = (autoTableModule as any).default || (autoTableModule as any);
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 40;
      const brandRgb: [number, number, number] = [255, 56, 92];
      const mutedRgb: [number, number, number] = [102, 102, 102];
      const money = (n: number) =>
        `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      // ── Cover page ──────────────────────────────────────────
      const next7 = upcomingReleases.filter((i) => i.releaseDate.getTime() - Date.now() < 7 * 86400000);
      const next7Total = next7.reduce((s, i) => s + i.amount, 0);
      const installmentCount = upcomingReleases.filter((i) => i.source === 'installment').length;
      const nextDate = upcomingReleases[0]?.releaseDate;
      const lastDate = upcomingReleases[upcomingReleases.length - 1]?.releaseDate;

      drawCoverPage(doc, {
        title: 'Upcoming Payout Schedule',
        subtitle: 'Hostiva · Payout Forecast',
        accent: brandRgb,
        muted: mutedRgb,
        totalLabel: 'Total scheduled',
        totalValue: money(upcomingTotal),
        footnote: `${upcomingReleases.length} payout${upcomingReleases.length === 1 ? '' : 's'} on the way`,
        stats: [
          { label: 'Next 7 days', value: `${money(next7Total)} · ${next7.length}` },
          { label: 'Installments', value: String(installmentCount) },
          { label: 'Next release', value: nextDate ? format(nextDate, 'MMM d, yyyy') : '—' },
          { label: 'Last release', value: lastDate ? format(lastDate, 'MMM d, yyyy') : '—' },
        ],
        methodLabel: PAYOUT_METHODS[payoutMethod].label,
        methodTime: PAYOUT_METHODS[payoutMethod].time,
        methodAccount: accountReference || undefined,
      });

      // ── Detail page header ──────────────────────────────────
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(17, 17, 17);
      doc.text('Payout schedule', margin, 60);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...mutedRgb);
      doc.text(`${upcomingReleases.length} release${upcomingReleases.length === 1 ? '' : 's'} · Total ${money(upcomingTotal)}`, margin, 76);

      const body = upcomingReleases.map((i) => [
        format(i.releaseDate, 'EEE, MMM d, yyyy'),
        `#${i.bookingId.slice(0, 8)}`,
        i.source === 'installment'
          ? `Installment ${(i as any).installmentNumber}/${(i as any).totalInstallments}`
          : (i.isLongStay ? 'Long stay' : 'Standard'),
        String(i.nights),
        { content: money(i.amount), styles: { halign: 'right', fontStyle: 'bold' } },
      ]);

      autoTable(doc, {
        startY: 96,
        margin: { left: margin, right: margin, bottom: 50 },
        head: [['Release date', 'Booking', 'Type', 'Nights', 'Amount']],
        body,
        theme: 'striped',
        rowPageBreak: 'avoid',
        headStyles: { fillColor: brandRgb, textColor: 255, fontSize: 9 },
        styles: { fontSize: 9, cellPadding: 6, textColor: [60, 60, 60], overflow: 'linebreak', valign: 'top' },
        columnStyles: { 3: { halign: 'right', cellWidth: 50 }, 4: { halign: 'right', cellWidth: 90 } },
      });

      doc.save(`hostly-upcoming-payouts-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
      toast({ title: 'PDF downloaded!', description: 'Upcoming payouts report saved.' });
    } catch (err: any) {
      toast({ title: 'PDF export failed', description: err?.message || 'Please try again.', variant: 'destructive' });
    }
  };

  const exportUpcomingExcel = async () => {
    if (upcomingReleases.length === 0) {
      toast({ title: 'No upcoming payouts', description: 'Nothing scheduled right now.' });
      return;
    }
    try {
      const XLSX = await import('xlsx');
      const data: any[] = upcomingReleases.map((i) => ({
        'Release date': format(i.releaseDate, 'yyyy-MM-dd'),
        'Day': format(i.releaseDate, 'EEE'),
        'Booking ID': i.bookingId.slice(0, 8),
        'Type': i.source === 'installment'
          ? `Installment ${(i as any).installmentNumber}/${(i as any).totalInstallments}`
          : (i.isLongStay ? 'Long stay' : 'Standard'),
        'Nights': i.nights,
        'Amount (USD)': Number(i.amount.toFixed(2)),
        'Method': PAYOUT_METHODS[payoutMethod].label,
      }));
      data.push({
        'Release date': '', 'Day': '', 'Booking ID': '', 'Type': 'TOTAL',
        'Nights': '', 'Amount (USD)': Number(upcomingTotal.toFixed(2)), 'Method': '',
      });
      const ws = XLSX.utils.json_to_sheet(data);
      ws['!cols'] = [{ wch: 14 }, { wch: 6 }, { wch: 12 }, { wch: 24 }, { wch: 8 }, { wch: 14 }, { wch: 22 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Upcoming Payouts');
      XLSX.writeFile(wb, `hostly-upcoming-payouts-${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
      toast({ title: 'Excel downloaded!', description: 'Upcoming payouts spreadsheet saved.' });
    } catch (err: any) {
      toast({ title: 'Excel export failed', description: err?.message || 'Please try again.', variant: 'destructive' });
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-6 py-12 max-w-6xl">
          <div className="animate-pulse space-y-8">
            <div className="h-10 bg-muted rounded-lg w-1/3" />
            <div className="h-48 bg-muted rounded-3xl" />
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => <div key={i} className="h-32 bg-muted rounded-2xl" />)}
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  const tierPct = tierProg ? Math.min(100, (tierProg.current / tierProg.bandEnd) * 100) : 0;

  // ─── Filters & sorting for transactions table ──────────────────────────────
  const computeRow = (b: any) => {
    const subtotal = Number(b.nightly_rate) * b.num_nights;
    const cleaning = Number(b.cleaning_fee || 0);
    const chargedTo = (b.properties?.service_fee_charged_to || 'guest') as 'guest' | 'host' | 'split';
    const fees = platformSettings ? calculateFees(subtotal, platformSettings, chargedTo) : null;
    let payout = fees ? fees.hostPayout + cleaning : Number(b.total_price);
    // For cancelled bookings, the real take-home is what the host actually keeps
    // after any refund issued to the guest. If refund_amount equals total_price
    // (full refund), the host keeps nothing → take-home = $0.
    if (b.status === 'cancelled') {
      const totalPrice = Number(b.total_price || 0);
      const refunded = Number(b.refund_amount || 0);
      const kept = Math.max(0, totalPrice - refunded);
      if (kept <= 0 || refunded >= totalPrice) {
        payout = 0;
      } else {
        // Apply same fee proportions to the kept portion as a best-effort estimate
        const ratio = totalPrice > 0 ? kept / totalPrice : 0;
        payout = Math.round(payout * ratio * 100) / 100;
      }
    }
    const payoutStatus =
      b.status === 'completed' ? 'paid' :
      b.status === 'confirmed' ? 'scheduled' :
      b.status === 'cancelled' ? 'cancelled' : 'pending';
    return { subtotal, cleaning, fees, payout, payoutStatus };
  };

  const filteredBookings = (() => {
    const now = new Date();
    const cutoff =
      dateRange === '7d' ? new Date(now.getTime() - 7 * 86400000) :
      dateRange === '30d' ? new Date(now.getTime() - 30 * 86400000) :
      dateRange === '90d' ? new Date(now.getTime() - 90 * 86400000) :
      dateRange === 'ytd' ? new Date(now.getFullYear(), 0, 1) : null;

    return allBookings
      .filter((b) => {
        if (cutoff && new Date(b.created_at) < cutoff) return false;
        if (statusFilter !== 'all' && b.status !== statusFilter) return false;
        if (payoutFilter !== 'all') {
          const r = computeRow(b);
          if (r.payoutStatus !== payoutFilter) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const dir = sortDir === 'asc' ? 1 : -1;
        if (sortKey === 'date') {
          return (new Date(a.check_in_date).getTime() - new Date(b.check_in_date).getTime()) * dir;
        }
        if (sortKey === 'nights') return (a.num_nights - b.num_nights) * dir;
        if (sortKey === 'payout') return (computeRow(a).payout - computeRow(b).payout) * dir;
        if (sortKey === 'status') return a.status.localeCompare(b.status) * dir;
        return 0;
      });
  })();

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const exportFilteredCSV = () => {
    const rows = [
      ['Booking ID', 'Check-in', 'Check-out', 'Nights', 'Subtotal', 'Cleaning', 'Service Fee', 'Commission', 'Tax', 'Take Home', 'Status', 'Payout Status'],
      ...filteredBookings.map(b => {
        const r = computeRow(b);
        const fees = r.fees || { hostServiceFee: 0, hostCommission: 0, hostCommissionTax: 0 };
        return [
          b.id.slice(0, 8), b.check_in_date, b.check_out_date, b.num_nights,
          `$${r.subtotal.toFixed(2)}`, `$${r.cleaning.toFixed(2)}`,
          `$${fees.hostServiceFee.toFixed(2)}`, `$${fees.hostCommission.toFixed(2)}`, `$${fees.hostCommissionTax.toFixed(2)}`,
          `$${r.payout.toFixed(2)}`, b.status, r.payoutStatus,
        ];
      }),
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hostly-payout-history-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Exported!', description: `${filteredBookings.length} record${filteredBookings.length === 1 ? '' : 's'} downloaded.` });
  };

  const sortIcon = (key: typeof sortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  // ─── Upcoming payout schedule ──────────────────────────────────────────────
  // For each confirmed booking, payout releases 24h after check-in (Standard mode).
  const upcomingReleases = (() => {
    const today = new Date();
    const items: any[] = allBookings
      .filter((b) => b.status === 'confirmed')
      .map((b) => {
        const r = computeRow(b);
        const releaseDate = new Date(new Date(b.check_in_date).getTime() + 24 * 60 * 60 * 1000);
        return {
          id: b.id,
          bookingId: b.id,
          releaseDate,
          amount: r.payout,
          nights: b.num_nights,
          checkIn: b.check_in_date,
          isLongStay: b.num_nights >= 28,
          source: 'booking',
        };
      });
    // Add scheduled installments
    installments
      .filter((i) => i.status !== 'released')
      .forEach((i) => {
        items.push({
          id: i.id,
          bookingId: i.booking_id,
          releaseDate: new Date(i.scheduled_release_date),
          amount: Number(i.amount),
          nights: i.nights_covered,
          checkIn: i.scheduled_release_date,
          isLongStay: true,
          source: 'installment',
          installmentNumber: i.installment_number,
          totalInstallments: i.total_installments,
        });
      });
    return items
      .filter((i) => i.releaseDate >= today)
      .sort((a, b) => a.releaseDate.getTime() - b.releaseDate.getTime());
  })();

  const upcomingTotal = upcomingReleases.reduce((s, i) => s + i.amount, 0);
  const next7days = upcomingReleases.filter((i) => i.releaseDate.getTime() - Date.now() < 7 * 86400000);

  return (
    <Layout>
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-6 py-10 max-w-6xl">
          {/* Header — Airbnb-style: large heading, plain typography, actions on the right */}
          <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-10 pb-8 border-b">
            <div>
              <h1 className="text-3xl md:text-4xl font-semibold text-foreground tracking-tight">
                Earnings
              </h1>
              <p className="mt-2 text-base text-muted-foreground">
                Track every payout, fee and trend across your hosting business.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" className="rounded-full gap-2 h-10 px-4" onClick={exportCSV}>
                <Download className="w-4 h-4" /> CSV
              </Button>
              <Button variant="outline" className="rounded-full gap-2 h-10 px-4" onClick={() => setPdfDialogOpen(true)}>
                <FileText className="w-4 h-4" /> PDF
              </Button>
            </div>
          </header>

          {/* Payout summary — at-a-glance cards */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
            {/* Current available balance */}
            <Card className="rounded-2xl border shadow-none overflow-hidden">
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                    <Wallet className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Current balance</p>
                    <p className="text-[11px] text-muted-foreground">Ready for next payout</p>
                  </div>
                </div>
                <p className="text-3xl font-semibold text-foreground tabular-nums">
                  ${(breakdown.pendingTakeHome - pendingDeductionsTotal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </CardContent>
            </Card>

            {/* Upcoming payouts */}
            <Card className="rounded-2xl border shadow-none overflow-hidden">
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-9 h-9 rounded-xl bg-sky-500/10 flex items-center justify-center">
                    <Clock className="w-4 h-4 text-sky-600" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Upcoming payouts</p>
                    <p className="text-[11px] text-muted-foreground">{earnings.confirmedBookings} confirmed booking{earnings.confirmedBookings === 1 ? '' : 's'}</p>
                  </div>
                </div>
                <p className="text-3xl font-semibold text-foreground tabular-nums">
                  ${breakdown.pendingTakeHome.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Released 24h after each check-in
                </p>
              </CardContent>
            </Card>

            {/* Commission tier */}
            <Card className="rounded-2xl border shadow-none overflow-hidden">
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Award className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Commission tier</p>
                    <p className="text-[11px] text-muted-foreground">{TIER_LABELS[tierInfo.tier]}</p>
                  </div>
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-3xl font-semibold text-foreground tabular-nums">{tierInfo.commission_pct}%</p>
                  <p className="text-sm text-muted-foreground">on {earnings.completedBookings} stays</p>
                </div>
                {tierProg ? (
                  <div className="mt-3">
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${tierPct}%` }} />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      {tierProg.remaining} more stay{tierProg.remaining === 1 ? '' : 's'} to next tier
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-emerald-600 mt-2 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Standard tier reached
                  </p>
                )}
              </CardContent>
            </Card>
          </section>

          {/* Hero: lifetime take-home + 4 stat tiles */}
          <section className="mb-12">
            <div className="rounded-3xl bg-gradient-to-br from-primary/8 via-card to-card border p-8 md:p-10 shadow-sm">
              <div className="grid lg:grid-cols-12 gap-8 items-end">
                <div className="lg:col-span-7">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    Lifetime take-home
                  </p>
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <span className="text-5xl md:text-6xl font-semibold text-foreground tracking-tight tabular-nums">
                      ${breakdown.takeHome.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <Badge variant="secondary" className="rounded-full bg-primary/10 text-primary border-0 font-medium">
                      <Award className="w-3 h-3 mr-1" />
                      {TIER_LABELS[tierInfo.tier]} · {tierInfo.commission_pct}% commission
                    </Badge>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    From {earnings.completedBookings} completed stay{earnings.completedBookings === 1 ? '' : 's'} · after platform service, commission & tax.
                  </p>

                  {/* Tier progress */}
                  {tierProg && (
                    <div className="mt-7 max-w-md">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-foreground">
                          {tierProg.current} / {tierProg.bandEnd} bookings
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {tierProg.remaining} more to next tier
                        </span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${tierPct}%` }}
                        />
                      </div>
                      <button
                        onClick={() => navigate('/host/payout-settings')}
                        className="mt-3 text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
                      >
                        Manage payout settings <ArrowUpRight className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Stat tiles — clean 2x2 */}
                <div className="lg:col-span-5 grid grid-cols-2 gap-3">
                  <div className="bg-card rounded-2xl p-5 border">
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">Gross revenue</p>
                    <p className="text-2xl font-semibold text-foreground tabular-nums">
                      ${breakdown.grossRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                  <div className="bg-card rounded-2xl p-5 border">
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">Deductions</p>
                    <p className="text-2xl font-semibold text-destructive tabular-nums">
                      −${breakdown.totalDeductions.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                  <div className="bg-card rounded-2xl p-5 border">
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">This month</p>
                    <p className="text-2xl font-semibold text-foreground tabular-nums">
                      ${earnings.thisMonth.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </p>
                    <span className={`text-[11px] font-medium inline-flex items-center gap-0.5 mt-1 ${growthPercent >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                      {growthPercent >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      {Math.abs(growthPercent)}% vs last
                    </span>
                  </div>
                  <div className="bg-card rounded-2xl p-5 border">
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">Pending</p>
                    {(() => {
                      const net = breakdown.pendingTakeHome - pendingDeductionsTotal;
                      return (
                        <p className={`text-2xl font-semibold tabular-nums ${net < 0 ? 'text-destructive' : 'text-foreground'}`}>
                          {net < 0 ? '−' : ''}${Math.abs(net).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </p>
                      );
                    })()}
                    <span className="text-[11px] text-muted-foreground mt-1 block">
                      {earnings.confirmedBookings} confirmed
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Commission Tier Timeline */}
          {/* Penalty deductions — what will be subtracted from next payout */}
          {pendingDeductions.length > 0 && (
            <Card className="rounded-2xl border-destructive/20 shadow-none mb-6 overflow-hidden">
              <CardContent className="p-7">
                <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
                      <MinusCircle className="w-5 h-5 text-destructive" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-foreground">
                        Pending penalty deductions
                      </h2>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        These amounts will be automatically subtracted from your next payout.
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total to deduct</p>
                    <p className="text-2xl font-semibold tabular-nums text-destructive">
                      −${pendingDeductionsTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <div className="flex items-center gap-1.5 mt-2 justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full h-7 px-2.5 text-[11px] gap-1"
                        onClick={exportPenaltiesCSV}
                      >
                        <Download className="w-3 h-3" /> CSV
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full h-7 px-2.5 text-[11px] gap-1"
                        onClick={() => setPenaltiesPreviewOpen(true)}
                      >
                        <FileText className="w-3 h-3" /> PDF
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border overflow-hidden divide-y">
                  {pendingDeductions.map((d) => {
                    const detail = d.booking_id ? deductionDetails[d.booking_id] : undefined;
                    const reasonLabel = d.reason_code
                      .replace(/_/g, ' ')
                      .replace(/\b\w/g, (c) => c.toUpperCase());
                    return (
                      <div key={d.id} className="flex items-start gap-4 px-4 py-3.5 hover:bg-muted/30 transition-colors">
                        <div className="w-9 h-9 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
                          <MinusCircle className="w-4 h-4 text-destructive" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-foreground">{reasonLabel}</span>
                            {detail?.bookingStatus && (
                              <Badge variant="outline" className="rounded-full text-[10px] h-5 px-2 bg-destructive/10 text-destructive border-0">
                                {detail.bookingStatus}
                              </Badge>
                            )}
                          </div>
                          {d.reason_detail && (
                            <p className="text-xs text-muted-foreground mt-0.5">{d.reason_detail}</p>
                          )}
                          <div className="flex items-center gap-3 flex-wrap mt-1.5 text-[11px] text-muted-foreground">
                            {detail?.propertyTitle && (
                              <span className="inline-flex items-center gap-1">
                                <span className="font-medium text-foreground/80">Listing:</span> {detail.propertyTitle}
                              </span>
                            )}
                            {detail?.propertyId && (
                              <span className="font-mono">#{detail.propertyId.slice(0, 8)}</span>
                            )}
                            {d.booking_id && (
                              <span className="font-mono">Booking #{d.booking_id.slice(0, 8)}</span>
                            )}
                            {detail?.checkIn && detail?.checkOut && (
                              <span>
                                {format(new Date(detail.checkIn), 'MMM d')} – {format(new Date(detail.checkOut), 'MMM d, yyyy')}
                              </span>
                            )}
                            <span>Logged {format(new Date(d.created_at), 'MMM d, yyyy')}</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-base font-semibold tabular-nums text-destructive">
                            −${Number(d.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{d.currency}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 rounded-xl bg-destructive/5 border border-destructive/10 p-3.5 flex gap-3">
                  <Info className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Penalties stay pending until your next payout is processed. They are then settled
                    automatically and moved to your deduction history. Contact support if you'd like to dispute one.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Settled deductions history */}
          {settledDeductions.length > 0 && (
            <Card className="rounded-2xl border shadow-none mb-6 overflow-hidden">
              <CardContent className="p-7">
                <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0">
                      <History className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-foreground">Deduction history</h2>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {settledDeductions.length} settled penalty{settledDeductions.length === 1 ? '' : ' deductions'} applied to past payouts.
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Lifetime total</p>
                    <p className="text-2xl font-semibold tabular-nums text-foreground">
                      −${settledTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <div className="flex items-center gap-1.5 mt-2 justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full h-7 px-2.5 text-[11px] gap-1"
                        onClick={exportSettledCSV}
                      >
                        <Download className="w-3 h-3" /> CSV
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border overflow-hidden divide-y">
                  {settledDeductions.slice(0, 30).map((d) => {
                    const reasonLabel = formatReason(d.reason_code);
                    const settledAt = (d as any).settled_at;
                    return (
                      <div key={d.id} className="flex items-start gap-4 px-4 py-3.5 hover:bg-muted/30 transition-colors">
                        <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                          <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-foreground">{reasonLabel}</span>
                            <Badge variant="outline" className="rounded-full text-[10px] h-5 px-2 bg-muted text-muted-foreground border-0">
                              {d.status}
                            </Badge>
                          </div>
                          {d.reason_detail && (
                            <p className="text-xs text-muted-foreground mt-0.5">{d.reason_detail}</p>
                          )}
                          <div className="flex items-center gap-3 flex-wrap mt-1.5 text-[11px] text-muted-foreground">
                            {d.booking_id && (
                              <span className="font-mono">Booking #{d.booking_id.slice(0, 8)}</span>
                            )}
                            <span>Logged {format(new Date(d.created_at), 'MMM d, yyyy')}</span>
                            {settledAt && (
                              <span className="inline-flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                Settled {format(new Date(settledAt), 'MMM d, yyyy')}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-base font-semibold tabular-nums text-muted-foreground line-through">
                            −${Number(d.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{d.currency}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {settledDeductions.length > 30 && (
                  <p className="text-xs text-muted-foreground text-center pt-3">
                    Showing most recent 30 of {settledDeductions.length}. Export CSV for the full history.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Payout schedule — upcoming releases by date */}
          <Card className="rounded-2xl border shadow-none mb-6">
            <CardContent className="p-7">
              <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
                <div>
                  <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
                    <CalendarDays className="w-5 h-5 text-primary" />
                    Upcoming payout schedule
                  </h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Releases via <span className="font-medium text-foreground">{PAYOUT_METHODS[payoutMethod].label}</span>
                    {' · '}{PAYOUT_METHODS[payoutMethod].time}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total scheduled</p>
                  <p className="text-2xl font-semibold tabular-nums text-foreground">
                    ${upcomingTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <div className="flex items-center gap-1.5 mt-2 justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full h-7 px-2.5 text-[11px] gap-1"
                      onClick={exportUpcomingExcel}
                    >
                      <Download className="w-3 h-3" /> Excel
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full h-7 px-2.5 text-[11px] gap-1"
                      onClick={() => setUpcomingPreviewOpen(true)}
                    >
                      <FileText className="w-3 h-3" /> PDF
                    </Button>
                  </div>
                </div>
              </div>

              {/* Quick stats */}
              <div className="grid grid-cols-3 gap-2 mb-5">
                <div className="rounded-xl border p-3 bg-card">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Next 7 days</p>
                  <p className="text-lg font-semibold tabular-nums mt-1">{next7days.length}</p>
                  <p className="text-[10px] text-muted-foreground">
                    ${next7days.reduce((s, i) => s + i.amount, 0).toFixed(2)}
                  </p>
                </div>
                <div className="rounded-xl border p-3 bg-card">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">All upcoming</p>
                  <p className="text-lg font-semibold tabular-nums mt-1">{upcomingReleases.length}</p>
                  <p className="text-[10px] text-muted-foreground">releases</p>
                </div>
                <div className="rounded-xl border p-3 bg-card">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Long-stay</p>
                  <p className="text-lg font-semibold tabular-nums mt-1">
                    {upcomingReleases.filter((i) => i.isLongStay).length}
                  </p>
                  <p className="text-[10px] text-muted-foreground">installments</p>
                </div>
              </div>

              {/* Schedule list */}
              {upcomingReleases.length > 0 ? (
                <div className="rounded-xl border overflow-hidden">
                  <div className="divide-y">
                    {upcomingReleases.slice(0, 12).map((item) => {
                      const daysUntil = Math.max(0, Math.ceil((item.releaseDate.getTime() - Date.now()) / 86400000));
                      const imminent = daysUntil <= 1;
                      return (
                        <div key={item.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors">
                          {/* Date pill */}
                          <div className={`w-14 h-14 rounded-xl flex flex-col items-center justify-center shrink-0 ${
                            imminent ? 'bg-primary text-primary-foreground' : 'bg-muted'
                          }`}>
                            <span className={`text-[10px] font-semibold uppercase tracking-wider ${imminent ? 'opacity-90' : 'text-muted-foreground'}`}>
                              {format(item.releaseDate, 'MMM')}
                            </span>
                            <span className="text-lg font-semibold tabular-nums leading-none">
                              {format(item.releaseDate, 'd')}
                            </span>
                          </div>

                          {/* Details */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs text-foreground">#{item.bookingId.slice(0, 8)}</span>
                              {item.source === 'installment' && (
                                <Badge variant="outline" className="rounded-full text-[10px] h-5 px-2">
                                  Installment {(item as any).installmentNumber}/{(item as any).totalInstallments}
                                </Badge>
                              )}
                              {item.isLongStay && item.source === 'booking' && (
                                <Badge variant="outline" className="rounded-full text-[10px] h-5 px-2 bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-400">
                                  Long stay
                                </Badge>
                              )}
                              {imminent && (
                                <Badge className="rounded-full text-[10px] h-5 px-2 bg-primary text-primary-foreground border-0">
                                  {daysUntil === 0 ? 'Today' : 'Tomorrow'}
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {item.nights} night{item.nights === 1 ? '' : 's'} · Releases in {daysUntil} day{daysUntil === 1 ? '' : 's'}
                              {' via '}{PAYOUT_METHODS[payoutMethod].label}
                            </p>
                          </div>

                          {/* Amount */}
                          <div className="text-right shrink-0">
                            <p className="text-base font-semibold tabular-nums text-foreground">
                              ${item.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                            <p className="text-[10px] text-muted-foreground">{format(item.releaseDate, 'EEE, MMM d')}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {upcomingReleases.length > 12 && (
                    <div className="px-4 py-2.5 bg-muted/20 text-center">
                      <p className="text-xs text-muted-foreground">
                        + {upcomingReleases.length - 12} more scheduled release{upcomingReleases.length - 12 === 1 ? '' : 's'}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center rounded-xl border border-dashed">
                  <CalendarDays className="w-10 h-10 text-muted-foreground/40 mb-3" />
                  <p className="text-sm font-medium text-foreground mb-1">No upcoming releases</p>
                  <p className="text-xs text-muted-foreground max-w-xs">
                    When you have confirmed bookings, payouts will appear here scheduled 24h after each guest checks in.
                  </p>
                </div>
              )}

              <div className="mt-4 rounded-xl bg-muted/30 p-3.5 flex gap-3">
                <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Standard release: 24h after guest check-in. Long stays (28+ nights) are split into monthly installments
                  matching guest payments. All releases land via your selected payout method above.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Monthly chart */}
          <Card className="rounded-2xl border shadow-none mb-8">
            <CardContent className="p-7">
              <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-primary" />
                    Last 6 months
                  </h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {format(subMonths(new Date(), 5), 'MMM yyyy')} — {format(new Date(), 'MMM yyyy')}
                  </p>
                </div>
              </div>
              {monthlyData.some(m => m.gross > 0) ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={monthlyData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }} barSize={32} barGap={6}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v) => `$${v}`} tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={(value: number, name: string) => [`$${value.toFixed(2)}`, name === 'gross' ? 'Gross' : name === 'deductions' ? 'Deductions' : 'Take Home']}
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px', fontSize: 13 }}
                      labelStyle={{ fontWeight: 600, marginBottom: 4 }}
                    />
                    <Legend formatter={(v) => v === 'gross' ? 'Gross' : v === 'deductions' ? 'Deductions' : 'Take Home'} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="gross" fill="hsl(var(--primary) / 0.25)" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="deductions" fill="hsl(var(--destructive) / 0.5)" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="takeHome" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                  <BarChart3 className="w-10 h-10 mb-2 opacity-40" />
                  <p className="text-sm">{t('hostEarnings.noCompletedBookings')}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Payout history with filters + sortable columns */}
          <Card className="rounded-2xl border shadow-none">
            <CardContent className="p-7">
              <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
                <div>
                  <h2 className="text-xl font-semibold text-foreground">Payout history</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {filteredBookings.length} {filteredBookings.length === 1 ? 'transaction' : 'transactions'}
                    {(dateRange !== 'all' || statusFilter !== 'all' || payoutFilter !== 'all') && ' (filtered)'}
                  </p>
                </div>
                <Button variant="outline" size="sm" className="rounded-full gap-1.5" onClick={exportFilteredCSV}>
                  <Download className="w-3.5 h-3.5" /> Export CSV
                </Button>
              </div>

              {/* Filter bar */}
              <div className="flex flex-wrap items-center gap-2 mb-5 pb-5 border-b">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Filter className="w-3.5 h-3.5" /> Filter
                </div>
                <Select value={dateRange} onValueChange={(v) => setDateRange(v as any)}>
                  <SelectTrigger className="h-9 w-[140px] rounded-full text-xs">
                    <SelectValue placeholder="Date range" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All time</SelectItem>
                    <SelectItem value="7d">Last 7 days</SelectItem>
                    <SelectItem value="30d">Last 30 days</SelectItem>
                    <SelectItem value="90d">Last 90 days</SelectItem>
                    <SelectItem value="ytd">Year to date</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-9 w-[160px] rounded-full text-xs">
                    <SelectValue placeholder="Booking status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All bookings</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={payoutFilter} onValueChange={setPayoutFilter}>
                  <SelectTrigger className="h-9 w-[150px] rounded-full text-xs">
                    <SelectValue placeholder="Payout status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All payouts</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                {(dateRange !== 'all' || statusFilter !== 'all' || payoutFilter !== 'all') && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 rounded-full text-xs"
                    onClick={() => { setDateRange('all'); setStatusFilter('all'); setPayoutFilter('all'); }}
                  >
                    Clear
                  </Button>
                )}
              </div>

              {/* Table */}
              {filteredBookings.length > 0 ? (
                <div className="overflow-x-auto -mx-7 px-7">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b">
                        <th className="py-3 pr-4">Booking</th>
                        <th className="py-3 pr-4">
                          <button onClick={() => toggleSort('date')} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                            Dates {sortIcon('date')}
                          </button>
                        </th>
                        <th className="py-3 pr-4 text-right">
                          <button onClick={() => toggleSort('nights')} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                            Nights {sortIcon('nights')}
                          </button>
                        </th>
                        <th className="py-3 pr-4 text-right">
                          <button onClick={() => toggleSort('payout')} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                            Take home {sortIcon('payout')}
                          </button>
                        </th>
                        <th className="py-3 pr-4">
                          <button onClick={() => toggleSort('status')} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                            Status {sortIcon('status')}
                          </button>
                        </th>
                        <th className="py-3">Payout</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredBookings.slice(0, 50).map((booking) => {
                        const r = computeRow(booking);
                        const payoutBadge =
                          r.payoutStatus === 'paid' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' :
                          r.payoutStatus === 'scheduled' ? 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400' :
                          r.payoutStatus === 'cancelled' ? 'bg-muted text-muted-foreground' :
                          'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400';
                        const statusBadge =
                          booking.status === 'completed' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' :
                          booking.status === 'confirmed' ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' :
                          booking.status === 'cancelled' ? 'bg-destructive/10 text-destructive' :
                          'bg-muted text-muted-foreground';
                        return (
                          <tr key={booking.id} className="hover:bg-muted/30 transition-colors">
                            <td className="py-3 pr-4 font-mono text-xs text-foreground">#{booking.id.slice(0, 8)}</td>
                            <td className="py-3 pr-4 text-muted-foreground text-xs">
                              {format(new Date(booking.check_in_date), 'MMM d')} – {format(new Date(booking.check_out_date), 'MMM d, yyyy')}
                            </td>
                            <td className="py-3 pr-4 text-right tabular-nums text-foreground">{booking.num_nights}</td>
                            <td className="py-3 pr-4 text-right tabular-nums font-semibold text-foreground">
                              ${r.payout.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="py-3 pr-4">
                              <Badge variant="outline" className={`rounded-full text-[10px] h-5 px-2 font-medium border-0 ${statusBadge}`}>
                                {booking.status}
                              </Badge>
                            </td>
                            <td className="py-3">
                              <Badge variant="outline" className={`rounded-full text-[10px] h-5 px-2 font-medium border-0 ${payoutBadge}`}>
                                {r.payoutStatus}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {filteredBookings.length > 50 && (
                    <p className="text-xs text-muted-foreground text-center pt-4">
                      Showing first 50 of {filteredBookings.length}. Export CSV for the full list.
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Filter className="w-10 h-10 text-muted-foreground/40 mb-3" />
                  <p className="text-sm font-medium text-foreground mb-1">No transactions match these filters</p>
                  <p className="text-xs text-muted-foreground">Try widening the date range or clearing filters.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <EarningsPdfSettingsDialog
        open={pdfDialogOpen}
        onOpenChange={setPdfDialogOpen}
        defaultFileName={`hostly-earnings-${format(new Date(), 'yyyy-MM-dd')}`}
        computeMatchingCount={(o) => filterBookingsForPdf(o).length}
        onExport={(o) => exportPDF(o)}
      />

      {/* Live preview — Pending penalties cover page */}
      {(() => {
        const fmtMoney = (n: number) =>
          `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const reasonsCount = new Set(pendingDeductions.map((d) => d.reason_code)).size;
        const bookingsCount = new Set(pendingDeductions.map((d) => d.booking_id).filter(Boolean)).size;
        const oldest = pendingDeductions.reduce<Date | null>((a, d) => {
          const t = new Date(d.created_at);
          return !a || t < a ? t : a;
        }, null);
        return (
          <PdfCoverPreviewDialog
            open={penaltiesPreviewOpen}
            onOpenChange={setPenaltiesPreviewOpen}
            variant="danger"
            subtitle="Hostiva · Penalty Statement"
            title="Pending Penalty Deductions"
            totalLabel="Total to deduct"
            totalValue={`-${fmtMoney(pendingDeductionsTotal)}`}
            footnote="Auto-applied to your next payout"
            stats={[
              { label: 'Pending items', value: String(pendingDeductions.length) },
              { label: 'Distinct reasons', value: String(reasonsCount) },
              { label: 'Affected bookings', value: String(bookingsCount) },
              { label: 'Oldest entry', value: oldest ? format(oldest, 'MMM d, yyyy') : '—' },
            ]}
            methodLabel={PAYOUT_METHODS[payoutMethod].label}
            methodTime={PAYOUT_METHODS[payoutMethod].time}
            methodAccount={accountReference || undefined}
            generatedForName={profile?.full_name || profile?.email || 'Host'}
            generatedForEmail={profile?.email}
            disabled={pendingDeductions.length === 0}
            confirmLabel="Download penalties PDF"
            onConfirm={async () => {
              await exportPenaltiesPDF();
              setPenaltiesPreviewOpen(false);
            }}
          />
        );
      })()}

      {/* Live preview — Upcoming payouts cover page */}
      {(() => {
        const fmtMoney = (n: number) =>
          `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const next7 = upcomingReleases.filter((i) => i.releaseDate.getTime() - Date.now() < 7 * 86400000);
        const next7Total = next7.reduce((s, i) => s + i.amount, 0);
        const installmentCount = upcomingReleases.filter((i) => i.source === 'installment').length;
        const nextDate = upcomingReleases[0]?.releaseDate;
        const lastDate = upcomingReleases[upcomingReleases.length - 1]?.releaseDate;
        return (
          <PdfCoverPreviewDialog
            open={upcomingPreviewOpen}
            onOpenChange={setUpcomingPreviewOpen}
            variant="brand"
            subtitle="Hostiva · Payout Forecast"
            title="Upcoming Payout Schedule"
            totalLabel="Total scheduled"
            totalValue={fmtMoney(upcomingTotal)}
            footnote={`${upcomingReleases.length} payout${upcomingReleases.length === 1 ? '' : 's'} on the way`}
            stats={[
              { label: 'Next 7 days', value: `${fmtMoney(next7Total)} · ${next7.length}` },
              { label: 'Installments', value: String(installmentCount) },
              { label: 'Next release', value: nextDate ? format(nextDate, 'MMM d, yyyy') : '—' },
              { label: 'Last release', value: lastDate ? format(lastDate, 'MMM d, yyyy') : '—' },
            ]}
            methodLabel={PAYOUT_METHODS[payoutMethod].label}
            methodTime={PAYOUT_METHODS[payoutMethod].time}
            methodAccount={accountReference || undefined}
            generatedForName={profile?.full_name || profile?.email || 'Host'}
            generatedForEmail={profile?.email}
            disabled={upcomingReleases.length === 0}
            confirmLabel="Download payouts PDF"
            onConfirm={async () => {
              await exportUpcomingPDF();
              setUpcomingPreviewOpen(false);
            }}
          />
        );
      })()}
    </Layout>
  );
}
