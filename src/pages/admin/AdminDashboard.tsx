import { useState, useEffect, useMemo } from 'react';
import { logAdminAction } from '@/lib/audit';
import { useTranslation } from 'react-i18next';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { usePlatformSettings, calculateFees } from '@/hooks/usePlatformSettings';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Area, AreaChart } from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Users, Home, Calendar as CalendarIcon, DollarSign, Check, X,
  AlertTriangle, TrendingUp, Star, UserCheck,
  Clock, RefreshCw, XCircle, Banknote, Percent, Target, UserPlus, Repeat,
  Download, Trophy, Medal
} from 'lucide-react';
import { format, subDays, startOfMonth, endOfMonth, isWithinInterval, isAfter, isBefore, startOfDay, endOfDay, eachMonthOfInterval } from 'date-fns';
import { cn } from '@/lib/utils';
import type { Database } from '@/integrations/supabase/types';
import type { DateRange } from 'react-day-picker';

type Profile = Database['public']['Tables']['profiles']['Row'];
type Property = Database['public']['Tables']['properties']['Row'];
type Booking = Database['public']['Tables']['bookings']['Row'];
type Review = Database['public']['Tables']['reviews']['Row'];

const PRESETS = [
  { key: 'last7', labelKey: 'admin.presets.last7', days: 7 },
  { key: 'last30', labelKey: 'admin.presets.last30', days: 30 },
  { key: 'last90', labelKey: 'admin.presets.last90', days: 90 },
  { key: 'last180', labelKey: 'admin.presets.last180', days: 180 },
  { key: 'lastYear', labelKey: 'admin.presets.lastYear', days: 365 },
  { key: 'allTime', labelKey: 'admin.presets.allTime', days: 0 },
];

