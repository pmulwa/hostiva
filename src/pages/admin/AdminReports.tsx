import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type Profile = Database['public']['Tables']['profiles']['Row'];
type Property = Database['public']['Tables']['properties']['Row'];
type Booking = Database['public']['Tables']['bookings']['Row'];
type Review = Database['public']['Tables']['reviews']['Row'];

export default function AdminReports() {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('*'),
      supabase.from('properties').select('*'),
      supabase.from('bookings').select('*'),
      supabase.from('reviews').select('*'),
    ]).then(([p, pr, b, r]) => {
      if (p.data) setProfiles(p.data);
      if (pr.data) setProperties(pr.data);
      if (b.data) setBookings(b.data);
      if (r.data) setReviews(r.data);
      setIsLoading(false);
    });
  }, []);

  const stats = useMemo(() => {
    const completed = bookings.filter(b => b.status === 'completed');
    return {
      totalRevenue: completed.reduce((s, b) => s + Number(b.total_price), 0),
      serviceFees: bookings.reduce((s, b) => s + Number(b.service_fee || 0), 0),
      totalBookings: bookings.length,
      completedBookings: completed.length,
      confirmedBookings: bookings.filter(b => b.status === 'confirmed').length,
      pendingBookings: bookings.filter(b => b.status === 'pending').length,
      cancelledBookings: bookings.filter(b => b.status === 'cancelled').length,
      activeListings: properties.filter(p => p.status === 'active').length,
      pendingApproval: properties.filter(p => p.status === 'pending_approval').length,
      rejectedProperties: properties.filter(p => p.status === 'rejected').length,
      totalProperties: properties.length,
      totalUsers: profiles.length,
      totalHosts: profiles.filter(p => p.is_host).length,
      totalGuests: profiles.filter(p => !p.is_host).length,
      verifiedUsers: profiles.filter(p => p.is_verified).length,
      totalReviews: reviews.length,
    };
  }, [profiles, properties, bookings, reviews]);

  if (isLoading) return <AdminLayout><div className="animate-pulse h-64 bg-muted rounded-xl" /></AdminLayout>;

  return (
    <AdminLayout>
      <h1 className="font-display text-3xl font-bold mb-2">{t('admin.sidebar.reports')}</h1>
      <p className="text-muted-foreground text-sm mb-6">Platform analytics and breakdowns</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="card-luxury">
          <CardContent className="p-6">
            <h2 className="font-display text-lg font-bold mb-4">{t('admin.bookingBreakdown')}</h2>
            <div className="space-y-3">
              <div className="flex justify-between py-2"><span className="text-sm text-muted-foreground">Completed</span><span className="text-sm font-bold text-green-500">{stats.completedBookings}</span></div>
              <div className="flex justify-between py-2"><span className="text-sm text-muted-foreground">Confirmed</span><span className="text-sm font-bold text-primary">{stats.confirmedBookings}</span></div>
              <div className="flex justify-between py-2"><span className="text-sm text-muted-foreground">Pending</span><span className="text-sm font-bold text-amber-500">{stats.pendingBookings}</span></div>
              <div className="flex justify-between py-2"><span className="text-sm text-muted-foreground">Cancelled</span><span className="text-sm font-bold text-destructive">{stats.cancelledBookings}</span></div>
              <Separator />
              <div className="flex justify-between py-2"><span className="text-sm font-bold">Total</span><span className="text-sm font-bold">{stats.totalBookings}</span></div>
            </div>
          </CardContent>
        </Card>

        <Card className="card-luxury">
          <CardContent className="p-6">
            <h2 className="font-display text-lg font-bold mb-4">{t('admin.propertyBreakdown')}</h2>
            <div className="space-y-3">
              <div className="flex justify-between py-2"><span className="text-sm text-muted-foreground">Active</span><span className="text-sm font-bold text-green-500">{stats.activeListings}</span></div>
              <div className="flex justify-between py-2"><span className="text-sm text-muted-foreground">Pending</span><span className="text-sm font-bold text-amber-500">{stats.pendingApproval}</span></div>
              <div className="flex justify-between py-2"><span className="text-sm text-muted-foreground">Rejected</span><span className="text-sm font-bold text-destructive">{stats.rejectedProperties}</span></div>
              <Separator />
              <div className="flex justify-between py-2"><span className="text-sm font-bold">Total</span><span className="text-sm font-bold">{stats.totalProperties}</span></div>
            </div>
          </CardContent>
        </Card>

        <Card className="card-luxury">
          <CardContent className="p-6">
            <h2 className="font-display text-lg font-bold mb-4">{t('admin.userBreakdown')}</h2>
            <div className="space-y-3">
              <div className="flex justify-between py-2"><span className="text-sm text-muted-foreground">Hosts</span><span className="text-sm font-bold">{stats.totalHosts}</span></div>
              <div className="flex justify-between py-2"><span className="text-sm text-muted-foreground">Guests</span><span className="text-sm font-bold">{stats.totalGuests}</span></div>
              <div className="flex justify-between py-2"><span className="text-sm text-muted-foreground">Verified</span><span className="text-sm font-bold text-green-500">{stats.verifiedUsers}</span></div>
              <Separator />
              <div className="flex justify-between py-2"><span className="text-sm font-bold">Total</span><span className="text-sm font-bold">{stats.totalUsers}</span></div>
            </div>
          </CardContent>
        </Card>

        <Card className="card-luxury">
          <CardContent className="p-6">
            <h2 className="font-display text-lg font-bold mb-4">{t('admin.revenueBreakdown')}</h2>
            <div className="space-y-3">
              <div className="flex justify-between py-2"><span className="text-sm text-muted-foreground">Gross Revenue</span><span className="text-sm font-bold">${stats.totalRevenue.toLocaleString()}</span></div>
              <div className="flex justify-between py-2"><span className="text-sm text-muted-foreground">Platform Fees</span><span className="text-sm font-bold text-primary">${stats.serviceFees.toLocaleString()}</span></div>
              <Separator />
              <div className="flex justify-between py-2"><span className="text-sm font-bold">Net to Hosts</span><span className="text-sm font-bold">${(stats.totalRevenue - stats.serviceFees).toLocaleString()}</span></div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
