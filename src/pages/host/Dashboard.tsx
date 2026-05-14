import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { usePlatformSettings, formatBookingId } from '@/hooks/usePlatformSettings';
import { useTranslation } from 'react-i18next';
import { Layout } from '@/components/layout/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import {
  Home, DollarSign, Calendar, Star, Plus, Settings, BarChart3,
  Eye, Edit, Trash2, MoreHorizontal, LayoutGrid, LayoutList,
  Info, ArrowUp, ArrowDown, ArrowUpDown, MapPin, Users, Moon, CreditCard
} from 'lucide-react';
import { useViewMode } from '@/hooks/useViewMode';
import { usePayoutTiers } from '@/hooks/usePayoutTiers';
import { Progress } from '@/components/ui/progress';
import { Gift } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import type { Database } from '@/integrations/supabase/types';

type Property = Database['public']['Tables']['properties']['Row'];
type Booking = Database['public']['Tables']['bookings']['Row'];

const GRADUATION_FLAG_KEY = 'hostly_graduation_celebrated';

export default function HostDashboard() {
  const { user, isHost, profile } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { settings: platformSettings } = usePlatformSettings();
  const { config: payoutConfig } = usePayoutTiers();
  const [properties, setProperties] = useState<Property[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [stats, setStats] = useState({
    totalProperties: 0,
    activeListings: 0,
    totalBookings: 0,
    totalEarnings: 0,
    pendingBookings: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useViewMode('host_properties', 'grid', ['row', 'grid', 'card'] as const);
  // Sorting + details drawer for Client Reservations
  type SortKey = 'total_price' | 'check_in_date' | 'num_nights' | 'num_guests';
  const [sortKey, setSortKey] = useState<SortKey>('check_in_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [detailsBooking, setDetailsBooking] = useState<Booking | null>(null);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'total_price' || key === 'num_nights' || key === 'num_guests' ? 'desc' : 'asc');
    }
  };

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }

    if (!isHost && profile) {
      navigate('/become-host');
      return;
    }

    fetchData();
  }, [user, isHost, profile, navigate]);

  // Realtime: refresh when a booking for this host is inserted/updated/deleted
  // so new reservations appear instantly without a page refresh.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`host-dashboard-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `host_id=eq.${user.id}` },
        () => fetchData()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'properties', filter: `host_id=eq.${user.id}` },
        () => fetchData()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const fetchData = async () => {
    if (!user) return;

    setIsLoading(true);

    const { data: propertiesData } = await supabase
      .from('properties')
      .select('*')
      .eq('host_id', user.id)
      .order('created_at', { ascending: false });

    if (propertiesData) {
      setProperties(propertiesData);
    }

    const { data: bookingsData } = await supabase
      .from('bookings')
      .select('*')
      .eq('host_id', user.id)
      .order('created_at', { ascending: false });

    if (bookingsData) {
      setBookings(bookingsData);
      
      const totalEarnings = bookingsData
        .filter((b) => b.status === 'completed')
        .reduce((sum, b) => sum + Number(b.total_price), 0);

      const pendingBookings = bookingsData.filter(
        (b) => b.status === 'pending'
      ).length;

      setStats({
        totalProperties: propertiesData?.length || 0,
        activeListings: propertiesData?.filter((p) => p.status === 'active').length || 0,
        totalBookings: bookingsData.length,
        totalEarnings,
        pendingBookings,
      });

      // 🎉 Graduation celebration — fire ONCE when host crosses the free-bookings threshold.
      const eligible = bookingsData.filter(
        (b) => b.status === 'confirmed' || b.status === 'completed'
      ).length;
      const free = payoutConfig.starter_free_bookings;
      const flagKey = `${GRADUATION_FLAG_KEY}_${user.id}`;
      if (eligible >= free && !localStorage.getItem(flagKey)) {
        localStorage.setItem(flagKey, '1');
        toast({
          title: '🎉 Congratulations — you graduated!',
          description: `You've completed your first ${free} bookings with 0% commission. From now on, the standard ${payoutConfig.standard_pct}% commission applies. Thank you for hosting with Hostiva!`,
          duration: 10000,
        });
        // Drop an in-app notification so it persists in the bell.
        supabase.from('notification_log').insert({
          user_id: user.id,
          channel: 'in_app',
          event_type: 'host_graduation',
          subject: '🎉 You graduated to standard commission',
          body: `Congratulations! You've completed your first ${free} confirmed bookings with 0% commission. The standard ${payoutConfig.standard_pct}% commission applies going forward.`,
          status: 'sent',
          sent_at: new Date().toISOString(),
        }).then(() => {});
      }
    }

    setIsLoading(false);
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { className: string; labelKey: string }> = {
      active: { className: 'bg-green-500/10 text-green-500 border-green-500/30', labelKey: 'hostDashboard.status.active' },
      draft: { className: 'bg-muted text-muted-foreground border-border', labelKey: 'hostDashboard.status.draft' },
      pending_approval: { className: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30', labelKey: 'hostDashboard.status.pending' },
      inactive: { className: 'bg-muted text-muted-foreground border-border', labelKey: 'hostDashboard.status.inactive' },
      rejected: { className: 'bg-destructive/10 text-destructive border-destructive/30', labelKey: 'hostDashboard.status.rejected' },
    };
    const variant = variants[status] || variants.draft;
    return <Badge className={variant.className}>{t(variant.labelKey)}</Badge>;
  };

  const getBookingStatusBadge = (status: string) => {
    const variants: Record<string, { className: string; labelKey: string }> = {
      pending: { className: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30', labelKey: 'bookings.status.pending' },
      confirmed: { className: 'bg-green-500/10 text-green-500 border-green-500/30', labelKey: 'bookings.status.confirmed' },
      completed: { className: 'bg-primary/10 text-primary border-primary/30', labelKey: 'bookings.status.completed' },
      cancelled: { className: 'bg-destructive/10 text-destructive border-destructive/30', labelKey: 'bookings.status.cancelled' },
      rejected: { className: 'bg-muted text-muted-foreground border-border', labelKey: 'bookings.status.rejected' },
    };
    const variant = variants[status] || variants.pending;
    return <Badge className={variant.className}>{t(variant.labelKey)}</Badge>;
  };

  // Derive the displayed status. Once payment has succeeded (booking is created
  // as `confirmed` / `in_progress`), the host should always see at least
  // "Confirmed". The badge only flips to "Completed" once the scheduled
  // checkout time has passed — mirroring the lifecycle on BookingConfirmation.
  const getDisplayStatus = (booking: { status: string; check_out_date: string }) => {
    if (booking.status === 'cancelled' || booking.status === 'rejected') return booking.status;
    if (booking.status === 'completed') return 'completed';
    const checkOutPassed =
      new Date(`${booking.check_out_date}T11:00:00Z`).getTime() < Date.now();
    if (checkOutPassed && (booking.status === 'confirmed' || booking.status === 'in_progress')) {
      return 'completed';
    }
    // Anything else paid/active → always show as Confirmed
    return 'confirmed';
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <div className="animate-pulse space-y-8">
            <div className="h-8 bg-muted rounded w-1/3" />
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-32 bg-muted rounded-xl" />
              ))}
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="font-display text-3xl font-bold mb-2">{t('hostDashboard.title')}</h1>
            <p className="text-muted-foreground">
              {t('hostDashboard.subtitle')}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => navigate('/host/financial-books')}>
              <DollarSign className="w-4 h-4 mr-2" />
              {t('hostDashboard.financialBooks')}
            </Button>
            <Button className="btn-gold" onClick={() => navigate('/host/properties/new')}>
              <Plus className="w-4 h-4 mr-2" />
              {t('hostDashboard.addProperty')}
            </Button>
          </div>
        </div>

        {/* Welcome — free bookings remaining */}
        {(() => {
          const eligible = bookings.filter(b => b.status === 'confirmed' || b.status === 'completed').length;
          const free = payoutConfig.starter_free_bookings;
          if (eligible >= free) return null;
          const remaining = free - eligible;
          const pct = Math.round((eligible / free) * 100);
          return (
            <Card className="card-luxury mb-8 border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Gift className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                      <h3 className="font-display text-lg font-semibold">
                        Welcome — {remaining} free booking{remaining === 1 ? '' : 's'} remaining
                      </h3>
                      <Badge className="bg-primary/10 text-primary border-primary/30">0% commission</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      You keep 100% of the subtotal on your first {free} confirmed bookings. After that, the standard {payoutConfig.standard_pct}% commission applies.
                    </p>
                    <Progress value={pct} className="h-2" />
                    <p className="text-xs text-muted-foreground mt-2">{eligible} of {free} used</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="card-luxury">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{t('hostDashboard.totalProperties')}</p>
                  <p className="font-display text-3xl font-bold">{stats.totalProperties}</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Home className="w-6 h-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="card-luxury">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{t('hostDashboard.totalBookings')}</p>
                  <p className="font-display text-3xl font-bold">{stats.totalBookings}</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Calendar className="w-6 h-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="card-luxury">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{t('hostDashboard.totalEarnings')}</p>
                  <p className="font-display text-3xl font-bold">
                    ${stats.totalEarnings.toLocaleString()}
                  </p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <DollarSign className="w-6 h-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="card-luxury">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{t('hostDashboard.pendingBookings')}</p>
                  <p className="font-display text-3xl font-bold">{stats.pendingBookings}</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-yellow-500/10 flex items-center justify-center">
                  <BarChart3 className="w-6 h-6 text-yellow-500" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="properties">
          <TabsList className="mb-6">
            <TabsTrigger value="properties">{t('hostDashboard.myProperties')}</TabsTrigger>
            <TabsTrigger value="bookings">Client Reservations</TabsTrigger>
          </TabsList>

          <TabsContent value="properties">
            {properties.length > 0 ? (
              <div>
                {/* View toggle */}
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm text-muted-foreground">{properties.length} {properties.length === 1 ? 'property' : 'properties'}</p>
                  <div className="flex items-center border border-border rounded-lg overflow-hidden">
                    <button
                      onClick={() => setViewMode('row')}
                      className={`p-2 transition-colors ${viewMode === 'row' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-accent'}`}
                    >
                      <LayoutList className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setViewMode('grid')}
                      className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-accent'}`}
                    >
                      <LayoutGrid className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setViewMode('card')}
                      title="Compact"
                      className={`p-2 transition-colors border-l border-border ${viewMode === 'card' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-accent'}`}
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {viewMode !== 'row' ? (
                  <div className={
                    viewMode === 'card'
                      ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4'
                      : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6'
                  }>
                    {properties.map((property) => (
                      <Card key={property.id} className="card-luxury overflow-hidden group cursor-pointer" onClick={() => navigate(`/property/${property.id}`)}>
                        <div className="aspect-[4/3] overflow-hidden">
                          <img
                            src={property.cover_image || '/placeholder.svg'}
                            alt={property.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        </div>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-1">
                            <h3 className="font-display font-semibold text-foreground truncate">{property.title}</h3>
                            {getStatusBadge(property.status)}
                          </div>
                          <p className="text-sm text-muted-foreground mb-2">{property.city}, {property.country}</p>
                          <p className="text-rating font-bold">${Number(property.price_per_night)}<span className="text-sm font-normal text-rating/80">/night</span></p>
                          <div className="flex gap-2 mt-3">
                            <Button variant="outline" size="sm" className="flex-1" onClick={(e) => { e.stopPropagation(); navigate(`/property/${property.id}`); }}>
                              <Eye className="w-3.5 h-3.5 mr-1" /> View
                            </Button>
                            <Button variant="outline" size="sm" className="flex-1" onClick={(e) => { e.stopPropagation(); navigate(`/host/properties/${property.id}/edit`); }}>
                              <Edit className="w-3.5 h-3.5 mr-1" /> Edit
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {properties.map((property) => (
                      <Card key={property.id} className="card-luxury overflow-hidden">
                        <CardContent className="p-0">
                          <div className="flex flex-col md:flex-row">
                            {/* Image - 50% */}
                            <div className="w-full md:w-1/2 h-48 md:h-auto md:min-h-[220px] overflow-hidden cursor-pointer" onClick={() => navigate(`/property/${property.id}`)}>
                              <img
                                src={property.cover_image || '/placeholder.svg'}
                                alt={property.title}
                                className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                              />
                            </div>
                            {/* Details - 50% */}
                            <div className="w-full md:w-1/2 p-5 flex flex-col justify-between">
                              <div>
                                <div className="flex items-start justify-between mb-2">
                                  <h3
                                    className="font-display text-lg font-semibold text-foreground hover:text-primary cursor-pointer transition-colors"
                                    onClick={() => navigate(`/property/${property.id}`)}
                                  >
                                    {property.title}
                                  </h3>
                                  {getStatusBadge(property.status)}
                                </div>
                                <p className="text-sm text-muted-foreground mb-3">{property.address}, {property.city}, {property.country}</p>
                                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mb-3">
                                  <span>{property.bedrooms} bed{property.bedrooms !== 1 ? 's' : ''}</span>
                                  <span>•</span>
                                  <span>{Number(property.bathrooms)} bath</span>
                                  <span>•</span>
                                  <span>{property.max_guests} guest{property.max_guests !== 1 ? 's' : ''}</span>
                                </div>
                                <p className="text-rating font-extrabold text-lg">${Number(property.price_per_night)}<span className="text-sm font-normal text-rating/80">/night</span></p>

                                <div className="flex items-center gap-3 mt-3">
                                  <span className="text-sm text-muted-foreground whitespace-nowrap">{t('hostDashboard.serviceFeePaidBy')}</span>
                                  <Select
                                    value={property.service_fee_charged_to || 'guest'}
                                    onValueChange={async (value: 'guest' | 'host' | 'split') => {
                                      const { error } = await supabase
                                        .from('properties')
                                        .update({ service_fee_charged_to: value })
                                        .eq('id', property.id);
                                      if (error) {
                                        toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
                                      } else {
                                        setProperties(prev => prev.map(p => p.id === property.id ? { ...p, service_fee_charged_to: value } : p));
                                        toast({ title: t('hostDashboard.updated'), description: t('hostDashboard.feeAllocationSaved') });
                                      }
                                    }}
                                  >
                                    <SelectTrigger className="w-[140px] h-8 text-sm">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="guest">{t('hostDashboard.feeGuest')}</SelectItem>
                                      <SelectItem value="host">{t('hostDashboard.feeHost')}</SelectItem>
                                      <SelectItem value="split">{t('hostDashboard.feeSplit')}</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border">
                                <Button variant="outline" size="sm" onClick={() => navigate(`/property/${property.id}`)}>
                                  <Eye className="w-4 h-4 mr-1" /> {t('hostDashboard.view')}
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => navigate(`/host/properties/${property.id}/edit`)}>
                                  <Edit className="w-4 h-4 mr-1" /> {t('hostDashboard.edit')}
                                </Button>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="sm">
                                      <MoreHorizontal className="w-4 h-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem>
                                      <Calendar className="w-4 h-4 mr-2" /> {t('hostDashboard.manageCalendar')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem>
                                      <Settings className="w-4 h-4 mr-2" /> {t('hostDashboard.settings')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem className="text-destructive">
                                      <Trash2 className="w-4 h-4 mr-2" /> {t('hostDashboard.delete')}
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="card-luxury text-center py-16">
                <Home className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-display text-xl font-semibold mb-2">
                  {t('hostDashboard.noProperties')}
                </h3>
                <p className="text-muted-foreground mb-6">
                  {t('hostDashboard.startHosting')}
                </p>
                <Button className="btn-gold" onClick={() => navigate('/host/properties/new')}>
                  <Plus className="w-4 h-4 mr-2" />
                  {t('hostDashboard.addProperty')}
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="bookings">
            {(() => {
              // Show only ACTIVE reservations: confirmed (upcoming) and in_progress (currently staying)
              const filtered = bookings.filter(
                (b) => b.status === 'confirmed' || b.status === 'in_progress'
              );
              const visibleBookings = [...filtered].sort((a, b) => {
                let av: number; let bv: number;
                if (sortKey === 'check_in_date') {
                  av = new Date(a.check_in_date).getTime();
                  bv = new Date(b.check_in_date).getTime();
                } else {
                  av = Number(a[sortKey]);
                  bv = Number(b[sortKey]);
                }
                return sortDir === 'asc' ? av - bv : bv - av;
              });
              const propertyById = new Map(properties.map((p) => [p.id, p]));
              const SortHeader = ({ k, label, className }: { k: SortKey; label: string; className?: string }) => {
                const active = sortKey === k;
                const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
                return (
                  <button
                    type="button"
                    onClick={() => toggleSort(k)}
                    className={`flex items-center gap-1 hover:text-foreground transition-colors ${active ? 'text-foreground' : ''} ${className ?? ''}`}
                  >
                    {label}
                    <Icon className="w-3 h-3" />
                  </button>
                );
              };
              return visibleBookings.length > 0 ? (
              <div className="space-y-3">
                {/* Header row */}
                <div className="flex items-center gap-3 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-border">
                  <span className="w-6 shrink-0">#</span>
                  <span className="w-20 shrink-0">Status</span>
                  <span className="w-28 shrink-0">Booking ID</span>
                  <span className="flex-1 min-w-[160px]">Property</span>
                  <SortHeader k="check_in_date" label="Dates" className="w-48 shrink-0" />
                  <SortHeader k="num_nights" label="Nights" className="w-16 shrink-0" />
                  <SortHeader k="num_guests" label="Guests" className="w-20 shrink-0" />
                  <SortHeader k="total_price" label="Total" className="w-24 shrink-0 justify-end" />
                  <span className="w-20 shrink-0 text-right">Actions</span>
                </div>
                {visibleBookings.map((booking) => {
                  const bookingCode = formatBookingId(
                    booking.id,
                    platformSettings?.booking_id_prefix,
                    platformSettings?.booking_id_length
                  );
                  const prop = propertyById.get(booking.property_id);
                  return (
                  <Card key={booking.id} className="card-luxury">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-3 flex-nowrap overflow-x-auto text-sm whitespace-nowrap">
                        <span className="w-6 shrink-0 text-muted-foreground font-mono">{visibleBookings.indexOf(booking) + 1}</span>
                        <span className="w-20 shrink-0">{getBookingStatusBadge(getDisplayStatus(booking))}</span>
                        <Link to={`/booking-confirmation/${booking.id}`} className="w-28 shrink-0">
                          <Badge
                            variant="outline"
                            className="text-xs font-mono cursor-pointer hover:bg-primary/10 hover:border-primary/50 transition-colors"
                          >
                            {bookingCode}
                          </Badge>
                        </Link>
                        <span className="flex-1 min-w-[160px] font-medium text-foreground truncate" title={prop?.title}>
                          {prop?.title ?? '—'}
                        </span>
                        <span className="w-48 shrink-0 text-muted-foreground">
                          {format(new Date(booking.check_in_date), 'MMM d')} – {format(new Date(booking.check_out_date), 'MMM d, yyyy')}
                        </span>
                        <span className="w-16 shrink-0 text-muted-foreground">{booking.num_nights}</span>
                        <span className="w-20 shrink-0 text-muted-foreground">{booking.num_guests} guest{booking.num_guests === 1 ? '' : 's'}</span>
                        <span className="w-24 shrink-0 text-right font-display font-bold text-primary">
                          ${Number(booking.total_price).toLocaleString()}
                        </span>
                        <span className="w-20 shrink-0 flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="View confirmation"
                            onClick={() => navigate(`/booking-confirmation/${booking.id}`)}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Open details"
                            onClick={() => setDetailsBooking(booking)}
                          >
                            <Info className="w-4 h-4" />
                          </Button>
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                  );
                })}
              </div>
            ) : (
              <div className="card-luxury text-center py-16">
                <Calendar className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-display text-xl font-semibold mb-2">
                  {t('hostDashboard.noBookings')}
                </h3>
                <p className="text-muted-foreground">
                  {t('hostDashboard.noBookingsDesc')}
                </p>
              </div>
            );
            })()}
          </TabsContent>
        </Tabs>

        {/* Reservation details drawer */}
        <Sheet open={!!detailsBooking} onOpenChange={(open) => !open && setDetailsBooking(null)}>
          <SheetContent className="w-full sm:max-w-md overflow-y-auto">
            {detailsBooking && (() => {
              const prop = properties.find((p) => p.id === detailsBooking.property_id);
              const code = formatBookingId(
                detailsBooking.id,
                platformSettings?.booking_id_prefix,
                platformSettings?.booking_id_length
              );
              return (
                <>
                  <SheetHeader>
                    <SheetTitle className="flex items-center gap-2">
                       Reservation Details
                       {getBookingStatusBadge(getDisplayStatus(detailsBooking))}
                    </SheetTitle>
                    <SheetDescription className="font-mono text-xs">{code}</SheetDescription>
                  </SheetHeader>

                  <div className="mt-6 space-y-5">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Property</p>
                      <p className="font-medium">{prop?.title ?? '—'}</p>
                      {prop && (
                        <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                          <MapPin className="w-3.5 h-3.5" />{prop.city}, {prop.country}
                        </p>
                      )}
                    </div>

                    <Separator />

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Check-in</p>
                        <p className="font-medium">{format(new Date(detailsBooking.check_in_date), 'EEE, MMM d, yyyy')}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Check-out</p>
                        <p className="font-medium">{format(new Date(detailsBooking.check_out_date), 'EEE, MMM d, yyyy')}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1"><Moon className="w-3 h-3" /> Nights</p>
                        <p className="font-medium">{detailsBooking.num_nights}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1"><Users className="w-3 h-3" /> Guests</p>
                        <p className="font-medium">{detailsBooking.num_guests}</p>
                      </div>
                    </div>

                    <Separator />

                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Nightly rate</span>
                        <span>${Number(detailsBooking.nightly_rate).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Subtotal</span>
                        <span>${Number(detailsBooking.subtotal).toLocaleString()}</span>
                      </div>
                      {detailsBooking.cleaning_fee != null && Number(detailsBooking.cleaning_fee) > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Cleaning fee</span>
                          <span>${Number(detailsBooking.cleaning_fee).toLocaleString()}</span>
                        </div>
                      )}
                      {detailsBooking.service_fee != null && Number(detailsBooking.service_fee) > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Service fee</span>
                          <span>${Number(detailsBooking.service_fee).toLocaleString()}</span>
                        </div>
                      )}
                      <Separator />
                      <div className="flex justify-between font-display font-bold text-base">
                        <span>Total</span>
                        <span className="text-primary">${Number(detailsBooking.total_price).toLocaleString()}</span>
                      </div>
                    </div>

                    {detailsBooking.guest_message && (
                      <>
                        <Separator />
                        <div>
                          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Guest message</p>
                          <p className="text-sm">{detailsBooking.guest_message}</p>
                        </div>
                      </>
                    )}

                    <Separator />

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => navigate(`/booking-confirmation/${detailsBooking.id}`)}
                      >
                        <Eye className="w-4 h-4 mr-2" /> View Confirmation
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => navigate(`/messages?with=${detailsBooking.guest_id}`)}
                      >
                        <CreditCard className="w-4 h-4 mr-2" /> Message Guest
                      </Button>
                    </div>
                  </div>
                </>
              );
            })()}
          </SheetContent>
        </Sheet>
      </div>
    </Layout>
  );
}
