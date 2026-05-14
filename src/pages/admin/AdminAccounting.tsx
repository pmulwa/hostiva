import { useEffect, useMemo, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { usePlatformSettings, calculateFees } from '@/hooks/usePlatformSettings';
import { Coins, Wallet, Receipt, TrendingUp, Download, RefreshCw, BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import Decimal from 'decimal.js';
import { FinanceConsole } from '@/components/admin/FinanceConsole';
import { AdminFinancialReports } from '@/components/admin/AdminFinancialReports';

interface BookingRow {
  id: string;
  host_id: string;
  guest_id: string;
  property_id: string;
  status: string;
  currency: string | null;
  subtotal: number;
  cleaning_fee: number | null;
  service_fee: number | null;
  total_price: number;
  refund_amount: number | null;
  refund_status: string | null;
  refund_reason: string | null;
  refund_date: string | null;
  cancellation_reason: string | null;
  check_in_date: string;
  check_out_date: string;
  created_at: string;
}

interface PayoutRow {
  id: string;
  host_id: string;
  booking_id: string;
  amount: number;
  status: string;
  paid_at: string | null;
  created_at: string;
}

interface ExternalBookingRow {
  id: string;
  host_id: string;
  property_id: string | null;
  gross_revenue: number;
  cleaning_fee: number;
  commission_amount: number;
  net_payout: number;
  txn_currency: string;
  fx_rate: number;
  base_amount: number | null;
  payment_status: string;
  payment_received_date: string | null;
  notes: string | null;
  check_in_date: string;
  check_out_date: string;
}

interface ProfileLite { user_id: string; full_name: string | null; email: string }
interface PropertyLite { id: string; title: string; host_id: string }

const D = (v: any) => new Decimal(v ?? 0);
const fmt = (n: number | Decimal, currency = 'USD') => {
  const v = typeof n === 'number' ? n : Number(n.toString());
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(v);
  } catch {
    return `${currency} ${v.toFixed(2)}`;
  }
};
const csvEscape = (v: any) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default function AdminAccounting() {
  const { settings: platform } = usePlatformSettings();
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 5);
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [hostFilter, setHostFilter] = useState<string>('all');

  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [externals, setExternals] = useState<ExternalBookingRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileLite[]>([]);
  const [properties, setProperties] = useState<PropertyLite[]>([]);

  // Drill-into-host modal state
  const [drillHost, setDrillHost] = useState<{ id: string; name: string } | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    const [bRes, pRes, eRes, profRes, propRes] = await Promise.all([
      supabase.from('bookings').select('id,host_id,guest_id,property_id,status,currency,subtotal,cleaning_fee,service_fee,total_price,refund_amount,refund_status,refund_reason,refund_date,cancellation_reason,check_in_date,check_out_date,created_at')
        .gte('check_in_date', from).lte('check_in_date', to).order('check_in_date', { ascending: false }),
      supabase.from('payouts').select('id,host_id,booking_id,amount,status,paid_at,created_at'),
      supabase.from('acct_external_bookings').select('id,host_id,property_id,gross_revenue,cleaning_fee,commission_amount,net_payout,txn_currency,fx_rate,base_amount,payment_status,payment_received_date,notes,check_in_date,check_out_date')
        .gte('check_in_date', from).lte('check_in_date', to),
      supabase.from('profiles').select('user_id,full_name,email'),
      supabase.from('properties').select('id,title,host_id'),
    ]);

    if (bRes.error) toast.error(bRes.error.message);
    setBookings((bRes.data ?? []) as any);
    setPayouts((pRes.data ?? []) as any);
    setExternals((eRes.data ?? []) as any);
    setProfiles((profRes.data ?? []) as any);
    setProperties((propRes.data ?? []) as any);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to]);

  const profileById = useMemo(() => {
    const m = new Map<string, ProfileLite>();
    profiles.forEach(p => m.set(p.user_id, p));
    return m;
  }, [profiles]);
  const propertyById = useMemo(() => {
    const m = new Map<string, PropertyLite>();
    properties.forEach(p => m.set(p.id, p));
    return m;
  }, [properties]);

  const hostsWithActivity = useMemo(() => {
    const ids = new Set<string>();
    bookings.forEach(b => ids.add(b.host_id));
    payouts.forEach(p => ids.add(p.host_id));
    externals.forEach(e => ids.add(e.host_id));
    return Array.from(ids).map(id => profileById.get(id)).filter(Boolean) as ProfileLite[];
  }, [bookings, payouts, externals, profileById]);

  const filteredBookings = useMemo(
    () => hostFilter === 'all' ? bookings : bookings.filter(b => b.host_id === hostFilter),
    [bookings, hostFilter]
  );
  const filteredPayouts = useMemo(
    () => hostFilter === 'all' ? payouts : payouts.filter(p => p.host_id === hostFilter),
    [payouts, hostFilter]
  );
  const filteredExternals = useMemo(
    () => hostFilter === 'all' ? externals : externals.filter(e => e.host_id === hostFilter),
    [externals, hostFilter]
  );

  // Cancellations / refunds list
  const refundRows = useMemo(
    () => filteredBookings.filter(b => b.status === 'cancelled' || (b.refund_amount ?? 0) > 0)
      .sort((a, b) => (b.refund_date || b.check_in_date).localeCompare(a.refund_date || a.check_in_date)),
    [filteredBookings]
  );

  // Consolidated totals — USD-base aggregate (legacy)
  const totals = useMemo(() => {
    let guestPaid = D(0);
    let hostPayouts = D(0);
    let platformServiceFee = D(0);
    let platformCommission = D(0);
    let platformTaxes = D(0);
    let cleaningRevenue = D(0);
    let refundsIssued = D(0);
    let grossBookingValue = D(0);

    const confirmable = ['confirmed', 'completed'];
    filteredBookings.forEach(b => {
      const fees = calculateFees(Number(b.subtotal), platform);
      if (confirmable.includes(b.status)) {
        guestPaid = guestPaid.plus(b.total_price);
        grossBookingValue = grossBookingValue.plus(b.subtotal);
        cleaningRevenue = cleaningRevenue.plus(b.cleaning_fee ?? 0);
        platformServiceFee = platformServiceFee.plus(fees.serviceFeeWithTax);
        platformCommission = platformCommission.plus(fees.hostCommission);
        platformTaxes = platformTaxes.plus(fees.serviceTax).plus(fees.hostCommissionTax);
        hostPayouts = hostPayouts.plus(fees.hostPayout).plus(b.cleaning_fee ?? 0);
      }
      if (b.refund_amount) {
        refundsIssued = refundsIssued.plus(b.refund_amount);
      }
    });

    const platformRevenue = platformServiceFee.plus(platformCommission).plus(platformTaxes);
    return {
      guestPaid: guestPaid.toNumber(),
      hostPayouts: hostPayouts.toNumber(),
      platformServiceFee: platformServiceFee.toNumber(),
      platformCommission: platformCommission.toNumber(),
      platformTaxes: platformTaxes.toNumber(),
      platformRevenue: platformRevenue.toNumber(),
      cleaningRevenue: cleaningRevenue.toNumber(),
      refundsIssued: refundsIssued.toNumber(),
      grossBookingValue: grossBookingValue.toNumber(),
    };
  }, [filteredBookings, platform]);

  // Per-currency totals — group everything by booking currency so multi-currency activity isn't silently summed
  const byCurrency = useMemo(() => {
    const map = new Map<string, {
      currency: string;
      guestPaid: Decimal;
      grossBookingValue: Decimal;
      cleaning: Decimal;
      refundsIssued: Decimal;
      hostPayouts: Decimal;
      platformRevenue: Decimal;
      bookings: number;
    }>();
    const ensure = (ccy: string) => {
      let r = map.get(ccy);
      if (!r) {
        r = {
          currency: ccy,
          guestPaid: D(0), grossBookingValue: D(0), cleaning: D(0),
          refundsIssued: D(0), hostPayouts: D(0), platformRevenue: D(0),
          bookings: 0,
        };
        map.set(ccy, r);
      }
      return r;
    };
    filteredBookings.forEach(b => {
      const ccy = (b.currency || 'USD').toUpperCase();
      const r = ensure(ccy);
      const fees = calculateFees(Number(b.subtotal), platform);
      if (['confirmed', 'completed'].includes(b.status)) {
        r.bookings += 1;
        r.guestPaid = r.guestPaid.plus(b.total_price);
        r.grossBookingValue = r.grossBookingValue.plus(b.subtotal);
        r.cleaning = r.cleaning.plus(b.cleaning_fee ?? 0);
        r.hostPayouts = r.hostPayouts.plus(fees.hostPayout).plus(b.cleaning_fee ?? 0);
        r.platformRevenue = r.platformRevenue.plus(fees.serviceFeeWithTax)
          .plus(fees.hostCommission).plus(fees.hostCommissionTax);
      }
      if (b.refund_amount) r.refundsIssued = r.refundsIssued.plus(b.refund_amount);
    });
    // Pull external (Hostiva imports) using their txn_currency
    filteredExternals.forEach(e => {
      const ccy = (e.txn_currency || 'USD').toUpperCase();
      const r = ensure(ccy);
      // Only count if not already represented as an internal Hostiva booking match
      // (External rows for internal bookings double-count guest revenue if added; skip those.)
      const isMirror = (e.notes || '').startsWith('AUTO:HOSTLY:');
      if (!isMirror) {
        r.grossBookingValue = r.grossBookingValue.plus(e.gross_revenue);
        r.cleaning = r.cleaning.plus(e.cleaning_fee);
        r.hostPayouts = r.hostPayouts.plus(e.net_payout);
        r.platformRevenue = r.platformRevenue.plus(e.commission_amount);
        r.bookings += 1;
      }
    });
    return Array.from(map.values()).sort((a, b) => Number(b.guestPaid) - Number(a.guestPaid));
  }, [filteredBookings, filteredExternals, platform]);

  // Per-host roll-up
  const byHost = useMemo(() => {
    const map = new Map<string, {
      hostId: string;
      hostName: string;
      bookings: number;
      grossRevenue: number;
      hostPayout: number;
      platformShare: number;
      paidOut: number;
      pendingPayout: number;
    }>();

    const ensure = (hid: string) => {
      let row = map.get(hid);
      if (!row) {
        const p = profileById.get(hid);
        row = {
          hostId: hid,
          hostName: p?.full_name || p?.email || hid.slice(0, 8),
          bookings: 0, grossRevenue: 0, hostPayout: 0, platformShare: 0,
          paidOut: 0, pendingPayout: 0,
        };
        map.set(hid, row);
      }
      return row;
    };

    filteredBookings.forEach(b => {
      if (!['confirmed', 'completed'].includes(b.status)) return;
      const r = ensure(b.host_id);
      const fees = calculateFees(Number(b.subtotal), platform);
      r.bookings += 1;
      r.grossRevenue += Number(b.subtotal) + Number(b.cleaning_fee ?? 0);
      r.hostPayout += fees.hostPayout + Number(b.cleaning_fee ?? 0);
      r.platformShare += fees.serviceFeeWithTax + fees.hostCommission + fees.hostCommissionTax;
    });

    filteredPayouts.forEach(p => {
      const r = ensure(p.host_id);
      if (p.status === 'paid') r.paidOut += Number(p.amount);
      else r.pendingPayout += Number(p.amount);
    });

    return Array.from(map.values()).sort((a, b) => b.grossRevenue - a.grossRevenue);
  }, [filteredBookings, filteredPayouts, platform, profileById]);

  const exportCsv = () => {
    const lines = [
      ['Section', 'Date', 'Host', 'Property', 'Reference', 'Type', 'Amount', 'Currency', 'Status'].join(','),
    ];
    filteredBookings.forEach(b => {
      const host = profileById.get(b.host_id);
      const prop = propertyById.get(b.property_id);
      lines.push([
        'Guest payment', b.check_in_date, csvEscape(host?.full_name || host?.email || ''),
        csvEscape(prop?.title || ''), b.id, b.status, b.total_price, b.currency || 'USD', b.status,
      ].join(','));
    });
    filteredPayouts.forEach(p => {
      const host = profileById.get(p.host_id);
      lines.push([
        'Host payout', p.paid_at?.slice(0,10) || p.created_at.slice(0,10),
        csvEscape(host?.full_name || host?.email || ''), '', p.booking_id,
        'payout', p.amount, 'USD', p.status,
      ].join(','));
    });
    download(`admin-accounting-${from}-to-${to}.csv`, lines.join('\n'));
  };

  const exportRefundsCsv = () => {
    const headers = ['Cancelled date','Check-in','Host','Guest','Property','Booking ID','Total paid','Refund amount','Currency','Refund status','Refund reason','Cancellation reason'];
    const lines = [headers.join(',')];
    refundRows.forEach(b => {
      const host = profileById.get(b.host_id);
      const guest = profileById.get(b.guest_id);
      const prop = propertyById.get(b.property_id);
      lines.push([
        b.refund_date?.slice(0, 10) || '',
        b.check_in_date,
        csvEscape(host?.full_name || host?.email || ''),
        csvEscape(guest?.full_name || guest?.email || ''),
        csvEscape(prop?.title || ''),
        b.id,
        b.total_price,
        b.refund_amount ?? 0,
        b.currency || 'USD',
        b.refund_status || 'none',
        csvEscape(b.refund_reason || ''),
        csvEscape(b.cancellation_reason || ''),
      ].join(','));
    });
    download(`admin-refunds-${from}-to-${to}.csv`, lines.join('\n'));
  };

  return (
    <AdminLayout>
      <div className="p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold">Admin Accounting</h1>
            <p className="text-sm text-muted-foreground">
              Consolidated income from guests, payouts to hosts, and platform earnings — across every host.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9 w-[150px]" />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9 w-[150px]" />
            </div>
            <div>
              <Label className="text-xs">Host</Label>
              <Select value={hostFilter} onValueChange={setHostFilter}>
                <SelectTrigger className="h-9 w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All hosts</SelectItem>
                  {hostsWithActivity.map(h => (
                    <SelectItem key={h.user_id} value={h.user_id}>
                      {h.full_name || h.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={fetchAll} className="h-9">
              <RefreshCw className="w-4 h-4 mr-1.5" /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} className="h-9">
              <Download className="w-4 h-4 mr-1.5" /> Export CSV
            </Button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label="Guest payments collected" value={fmt(totals.guestPaid)} icon={Coins} accent="text-primary" />
          <KpiCard label="Host payouts (calculated)" value={fmt(totals.hostPayouts)} icon={Wallet} />
          <KpiCard label="Platform revenue (fees+tax)" value={fmt(totals.platformRevenue)} icon={TrendingUp} accent="text-emerald-600" />
          <KpiCard label="Refunds issued" value={fmt(totals.refundsIssued)} icon={Receipt} accent="text-destructive" />
        </div>

        <Tabs defaultValue="console" className="space-y-4">
          <TabsList>
            <TabsTrigger value="console">360° Console</TabsTrigger>
            <TabsTrigger value="financials">Financial reports</TabsTrigger>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="guest-income">Guest income</TabsTrigger>
            <TabsTrigger value="host-payouts">Host payouts</TabsTrigger>
            <TabsTrigger value="by-host">By host</TabsTrigger>
            <TabsTrigger value="refunds">Refunds ({refundRows.length})</TabsTrigger>
            <TabsTrigger value="external">External bookings</TabsTrigger>
          </TabsList>

          {/* 360° CONSOLE — command center + consolidated statements */}
          <TabsContent value="console" className="space-y-4">
            <FinanceConsole
              bookings={filteredBookings}
              payouts={filteredPayouts}
              externals={filteredExternals}
              profiles={profiles}
              properties={properties}
              loading={loading}
              from={from}
              to={to}
              totals={totals}
            />
          </TabsContent>

          {/* FINANCIAL REPORTS — same display as host module, scoped per host/property */}
          <TabsContent value="financials" className="space-y-4">
            <AdminFinancialReports />
          </TabsContent>

          {/* OVERVIEW — consolidated P&L + per-currency */}
          <TabsContent value="overview" className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Per-currency totals</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                {loading ? <Skeleton className="h-32" /> : byCurrency.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No activity in this period.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Currency</TableHead>
                        <TableHead className="text-right">Bookings</TableHead>
                        <TableHead className="text-right">Gross booking value</TableHead>
                        <TableHead className="text-right">Cleaning</TableHead>
                        <TableHead className="text-right">Guest paid</TableHead>
                        <TableHead className="text-right">Host payouts</TableHead>
                        <TableHead className="text-right">Platform revenue</TableHead>
                        <TableHead className="text-right">Refunds</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {byCurrency.map(r => (
                        <TableRow key={r.currency}>
                          <TableCell className="font-medium">{r.currency}</TableCell>
                          <TableCell className="text-right text-xs">{r.bookings}</TableCell>
                          <TableCell className="text-right text-xs">{fmt(Number(r.grossBookingValue), r.currency)}</TableCell>
                          <TableCell className="text-right text-xs">{fmt(Number(r.cleaning), r.currency)}</TableCell>
                          <TableCell className="text-right text-xs font-medium">{fmt(Number(r.guestPaid), r.currency)}</TableCell>
                          <TableCell className="text-right text-xs">{fmt(Number(r.hostPayouts), r.currency)}</TableCell>
                          <TableCell className="text-right text-xs text-emerald-600">{fmt(Number(r.platformRevenue), r.currency)}</TableCell>
                          <TableCell className="text-right text-xs text-destructive">{fmt(Number(r.refundsIssued), r.currency)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                <p className="text-xs text-muted-foreground mt-3">
                  Each row groups activity by the booking's transaction currency. Use these totals when reconciling against bank/PSP statements per currency.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Consolidated profit &amp; loss (USD-base aggregate)</CardTitle></CardHeader>
              <CardContent>
                {loading ? <Skeleton className="h-48" /> : (
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Line</TableHead><TableHead className="text-right">Amount (USD)</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      <PnlRow label="Gross booking value (subtotals)" value={totals.grossBookingValue} />
                      <PnlRow label="Cleaning fees collected" value={totals.cleaningRevenue} />
                      <PnlRow label="Total guest payments" value={totals.guestPaid} bold />
                      <PnlRow label="(−) Host payouts" value={-totals.hostPayouts} />
                      <PnlRow label="(−) Refunds issued" value={-totals.refundsIssued} />
                      <PnlRow label="Platform service fees" value={totals.platformServiceFee} muted />
                      <PnlRow label="Platform host commission" value={totals.platformCommission} muted />
                      <PnlRow label="Taxes on platform fees" value={totals.platformTaxes} muted />
                      <PnlRow label="Platform net revenue" value={totals.platformRevenue - totals.refundsIssued} bold />
                    </TableBody>
                  </Table>
                )}
                <p className="text-xs text-muted-foreground mt-4">
                  Aggregate is computed in USD without FX conversion. For multi-currency accuracy, use the per-currency table above.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* GUEST INCOME */}
          <TabsContent value="guest-income">
            <Card>
              <CardHeader><CardTitle className="text-base">Guest payments ({filteredBookings.length})</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                {loading ? <Skeleton className="h-48" /> : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Guest</TableHead>
                        <TableHead>Host</TableHead>
                        <TableHead>Property</TableHead>
                        <TableHead className="text-right">Subtotal</TableHead>
                        <TableHead className="text-right">Cleaning</TableHead>
                        <TableHead className="text-right">Service fee</TableHead>
                        <TableHead className="text-right">Total paid</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredBookings.slice(0, 200).map(b => {
                        const guest = profileById.get(b.guest_id);
                        const host = profileById.get(b.host_id);
                        const prop = propertyById.get(b.property_id);
                        return (
                          <TableRow key={b.id}>
                            <TableCell className="text-xs">{b.check_in_date}</TableCell>
                            <TableCell className="text-xs">{guest?.full_name || guest?.email || '—'}</TableCell>
                            <TableCell className="text-xs">{host?.full_name || host?.email || '—'}</TableCell>
                            <TableCell className="text-xs max-w-[180px] truncate">{prop?.title || '—'}</TableCell>
                            <TableCell className="text-xs text-right">{fmt(b.subtotal, b.currency || 'USD')}</TableCell>
                            <TableCell className="text-xs text-right">{fmt(b.cleaning_fee ?? 0, b.currency || 'USD')}</TableCell>
                            <TableCell className="text-xs text-right">{fmt(b.service_fee ?? 0, b.currency || 'USD')}</TableCell>
                            <TableCell className="text-xs text-right font-medium">{fmt(b.total_price, b.currency || 'USD')}</TableCell>
                            <TableCell><StatusBadge status={b.status} /></TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
                {filteredBookings.length > 200 && (
                  <p className="text-xs text-muted-foreground mt-2">Showing first 200 of {filteredBookings.length}. Use date filter to narrow.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* HOST PAYOUTS */}
          <TabsContent value="host-payouts">
            <Card>
              <CardHeader><CardTitle className="text-base">Host payouts ({filteredPayouts.length})</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                {loading ? <Skeleton className="h-48" /> : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Host</TableHead>
                        <TableHead>Booking</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredPayouts.slice(0, 200).map(p => {
                        const host = profileById.get(p.host_id);
                        return (
                          <TableRow key={p.id}>
                            <TableCell className="text-xs">{(p.paid_at || p.created_at).slice(0, 10)}</TableCell>
                            <TableCell className="text-xs">{host?.full_name || host?.email || '—'}</TableCell>
                            <TableCell className="text-xs font-mono">{p.booking_id.slice(0, 8)}</TableCell>
                            <TableCell className="text-xs text-right font-medium">{fmt(p.amount)}</TableCell>
                            <TableCell><StatusBadge status={p.status} /></TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* BY HOST */}
          <TabsContent value="by-host">
            <Card>
              <CardHeader><CardTitle className="text-base">Per-host roll-up</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                {loading ? <Skeleton className="h-48" /> : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Host</TableHead>
                        <TableHead className="text-right">Bookings</TableHead>
                        <TableHead className="text-right">Gross revenue</TableHead>
                        <TableHead className="text-right">Calc. host payout</TableHead>
                        <TableHead className="text-right">Platform share</TableHead>
                        <TableHead className="text-right">Paid out</TableHead>
                        <TableHead className="text-right">Pending</TableHead>
                        <TableHead className="text-right">Audit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {byHost.map(r => (
                        <TableRow key={r.hostId}>
                          <TableCell className="text-xs font-medium">{r.hostName}</TableCell>
                          <TableCell className="text-xs text-right">{r.bookings}</TableCell>
                          <TableCell className="text-xs text-right">{fmt(r.grossRevenue)}</TableCell>
                          <TableCell className="text-xs text-right">{fmt(r.hostPayout)}</TableCell>
                          <TableCell className="text-xs text-right">{fmt(r.platformShare)}</TableCell>
                          <TableCell className="text-xs text-right text-emerald-600">{fmt(r.paidOut)}</TableCell>
                          <TableCell className="text-xs text-right text-amber-600">{fmt(r.pendingPayout)}</TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                              onClick={() => setDrillHost({ id: r.hostId, name: r.hostName })}>
                              <BookOpen className="w-3.5 h-3.5" /> Drill into books
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {byHost.length === 0 && (
                        <TableRow><TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-6">No activity in this period</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* REFUNDS */}
          <TabsContent value="refunds">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Cancellations &amp; refunds ({refundRows.length})</CardTitle>
                <Button variant="outline" size="sm" className="h-8" onClick={exportRefundsCsv}>
                  <Download className="w-3.5 h-3.5 mr-1.5" /> Export refunds CSV
                </Button>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {loading ? <Skeleton className="h-48" /> : refundRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No cancellations or refunds in this period.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cancelled</TableHead>
                        <TableHead>Check-in</TableHead>
                        <TableHead>Host</TableHead>
                        <TableHead>Guest</TableHead>
                        <TableHead>Property</TableHead>
                        <TableHead className="text-right">Total paid</TableHead>
                        <TableHead className="text-right">Refund</TableHead>
                        <TableHead>Refund status</TableHead>
                        <TableHead>Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {refundRows.slice(0, 200).map(b => {
                        const host = profileById.get(b.host_id);
                        const guest = profileById.get(b.guest_id);
                        const prop = propertyById.get(b.property_id);
                        const reason = b.refund_reason || b.cancellation_reason || '—';
                        return (
                          <TableRow key={b.id}>
                            <TableCell className="text-xs">{b.refund_date?.slice(0, 10) || '—'}</TableCell>
                            <TableCell className="text-xs">{b.check_in_date}</TableCell>
                            <TableCell className="text-xs">{host?.full_name || host?.email || '—'}</TableCell>
                            <TableCell className="text-xs">{guest?.full_name || guest?.email || '—'}</TableCell>
                            <TableCell className="text-xs max-w-[160px] truncate">{prop?.title || '—'}</TableCell>
                            <TableCell className="text-xs text-right">{fmt(b.total_price, b.currency || 'USD')}</TableCell>
                            <TableCell className="text-xs text-right font-medium text-destructive">
                              {fmt(b.refund_amount ?? 0, b.currency || 'USD')}
                            </TableCell>
                            <TableCell><StatusBadge status={b.refund_status || 'none'} /></TableCell>
                            <TableCell className="text-xs max-w-[220px] truncate" title={reason}>{reason}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
                {refundRows.length > 200 && (
                  <p className="text-xs text-muted-foreground mt-2">Showing first 200 of {refundRows.length}. Export CSV for the full list.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* EXTERNAL */}
          <TabsContent value="external">
            <Card>
              <CardHeader><CardTitle className="text-base">External / imported bookings ({filteredExternals.length})</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                {loading ? <Skeleton className="h-48" /> : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Host</TableHead>
                        <TableHead>Property</TableHead>
                        <TableHead className="text-right">Gross</TableHead>
                        <TableHead className="text-right">Commission</TableHead>
                        <TableHead className="text-right">Net payout</TableHead>
                        <TableHead>Currency</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredExternals.slice(0, 200).map(e => {
                        const host = profileById.get(e.host_id);
                        const prop = e.property_id ? propertyById.get(e.property_id) : null;
                        return (
                          <TableRow key={e.id}>
                            <TableCell className="text-xs">{e.check_in_date}</TableCell>
                            <TableCell className="text-xs">{host?.full_name || host?.email || '—'}</TableCell>
                            <TableCell className="text-xs max-w-[180px] truncate">{prop?.title || '—'}</TableCell>
                            <TableCell className="text-xs text-right">{fmt(e.gross_revenue, e.txn_currency)}</TableCell>
                            <TableCell className="text-xs text-right">{fmt(e.commission_amount, e.txn_currency)}</TableCell>
                            <TableCell className="text-xs text-right font-medium">{fmt(e.net_payout, e.txn_currency)}</TableCell>
                            <TableCell className="text-xs">{e.txn_currency}</TableCell>
                            <TableCell><StatusBadge status={e.payment_status} /></TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {drillHost && <HostBooksDrillDialog host={drillHost} onClose={() => setDrillHost(null)} />}
    </AdminLayout>
  );
}

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function KpiCard({ label, value, icon: Icon, accent }: { label: string; value: string; icon: any; accent?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{label}</span>
          <Icon className={`w-4 h-4 ${accent || 'text-muted-foreground'}`} />
        </div>
        <div className={`text-xl font-bold mt-2 ${accent || ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function PnlRow({ label, value, bold, muted }: { label: string; value: number; bold?: boolean; muted?: boolean }) {
  return (
    <TableRow className={bold ? 'border-t-2' : ''}>
      <TableCell className={`text-sm ${bold ? 'font-semibold' : ''} ${muted ? 'text-muted-foreground pl-8' : ''}`}>{label}</TableCell>
      <TableCell className={`text-sm text-right tabular-nums ${bold ? 'font-bold' : ''} ${muted ? 'text-muted-foreground' : ''} ${value < 0 ? 'text-destructive' : ''}`}>
        {fmt(value)}
      </TableCell>
    </TableRow>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant = ['confirmed','completed','paid','received','auto','full','partial'].includes(status)
    ? 'default'
    : ['cancelled','rejected','failed'].includes(status)
    ? 'destructive'
    : 'secondary';
  return <Badge variant={variant as any} className="text-[10px]">{status}</Badge>;
}

/* -------- Drill-into-host books dialog (read-only journal + trial balance) -------- */

interface JournalEntry { id: string; entry_date: string; description: string; reference: string | null; source_type: string }
interface JournalLine { id: string; entry_id: string; account_id: string; debit: number; credit: number; memo: string | null }
interface AccountRow { id: string; code: string; name: string; type: string }

function HostBooksDrillDialog({ host, onClose }: { host: { id: string; name: string }; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [lines, setLines] = useState<JournalLine[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [eRes, aRes] = await Promise.all([
        supabase.from('acct_journal_entries')
          .select('id,entry_date,description,reference,source_type')
          .eq('host_id', host.id)
          .order('entry_date', { ascending: false })
          .limit(500),
        supabase.from('acct_chart_of_accounts')
          .select('id,code,name,type')
          .eq('host_id', host.id)
          .order('code'),
      ]);
      const ents = (eRes.data ?? []) as JournalEntry[];
      setEntries(ents);
      setAccounts((aRes.data ?? []) as any);
      if (ents.length > 0) {
        const ids = ents.map(e => e.id);
        const lRes = await supabase.from('acct_journal_lines')
          .select('id,entry_id,account_id,debit,credit,memo')
          .in('entry_id', ids);
        setLines((lRes.data ?? []) as any);
      } else {
        setLines([]);
      }
      setLoading(false);
    })();
  }, [host.id]);

  const accountById = useMemo(() => {
    const m = new Map<string, AccountRow>();
    accounts.forEach(a => m.set(a.id, a));
    return m;
  }, [accounts]);

  // Trial balance: sum debits/credits per account
  const trialBalance = useMemo(() => {
    const map = new Map<string, { account: AccountRow; debit: Decimal; credit: Decimal }>();
    accounts.forEach(a => map.set(a.id, { account: a, debit: D(0), credit: D(0) }));
    lines.forEach(ln => {
      const r = map.get(ln.account_id);
      if (!r) return;
      r.debit = r.debit.plus(ln.debit);
      r.credit = r.credit.plus(ln.credit);
    });
    return Array.from(map.values())
      .map(r => {
        const net = r.debit.minus(r.credit);
        return { ...r, debitBal: net.gt(0) ? net : D(0), creditBal: net.lt(0) ? net.neg() : D(0) };
      })
      .filter(r => !r.debit.eq(0) || !r.credit.eq(0))
      .sort((a, b) => a.account.code.localeCompare(b.account.code));
  }, [lines, accounts]);

  const tbTotals = useMemo(() => {
    let d = D(0), c = D(0);
    trialBalance.forEach(r => { d = d.plus(r.debitBal); c = c.plus(r.creditBal); });
    return { debit: d, credit: c };
  }, [trialBalance]);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Host books — {host.name}</DialogTitle>
          <DialogDescription>Read-only audit view of this host's journal and trial balance.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="journal">
          <TabsList>
            <TabsTrigger value="journal">Journal ({entries.length})</TabsTrigger>
            <TabsTrigger value="trial">Trial balance</TabsTrigger>
          </TabsList>

          <TabsContent value="journal">
            {loading ? <Skeleton className="h-48" /> : entries.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No journal entries for this host.</p>
            ) : (
              <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                {entries.map(e => {
                  const eLines = lines.filter(l => l.entry_id === e.id);
                  const tot = eLines.reduce((s, l) => s + Number(l.debit), 0);
                  return (
                    <Card key={e.id}>
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="text-xs">
                            <span className="font-mono mr-2">{e.entry_date}</span>
                            <span className="font-medium">{e.description}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px]">{e.source_type}</Badge>
                            {e.reference && <span className="text-[10px] text-muted-foreground font-mono">{e.reference}</span>}
                            <span className="text-xs font-medium">{fmt(tot)}</span>
                          </div>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Account</TableHead>
                              <TableHead className="text-xs">Memo</TableHead>
                              <TableHead className="text-xs text-right">Debit</TableHead>
                              <TableHead className="text-xs text-right">Credit</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {eLines.map(l => {
                              const a = accountById.get(l.account_id);
                              return (
                                <TableRow key={l.id}>
                                  <TableCell className="text-xs">
                                    <span className="font-mono mr-1">{a?.code || '—'}</span>{a?.name || '—'}
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground">{l.memo}</TableCell>
                                  <TableCell className="text-xs text-right">{Number(l.debit) > 0 ? fmt(Number(l.debit)) : ''}</TableCell>
                                  <TableCell className="text-xs text-right">{Number(l.credit) > 0 ? fmt(Number(l.credit)) : ''}</TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="trial">
            {loading ? <Skeleton className="h-48" /> : trialBalance.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No account activity for this host.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trialBalance.map(r => (
                    <TableRow key={r.account.id}>
                      <TableCell className="text-xs font-mono">{r.account.code}</TableCell>
                      <TableCell className="text-xs">{r.account.name}</TableCell>
                      <TableCell className="text-xs capitalize text-muted-foreground">{r.account.type}</TableCell>
                      <TableCell className="text-xs text-right">{Number(r.debitBal) > 0 ? fmt(Number(r.debitBal)) : ''}</TableCell>
                      <TableCell className="text-xs text-right">{Number(r.creditBal) > 0 ? fmt(Number(r.creditBal)) : ''}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell colSpan={3} className="text-sm">Totals</TableCell>
                    <TableCell className="text-sm text-right">{fmt(Number(tbTotals.debit))}</TableCell>
                    <TableCell className="text-sm text-right">{fmt(Number(tbTotals.credit))}</TableCell>
                  </TableRow>
                  {!tbTotals.debit.eq(tbTotals.credit) && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-xs text-destructive">
                        ⚠ Trial balance does not tie ({fmt(Number(tbTotals.debit.minus(tbTotals.credit)))} difference).
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