export default function AdminDashboard() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { settings: platformSettings } = usePlatformSettings();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [bookings, setBookings] = useState<(Booking & { properties?: Property })[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [leaderboardSort, setLeaderboardSort] = useState<'revenue' | 'bookings' | 'rating'>('revenue');

  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 180),
    to: new Date(),
  });
  const [activePreset, setActivePreset] = useState('last180');

  const applyPreset = (preset: typeof PRESETS[number]) => {
    setActivePreset(preset.key);
    if (preset.days === 0) {
      setDateRange(undefined);
    } else {
      setDateRange({ from: subDays(new Date(), preset.days), to: new Date() });
    }
  };

  const fetchData = async () => {
    setIsLoading(true);
    const [p, pr, b, r] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('properties').select('*').order('created_at', { ascending: false }),
      supabase.from('bookings').select('*, properties(*)').order('created_at', { ascending: false }),
      supabase.from('reviews').select('*').order('created_at', { ascending: false }),
    ]);
    if (p.data) setProfiles(p.data);
    if (pr.data) setProperties(pr.data);
    if (b.data) setBookings(b.data as any);
    if (r.data) setReviews(r.data);
    setIsLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const inRange = (dateStr: string) => {
    if (!dateRange?.from) return true;
    const d = new Date(dateStr);
    const from = startOfDay(dateRange.from);
    const to = dateRange.to ? endOfDay(dateRange.to) : endOfDay(new Date());
    return !isBefore(d, from) && !isAfter(d, to);
  };

  const filteredBookings = useMemo(() => bookings.filter(b => inRange(b.created_at)), [bookings, dateRange]);
  const filteredProfiles = useMemo(() => profiles.filter(p => inRange(p.created_at)), [profiles, dateRange]);
  const filteredReviews = useMemo(() => reviews.filter(r => inRange(r.created_at)), [reviews, dateRange]);

  const updatePropertyStatus = async (propertyId: string, status: Database['public']['Enums']['property_status']) => {
    const { error } = await supabase.from('properties').update({ status }).eq('id', propertyId);
    if (!error) {
      await logAdminAction(status === 'active' ? 'approve' : 'reject', 'property', propertyId, { new_status: status });
      toast({ title: t('common.success'), description: t('admin.propertyUpdated') }); fetchData();
    }
  };

  const stats = useMemo(() => {
    const completedBookings = filteredBookings.filter(b => b.status === 'completed');
    const confirmedBookings = filteredBookings.filter(b => b.status === 'confirmed');
    const pendingBookings = filteredBookings.filter(b => b.status === 'pending');
    const cancelledBookings = filteredBookings.filter(b => b.status === 'cancelled');

    const totalRevenue = completedBookings.reduce((s, b) => s + Number(b.total_price), 0);
    const totalServiceFees = filteredBookings.reduce((s, b) => s + Number(b.service_fee || 0), 0);

    let totalPayouts = 0;
    let pendingPayouts = 0;
    let totalPlatformProfit = 0;

    if (platformSettings) {
      completedBookings.forEach(b => {
        const chargedTo = (b.properties?.service_fee_charged_to || 'guest') as 'guest' | 'host' | 'split';
        const fees = calculateFees(Number(b.subtotal), platformSettings, chargedTo);
        totalPayouts += fees.hostPayout;
        totalPlatformProfit += fees.platformRevenue;
      });
      confirmedBookings.forEach(b => {
        const chargedTo = (b.properties?.service_fee_charged_to || 'guest') as 'guest' | 'host' | 'split';
        const fees = calculateFees(Number(b.subtotal), platformSettings, chargedTo);
        pendingPayouts += fees.hostPayout;
      });
    }

    const convertible = filteredBookings.filter(b => b.status !== 'rejected');
    const converted = filteredBookings.filter(b => b.status === 'completed' || b.status === 'confirmed');
    const conversionRate = convertible.length > 0 ? Math.round((converted.length / convertible.length) * 100) : 0;

    const guestBookingCounts: Record<string, number> = {};
    bookings.forEach(b => {
      if (b.status === 'completed' || b.status === 'confirmed') {
        guestBookingCounts[b.guest_id] = (guestBookingCounts[b.guest_id] || 0) + 1;
      }
    });
    const totalBookingGuests = Object.keys(guestBookingCounts).length;
    const returningGuests = Object.values(guestBookingCounts).filter(c => c > 1).length;
    const retentionRate = totalBookingGuests > 0 ? Math.round((returningGuests / totalBookingGuests) * 100) : 0;

    const newGuestsInPeriod = filteredProfiles.filter(p => !p.is_host).length;
    const newHostsInPeriod = filteredProfiles.filter(p => p.is_host).length;

    return {
      totalGuests: profiles.filter(p => !p.is_host).length,
      totalHosts: profiles.filter(p => p.is_host).length,
      newGuestsInPeriod, newHostsInPeriod,
      totalRevenue, activeListings: properties.filter(p => p.status === 'active').length,
      totalBookings: filteredBookings.length, totalServiceFees,
      cancelledBookings: cancelledBookings.length, totalReviews: filteredReviews.length,
      pendingBookings: pendingBookings.length,
      pendingApproval: properties.filter(p => p.status === 'pending_approval').length,
      totalPayouts, pendingPayouts, totalPlatformProfit,
      conversionRate, retentionRate, returningGuests, totalBookingGuests,
    };
  }, [profiles, properties, filteredBookings, filteredProfiles, filteredReviews, bookings, platformSettings]);

  // Leaderboard data
  const leaderboard = useMemo(() => {
    return properties.map(prop => {
      const propBookings = filteredBookings.filter(b => b.property_id === prop.id);
      const completedBookings = propBookings.filter(b => b.status === 'completed');
      const revenue = completedBookings.reduce((s, b) => s + Number(b.total_price), 0);
      const propReviews = filteredReviews.filter(r => r.property_id === prop.id);
      const avgRating = propReviews.length > 0 ? propReviews.reduce((s, r) => s + r.overall_rating, 0) / propReviews.length : Number(prop.average_rating || 0);
      const host = profiles.find(p => p.user_id === prop.host_id);
      return {
        id: prop.id, title: prop.title, city: prop.city, country: prop.country,
        coverImage: prop.cover_image, hostName: host?.full_name || 'Unknown',
        revenue, totalBookings: propBookings.length, avgRating,
        reviewCount: propReviews.length, status: prop.status,
      };
    }).sort((a, b) => {
      if (leaderboardSort === 'revenue') return b.revenue - a.revenue;
      if (leaderboardSort === 'bookings') return b.totalBookings - a.totalBookings;
      return b.avgRating - a.avgRating;
    }).slice(0, 10);
  }, [properties, filteredBookings, filteredReviews, profiles, leaderboardSort]);

  // Chart data
  const chartData = useMemo(() => {
    if (!platformSettings) return [];
    const from = dateRange?.from || new Date(2020, 0, 1);
    const to = dateRange?.to || new Date();
    const months = eachMonthOfInterval({ start: from, end: to });

    return months.map(monthDate => {
      const mStart = startOfMonth(monthDate);
      const mEnd = endOfMonth(monthDate);
      const label = format(monthDate, 'MMM yy');
      let revenue = 0, payouts = 0, profit = 0, pending = 0;

      bookings.forEach(b => {
        const bDate = new Date(b.created_at);
        if (!isWithinInterval(bDate, { start: mStart, end: mEnd })) return;
        const chargedTo = (b.properties?.service_fee_charged_to || 'guest') as 'guest' | 'host' | 'split';
        if (b.status === 'completed') {
          const fees = calculateFees(Number(b.subtotal), platformSettings, chargedTo);
          revenue += Number(b.total_price); payouts += fees.hostPayout; profit += fees.platformRevenue;
        } else if (b.status === 'confirmed') {
          const fees = calculateFees(Number(b.subtotal), platformSettings, chargedTo);
          pending += fees.hostPayout;
        }
      });

      return { month: label, revenue: Math.round(revenue * 100) / 100, payouts: Math.round(payouts * 100) / 100, profit: Math.round(profit * 100) / 100, pending: Math.round(pending * 100) / 100 };
    });
  }, [bookings, platformSettings, dateRange]);

  const chartConfig = {
    revenue: { label: 'Total Revenue', color: 'hsl(var(--primary))' },
    payouts: { label: 'Host Payouts', color: 'hsl(142, 76%, 36%)' },
    profit: { label: 'Platform Profit', color: 'hsl(47, 100%, 50%)' },
    pending: { label: 'Pending Payouts', color: 'hsl(38, 92%, 50%)' },
  };

  // CSV Export
  const exportCSV = () => {
    const periodLabel = dateRange?.from ? `${format(dateRange.from, 'yyyy-MM-dd')}_to_${format(dateRange.to || new Date(), 'yyyy-MM-dd')}` : 'all_time';

    const rows = [
      ['Metric', 'Value'],
      ['Period', periodLabel.replace(/_/g, ' ')],
      ['Registered Guests', stats.totalGuests],
      ['Registered Hosts', stats.totalHosts],
      ['New Guests (Period)', stats.newGuestsInPeriod],
      ['New Hosts (Period)', stats.newHostsInPeriod],
      ['Total Revenue', stats.totalRevenue.toFixed(2)],
      ['Active Listings', stats.activeListings],
      ['Total Bookings', stats.totalBookings],
      ['Total Service Fees', stats.totalServiceFees.toFixed(2)],
      ['Cancelled Bookings', stats.cancelledBookings],
      ['Total Reviews', stats.totalReviews],
      ['Pending Bookings', stats.pendingBookings],
      ['Total Host Payouts', stats.totalPayouts.toFixed(2)],
      ['Pending Payouts', stats.pendingPayouts.toFixed(2)],
      ['Platform Profit', stats.totalPlatformProfit.toFixed(2)],
      ['Booking Conversion Rate', `${stats.conversionRate}%`],
      ['Guest Retention Rate', `${stats.retentionRate}%`],
      [''],
      ['--- Monthly Breakdown ---'],
      ['Month', 'Revenue', 'Host Payouts', 'Platform Profit', 'Pending Payouts'],
      ...chartData.map(d => [d.month, d.revenue, d.payouts, d.profit, d.pending]),
      [''],
      ['--- Top Properties ---'],
      ['Rank', 'Property', 'City', 'Host', 'Revenue', 'Bookings', 'Avg Rating'],
      ...leaderboard.map((p, i) => [i + 1, p.title, `${p.city}, ${p.country}`, p.hostName, p.revenue.toFixed(2), p.totalBookings, p.avgRating.toFixed(1)]),
    ];

    const csv = rows.map(r => Array.isArray(r) ? r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',') : r).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `dashboard_report_${periodLabel}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Exported', description: 'Dashboard report downloaded as CSV' });
  };

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="animate-pulse space-y-8">
          <div className="h-8 bg-muted rounded w-1/3" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(9)].map((_, i) => <div key={i} className="h-28 bg-muted rounded-xl" />)}
          </div>
        </div>
      </AdminLayout>
    );
  }

  const fmtMoney = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const inPeriod = (n: number) => t('admin.dashboard.inPeriod', { count: n });
  const summaryCards = [
    { label: t('admin.dashboard.registeredGuests'), value: stats.totalGuests, sub: `+${stats.newGuestsInPeriod} ${inPeriod(stats.newGuestsInPeriod)}`, icon: Users, color: 'text-primary', bg: 'bg-primary/10' },
    { label: t('admin.dashboard.registeredHosts'), value: stats.totalHosts, sub: `+${stats.newHostsInPeriod} ${inPeriod(stats.newHostsInPeriod)}`, icon: UserCheck, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
    { label: t('admin.metrics.totalRevenue'), value: fmtMoney(stats.totalRevenue), sub: '', icon: DollarSign, color: 'text-green-500', bg: 'bg-green-500/10' },
    { label: t('admin.metrics.activeListings'), value: stats.activeListings, sub: '', icon: Home, color: 'text-primary', bg: 'bg-primary/10' },
    { label: t('admin.metrics.totalBookings'), value: stats.totalBookings, sub: '', icon: CalendarIcon, color: 'text-blue-500', bg: 'bg-blue-500/10' },
    { label: t('admin.metrics.serviceFees'), value: fmtMoney(stats.totalServiceFees), sub: '', icon: Percent, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
    { label: t('admin.dashboard.cancelledBookings'), value: stats.cancelledBookings, sub: '', icon: XCircle, color: 'text-destructive', bg: 'bg-destructive/10' },
    { label: t('admin.metrics.reviews'), value: stats.totalReviews, sub: '', icon: Star, color: 'text-amber-500', bg: 'bg-amber-500/10' },
    { label: t('admin.metrics.pendingBookings'), value: stats.pendingBookings, sub: '', icon: Clock, color: 'text-orange-500', bg: 'bg-orange-500/10' },
  ];

  const medalColors = ['text-amber-500', 'text-slate-400', 'text-orange-600'];

  return (
    <AdminLayout>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-3xl font-bold">{t('admin.dashboard.title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {dateRange?.from ? (
              <>{t('admin.dashboard.showingFromTo', { from: format(dateRange.from, 'MMM d, yyyy'), to: format(dateRange.to || new Date(), 'MMM d, yyyy') })}</>
            ) : t('admin.dashboard.showingAllTime')}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {PRESETS.map(p => (
            <Button key={p.key} size="sm" variant={activePreset === p.key ? 'default' : 'outline'} className="text-xs h-8" onClick={() => applyPreset(p)}>
              {t(p.labelKey)}
            </Button>
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="text-xs h-8 gap-1.5">
                <CalendarIcon className="w-3.5 h-3.5" /> {t('admin.presets.custom')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar mode="range" selected={dateRange} onSelect={(range) => { setDateRange(range); setActivePreset(''); }} numberOfMonths={2} className={cn("p-3 pointer-events-auto")} />
            </PopoverContent>
          </Popover>
          <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1.5 h-8 text-xs">
            <Download className="w-3.5 h-3.5" /> {t('admin.exportCsv')}
          </Button>
          <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5 h-8">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Summary Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-4 mb-8">
        {summaryCards.map(item => (
          <Card key={item.label} className="card-luxury">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">{item.label}</p>
                  <p className="font-display text-2xl font-bold mt-1">{item.value}</p>
                  {item.sub && <p className="text-[11px] text-muted-foreground mt-0.5">{item.sub}</p>}
                </div>
                <div className={`w-10 h-10 rounded-xl ${item.bg} flex items-center justify-center`}>
                  <item.icon className={`w-5 h-5 ${item.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Conversion & Retention */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card className="card-luxury border-blue-500/20">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center"><Target className="w-5 h-5 text-blue-500" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Booking Conversion Rate</p>
                <p className="font-display text-xl font-bold text-blue-500">{stats.conversionRate}%</p>
                <p className="text-[10px] text-muted-foreground">Confirmed+Completed / Total</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="card-luxury border-violet-500/20">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center"><Repeat className="w-5 h-5 text-violet-500" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Guest Retention Rate</p>
                <p className="font-display text-xl font-bold text-violet-500">{stats.retentionRate}%</p>
                <p className="text-[10px] text-muted-foreground">{stats.returningGuests} returning of {stats.totalBookingGuests} guests</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="card-luxury border-teal-500/20">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-teal-500/10 flex items-center justify-center"><UserPlus className="w-5 h-5 text-teal-500" /></div>
              <div>
                <p className="text-xs text-muted-foreground">New Users (Period)</p>
                <p className="font-display text-xl font-bold text-teal-500">{stats.newGuestsInPeriod + stats.newHostsInPeriod}</p>
                <p className="text-[10px] text-muted-foreground">{stats.newGuestsInPeriod} guests, {stats.newHostsInPeriod} hosts</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Financial Highlights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card className="card-luxury border-green-500/20">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center"><Banknote className="w-5 h-5 text-green-500" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Total Host Payouts</p>
                <p className="font-display text-xl font-bold text-green-500">{fmtMoney(stats.totalPayouts)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="card-luxury border-orange-500/20">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center"><Clock className="w-5 h-5 text-orange-500" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Pending Payouts</p>
                <p className="font-display text-xl font-bold text-orange-500">{fmtMoney(stats.pendingPayouts)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="card-luxury border-primary/20">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><TrendingUp className="w-5 h-5 text-primary" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Platform Profit</p>
                <p className="font-display text-xl font-bold text-primary">{fmtMoney(stats.totalPlatformProfit)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Card className="card-luxury">
          <CardHeader className="pb-2"><CardTitle className="text-base font-display">Revenue vs Payouts</CardTitle></CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[280px] w-full">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" tickFormatter={(v) => `$${v}`} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="payouts" fill="var(--color-payouts)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="pending" fill="var(--color-pending)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
        <Card className="card-luxury">
          <CardHeader className="pb-2"><CardTitle className="text-base font-display">Platform Profit Trend</CardTitle></CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[280px] w-full">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-profit)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--color-profit)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" tickFormatter={(v) => `$${v}`} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area type="monotone" dataKey="profit" stroke="var(--color-profit)" fill="url(#profitGradient)" strokeWidth={2} />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Top-Performing Properties Leaderboard */}
      <Card className="card-luxury mb-8">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-500" />
              <h2 className="font-display text-lg font-bold">Top-Performing Properties</h2>
            </div>
            <div className="flex gap-1">
              {(['revenue', 'bookings', 'rating'] as const).map(s => (
                <Button key={s} size="sm" variant={leaderboardSort === s ? 'default' : 'outline'} className="text-xs h-7 capitalize" onClick={() => setLeaderboardSort(s)}>
                  {s === 'rating' ? 'Rating' : s === 'revenue' ? 'Revenue' : 'Bookings'}
                </Button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Rank</TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Bookings</TableHead>
                  <TableHead className="text-right">Avg Rating</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leaderboard.map((prop, i) => (
                  <TableRow key={prop.id}>
                    <TableCell>
                      {i < 3 ? <Medal className={`w-5 h-5 ${medalColors[i]}`} /> : <span className="text-sm text-muted-foreground font-medium">{i + 1}</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <img src={prop.coverImage || '/placeholder.svg'} alt={prop.title} className="w-10 h-8 rounded object-cover flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium truncate max-w-[200px]">{prop.title}</p>
                          <p className="text-[11px] text-muted-foreground">{prop.city}, {prop.country}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{prop.hostName}</TableCell>
                    <TableCell className="text-right text-sm font-semibold">{fmtMoney(prop.revenue)}</TableCell>
                    <TableCell className="text-right text-sm">{prop.totalBookings}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Star className="w-3.5 h-3.5 text-rating fill-rating" />
                        <span className="text-sm font-bold text-rating">{prop.avgRating.toFixed(1)}</span>
                        {prop.reviewCount > 0 && <span className="text-[10px] font-bold text-rating">({prop.reviewCount})</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={
                        prop.status === 'active' ? 'bg-green-500/10 text-green-500 border-green-500/30' :
                        prop.status === 'pending_approval' ? 'bg-amber-500/10 text-amber-500 border-amber-500/30' :
                        'bg-muted text-muted-foreground border-border'
                      }>{prop.status.replace('_', ' ')}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {leaderboard.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No properties found</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Pending Approvals */}
      {stats.pendingApproval > 0 && (
        <Card className="card-luxury mb-8">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <h2 className="font-display text-lg font-bold">Pending Approvals</h2>
              <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/30">{stats.pendingApproval}</Badge>
            </div>
            <div className="space-y-3">
              {properties.filter(p => p.status === 'pending_approval').slice(0, 5).map(prop => (
                <div key={prop.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="flex items-center gap-3">
                    <img src={prop.cover_image || '/placeholder.svg'} alt={prop.title} className="w-12 h-8 rounded object-cover" />
                    <div>
                      <p className="text-sm font-medium">{prop.title}</p>
                      <p className="text-xs text-muted-foreground">{prop.city}, {prop.country}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="btn-gold gap-1 h-7 text-xs" onClick={() => updatePropertyStatus(prop.id, 'active')}>
                      <Check className="w-3 h-3" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1 h-7 text-xs text-destructive" onClick={() => updatePropertyStatus(prop.id, 'rejected')}>
                      <X className="w-3 h-3" /> Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="card-luxury">
          <CardContent className="p-6">
            <h2 className="font-display text-lg font-bold mb-4">Recent Bookings</h2>
            <div className="space-y-3">
              {filteredBookings.slice(0, 5).map(b => (
                <div key={b.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div>
                    <p className="text-sm font-medium">#{b.id.slice(0, 8)}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(b.created_at), 'MMM d, yyyy')}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold">${Number(b.total_price).toLocaleString()}</p>
                    <Badge className={
                      b.status === 'completed' ? 'bg-green-500/10 text-green-500 border-green-500/30' :
                      b.status === 'pending' ? 'bg-amber-500/10 text-amber-500 border-amber-500/30' :
                      b.status === 'cancelled' ? 'bg-destructive/10 text-destructive border-destructive/30' :
                      'bg-muted text-muted-foreground border-border'
                    }>{b.status}</Badge>
                  </div>
                </div>
              ))}
              {filteredBookings.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No bookings in this period</p>}
            </div>
          </CardContent>
        </Card>
        <Card className="card-luxury">
          <CardContent className="p-6">
            <h2 className="font-display text-lg font-bold mb-4">Recent Users</h2>
            <div className="space-y-3">
              {filteredProfiles.slice(0, 5).map(p => (
                <div key={p.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-xs font-bold text-primary">{(p.full_name || p.email)?.[0]?.toUpperCase()}</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium">{p.full_name || 'Unknown'}</p>
                      <p className="text-xs text-muted-foreground">{p.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.is_host && <Badge className="bg-primary/10 text-primary border-primary/30 text-[10px]">Host</Badge>}
                    {p.is_verified && <Check className="w-3.5 h-3.5 text-green-500" />}
                  </div>
                </div>
              ))}
              {filteredProfiles.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No users in this period</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
