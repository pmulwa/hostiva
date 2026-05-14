import { useState, useEffect, useMemo } from 'react';
import { logAdminAction } from '@/lib/audit';
import { usePlatformSettings, formatBookingId } from '@/hooks/usePlatformSettings';
import { formatUserId } from '@/hooks/usePlatformSettings';
import { useTranslation } from 'react-i18next';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Check, X, MoreHorizontal, CheckSquare, RotateCcw, Trash2, AlertTriangle } from 'lucide-react';
import { Eye, User as UserIcon, Home as HomeIcon, MessageSquare } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import type { Database } from '@/integrations/supabase/types';
import { calculateFees } from '@/hooks/usePlatformSettings';

type Booking = Database['public']['Tables']['bookings']['Row'];
type Property = Database['public']['Tables']['properties']['Row'];

export default function AdminBookings() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { settings } = usePlatformSettings();
  const [bookings, setBookings] = useState<(Booking & { properties?: Property })[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ action: string; count: number } | null>(null);
  const [viewBooking, setViewBooking] = useState<(Booking & { properties?: Property }) | null>(null);
  const [viewParties, setViewParties] = useState<{
    guest?: { full_name: string | null; email: string | null; phone: string | null };
    host?: { full_name: string | null; email: string | null };
    loading: boolean;
  }>({ loading: false });

  const fetchData = async () => {
    setIsLoading(true);
    const { data } = await supabase.from('bookings').select('*, properties(*)').order('created_at', { ascending: false });
    if (data) setBookings(data as any);
    setIsLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const postBookingSystemMessage = async (bookingId: string, statusVerb: string) => {
    const booking = bookings.find((b) => b.id === bookingId);
    if (!booking) return;
    const code = formatBookingId(booking.id, settings?.booking_id_prefix, settings?.booking_id_length);
    // Two rows so it appears in both inboxes (host -> guest and guest -> host views).
    await supabase.from('messages').insert([
      {
        sender_id: booking.host_id,
        receiver_id: booking.guest_id,
        booking_id: booking.id,
        content: `🛡️ Booking ${code} was ${statusVerb} by an administrator. This conversation is now closed.`,
        message_type: 'system',
      },
    ]);
  };

  const updateStatus = async (id: string, status: Database['public']['Enums']['booking_status']) => {
    const { error } = await supabase.from('bookings').update({ status }).eq('id', id);
    if (!error) {
      await logAdminAction(status === 'confirmed' ? 'confirm' : status === 'completed' ? 'complete' : status === 'cancelled' ? 'cancel' : 'reject', 'booking', id, { new_status: status });
      if (status === 'cancelled') await postBookingSystemMessage(id, 'cancelled');
      toast({ title: t('common.success'), description: t('admin.bookingUpdated') }); fetchData();
    }
  };

  const openView = async (booking: Booking & { properties?: Property }) => {
    setViewBooking(booking);
    setViewParties({ loading: true });
    const [{ data: guest }, { data: host }] = await Promise.all([
      supabase.from('profiles').select('full_name, email, phone').eq('user_id', booking.guest_id).maybeSingle(),
      supabase.from('profiles').select('full_name, email').eq('user_id', booking.host_id).maybeSingle(),
    ]);

    // Fallback to auth.users via admin RPC when a profile row is missing or
    // its core fields are blank (legacy accounts created before the
    // handle_new_user trigger existed).
    const needsGuestFallback = !guest || (!guest.full_name && !guest.email);
    const needsHostFallback = !host || (!host.full_name && !host.email);

    let guestFinal = guest as { full_name: string | null; email: string | null; phone: string | null } | null;
    let hostFinal = host as { full_name: string | null; email: string | null } | null;

    if (needsGuestFallback) {
      const { data } = await supabase.rpc('admin_get_user_basic' as any, { _user_id: booking.guest_id });
      const row = Array.isArray(data) ? data[0] : null;
      if (row) {
        guestFinal = {
          full_name: row.full_name || guestFinal?.full_name || null,
          email: row.email || guestFinal?.email || null,
          phone: row.phone || guestFinal?.phone || null,
        };
      }
    }
    if (needsHostFallback) {
      const { data } = await supabase.rpc('admin_get_user_basic' as any, { _user_id: booking.host_id });
      const row = Array.isArray(data) ? data[0] : null;
      if (row) {
        hostFinal = {
          full_name: row.full_name || hostFinal?.full_name || null,
          email: row.email || hostFinal?.email || null,
        };
      }
    }

    setViewParties({
      guest: guestFinal as any,
      host: hostFinal as any,
      loading: false,
    });
  };

  const cancelFromView = async () => {
    if (!viewBooking) return;
    await updateStatus(viewBooking.id, 'cancelled');
    setViewBooking(null);
  };

  const stats = useMemo(() => ({
    all: bookings.length,
    pending: bookings.filter(b => b.status === 'pending').length,
    confirmed: bookings.filter(b => b.status === 'confirmed').length,
    completed: bookings.filter(b => b.status === 'completed').length,
    cancelled: bookings.filter(b => b.status === 'cancelled').length,
  }), [bookings]);

  const filtered = filter === 'all' ? bookings : bookings.filter(b => b.status === filter);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const toggleSelectAll = () => {
    setSelectedIds(prev => prev.size === filtered.length ? new Set() : new Set(filtered.map(b => b.id)));
  };

  const bulkReset = async () => {
    setIsBulkProcessing(true);
    for (const id of selectedIds) {
      await supabase.from('bookings').update({ status: 'pending' as any, cancellation_reason: null }).eq('id', id);
      await logAdminAction('bulk_reset', 'booking', id);
    }
    toast({ title: 'Success', description: `${selectedIds.size} bookings reset to pending` });
    setSelectedIds(new Set()); setIsBulkProcessing(false); setConfirmDialog(null); fetchData();
  };

  const bulkDelete = async () => {
    setIsBulkProcessing(true);
    for (const id of selectedIds) {
      await supabase.from('bookings').delete().eq('id', id);
      await logAdminAction('bulk_delete', 'booking', id);
    }
    toast({ title: 'Success', description: `${selectedIds.size} bookings deleted` });
    setSelectedIds(new Set()); setIsBulkProcessing(false); setConfirmDialog(null); fetchData();
  };

  const bulkCancel = async () => {
    setIsBulkProcessing(true);
    for (const id of selectedIds) {
      await supabase.from('bookings').update({ status: 'cancelled' as any, cancellation_reason: 'Cancelled by admin' }).eq('id', id);
      await logAdminAction('bulk_cancel', 'booking', id);
      await postBookingSystemMessage(id, 'cancelled');
    }
    toast({ title: 'Success', description: `${selectedIds.size} bookings cancelled` });
    setSelectedIds(new Set()); setIsBulkProcessing(false); fetchData();
  };

  const bulkConfirm = async () => {
    setIsBulkProcessing(true);
    for (const id of selectedIds) {
      await supabase.from('bookings').update({ status: 'confirmed' as any }).eq('id', id);
      await logAdminAction('bulk_confirm', 'booking', id);
    }
    toast({ title: 'Success', description: `${selectedIds.size} bookings confirmed` });
    setSelectedIds(new Set()); setIsBulkProcessing(false); fetchData();
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, string> = { pending: 'bg-amber-500/10 text-amber-500 border-amber-500/30', confirmed: 'bg-green-500/10 text-green-500 border-green-500/30', completed: 'bg-primary/10 text-primary border-primary/30', cancelled: 'bg-destructive/10 text-destructive border-destructive/30', rejected: 'bg-destructive/10 text-destructive border-destructive/30' };
    return <Badge className={map[status] || 'bg-muted text-muted-foreground border-border'}>{status}</Badge>;
  };

  if (isLoading) return <AdminLayout><div className="animate-pulse h-64 bg-muted rounded-xl" /></AdminLayout>;

  return (
    <AdminLayout>
      <h1 className="font-display text-3xl font-bold mb-2">{t('admin.sidebar.bookings')}</h1>
      <p className="text-muted-foreground text-sm mb-6">Manage all booking transactions</p>

      <div className="flex flex-wrap gap-3 mb-6">
        {(['all', 'pending', 'confirmed', 'completed', 'cancelled'] as const).map(f => (
          <Button key={f} variant={filter === f ? 'default' : 'outline'} size="sm" onClick={() => setFilter(f)} className="gap-1.5 capitalize">
            {f} <span className="text-xs opacity-60">({stats[f]})</span>
          </Button>
        ))}
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 mb-4 p-3 bg-primary/5 border border-primary/20 rounded-xl">
          <CheckSquare className="w-5 h-5 text-primary" />
          <span className="text-sm font-medium">{selectedIds.size} booking{selectedIds.size > 1 ? 's' : ''} selected</span>
          <Separator orientation="vertical" className="h-6" />
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={bulkConfirm} disabled={isBulkProcessing}>
              <Check className="w-3 h-3 mr-1" /> Confirm
            </Button>
            <Button size="sm" variant="outline" onClick={bulkCancel} disabled={isBulkProcessing}>
              <X className="w-3 h-3 mr-1" /> Cancel
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirmDialog({ action: 'reset', count: selectedIds.size })} disabled={isBulkProcessing}>
              <RotateCcw className="w-3 h-3 mr-1" /> Reset to Pending
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setConfirmDialog({ action: 'delete', count: selectedIds.size })} disabled={isBulkProcessing}>
              <Trash2 className="w-3 h-3 mr-1" /> Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Clear</Button>
          </div>
        </div>
      )}

      <Card className="card-luxury">
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox checked={filtered.length > 0 && selectedIds.size === filtered.length} onCheckedChange={toggleSelectAll} />
                </TableHead>
                <TableHead>Booking ID</TableHead>
                <TableHead>Property</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Guests</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(booking => (
                <TableRow key={booking.id} className={selectedIds.has(booking.id) ? 'bg-primary/5' : ''}>
                  <TableCell>
                    <Checkbox checked={selectedIds.has(booking.id)} onCheckedChange={() => toggleSelect(booking.id)} />
                  </TableCell>
                  <TableCell className="font-mono text-sm">#{formatBookingId(booking.id, settings?.booking_id_prefix, settings?.booking_id_length)}</TableCell>
                  <TableCell className="text-sm">{(booking as any).properties?.title || 'N/A'}</TableCell>
                  <TableCell className="text-sm">{format(new Date(booking.check_in_date), 'MMM d')} – {format(new Date(booking.check_out_date), 'MMM d')}</TableCell>
                  <TableCell className="text-sm">{booking.num_guests}</TableCell>
                  <TableCell className="text-sm font-semibold">${Number(booking.total_price).toLocaleString()}</TableCell>
                  <TableCell>{getStatusBadge(booking.status)}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="sm"><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openView(booking)}>
                          <Eye className="w-4 h-4 mr-2" /> View Details
                        </DropdownMenuItem>
                        {booking.status === 'pending' && (
                          <>
                            <DropdownMenuItem className="text-green-600" onClick={() => updateStatus(booking.id, 'confirmed')}><Check className="w-4 h-4 mr-2" /> Confirm</DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => updateStatus(booking.id, 'rejected')}><X className="w-4 h-4 mr-2" /> Reject</DropdownMenuItem>
                          </>
                        )}
                        {booking.status === 'confirmed' && (
                          <DropdownMenuItem onClick={() => updateStatus(booking.id, 'completed')}><Check className="w-4 h-4 mr-2" /> Complete</DropdownMenuItem>
                        )}
                        {['pending', 'confirmed'].includes(booking.status) && (
                          <DropdownMenuItem className="text-destructive" onClick={() => updateStatus(booking.id, 'cancelled')}><X className="w-4 h-4 mr-2" /> Cancel</DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-2 gap-1.5"
                      onClick={() => openView(booking)}
                    >
                      <Eye className="w-3.5 h-3.5" /> View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filtered.length === 0 && <div className="text-center py-12 text-muted-foreground">No bookings found</div>}
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <Dialog open={!!confirmDialog} onOpenChange={() => setConfirmDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Confirm {confirmDialog?.action === 'delete' ? 'Deletion' : 'Reset'}
            </DialogTitle>
            <DialogDescription>
              {confirmDialog?.action === 'delete'
                ? `This will permanently delete ${confirmDialog.count} booking${confirmDialog.count > 1 ? 's' : ''}. This cannot be undone.`
                : `This will reset ${confirmDialog?.count} booking${(confirmDialog?.count || 0) > 1 ? 's' : ''} to pending status.`
              }
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDialog?.action === 'delete' ? bulkDelete : bulkReset} disabled={isBulkProcessing}>
              {isBulkProcessing ? 'Processing...' : confirmDialog?.action === 'delete' ? 'Delete All' : 'Reset All'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Booking Details Modal */}
      <Dialog open={!!viewBooking} onOpenChange={(open) => !open && setViewBooking(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto p-0 gap-0">
          {viewBooking && (() => {
            const code = formatBookingId(viewBooking.id, settings?.booking_id_prefix, settings?.booking_id_length);
            const fees = settings ? calculateFees(Number(viewBooking.subtotal ?? viewBooking.total_price), settings, 'guest') : null;
            const subtotal = Number(viewBooking.subtotal ?? 0);
            const serviceFee = Number(viewBooking.service_fee ?? fees?.guestServiceFee ?? 0);
            const taxes = fees?.serviceTax ?? 0;
            const totalGuestPayment = Number(viewBooking.total_price ?? fees?.guestTotal ?? 0);
            const hostPayout = fees?.hostPayout ?? subtotal - serviceFee;
            const platformFee = fees?.platformRevenue ?? serviceFee;
            const checkIn = new Date(viewBooking.check_in_date);
            const checkOut = new Date(viewBooking.check_out_date);
            const cancellable = ['pending', 'confirmed'].includes(viewBooking.status);
            return (
              <>
                {/* Dark Header */}
                <div className="bg-slate-900 text-white px-6 py-5 rounded-t-lg flex items-start justify-between">
                  <div>
                    <DialogTitle className="text-white font-display text-xl">Booking Details</DialogTitle>
                    <p className="text-xs text-slate-300 font-mono mt-1">{code}</p>
                  </div>
                </div>

                <div className="p-6 space-y-4">
                  {/* Current Status */}
                  <div className="rounded-xl border border-border p-4 flex items-center justify-between bg-card">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5">Current Status</p>
                      <p className="text-base font-bold capitalize">{viewBooking.status}</p>
                    </div>
                    {getStatusBadge(viewBooking.status)}
                  </div>

                  {/* Guest & Host */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-blue-200/50 bg-blue-50/40 dark:bg-blue-500/5 p-4">
                      <div className="flex items-center gap-1.5 mb-2">
                        <UserIcon className="w-3.5 h-3.5 text-blue-600" />
                        <p className="text-[11px] uppercase tracking-wide text-blue-600 font-semibold">Guest</p>
                      </div>
                      {viewParties.loading ? (
                        <div className="h-4 bg-muted rounded animate-pulse w-3/4" />
                      ) : (
                        <>
                          <p className="text-sm font-bold">{viewParties.guest?.full_name || '—'}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{viewParties.guest?.email}</p>
                          {viewParties.guest?.phone && (
                            <p className="text-xs text-muted-foreground">{viewParties.guest.phone}</p>
                          )}
                          <p className="text-[10px] text-muted-foreground mt-1 font-mono break-all" title={viewBooking.guest_id}>
                            Guest ID: {formatUserId(viewBooking.guest_id, settings?.guest_id_prefix ?? 'GST', settings?.guest_id_length ?? 8)}
                          </p>
                        </>
                      )}
                    </div>
                    <div className="rounded-xl border border-purple-200/50 bg-purple-50/40 dark:bg-purple-500/5 p-4">
                      <div className="flex items-center gap-1.5 mb-2">
                        <HomeIcon className="w-3.5 h-3.5 text-purple-600" />
                        <p className="text-[11px] uppercase tracking-wide text-purple-600 font-semibold">Host</p>
                      </div>
                      {viewParties.loading ? (
                        <div className="h-4 bg-muted rounded animate-pulse w-3/4" />
                      ) : (
                        <>
                          <p className="text-sm font-bold">{viewParties.host?.full_name || '—'}</p>
                          {viewParties.host?.email && (
                            <p className="text-xs text-muted-foreground mt-0.5">{viewParties.host.email}</p>
                          )}
                          <p className="text-[10px] text-muted-foreground mt-1 font-mono break-all" title={viewBooking.host_id}>
                            Host ID: {formatUserId(viewBooking.host_id, settings?.host_id_prefix ?? 'HST', settings?.host_id_length ?? 8)}
                          </p>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Property */}
                  <div className="rounded-xl border border-border bg-muted/30 p-4">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Property</p>
                    <p className="text-sm font-bold">{viewBooking.properties?.title || '—'}</p>
                    <p className="text-xs text-muted-foreground font-mono mt-1">Listing ID: {viewBooking.property_id.slice(0, 8)}</p>
                  </div>

                  {/* Dates */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-xl border border-border bg-muted/30 p-4">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Check-in</p>
                      <p className="text-sm font-bold">{format(checkIn, 'MMM d, yyyy')}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">15:00</p>
                    </div>
                    <div className="rounded-xl border border-border bg-muted/30 p-4">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Check-out</p>
                      <p className="text-sm font-bold">{format(checkOut, 'MMM d, yyyy')}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">11:00</p>
                    </div>
                    <div className="rounded-xl border border-border bg-muted/30 p-4">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Duration</p>
                      <p className="text-sm font-bold">{viewBooking.num_nights}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">nights</p>
                    </div>
                  </div>

                  {/* Guests */}
                  <div className="rounded-xl border border-border bg-muted/30 p-4">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Guests</p>
                    <p className="text-sm font-bold">{viewBooking.num_guests} guests</p>
                  </div>

                  {/* Special Requests */}
                  {viewBooking.guest_message && (
                    <div className="rounded-xl border-l-4 border-amber-400 bg-amber-50/60 dark:bg-amber-500/10 px-4 py-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <MessageSquare className="w-3.5 h-3.5 text-amber-600" />
                        <p className="text-[11px] uppercase tracking-wide text-amber-700 font-semibold">Special Requests</p>
                      </div>
                      <p className="text-sm">{viewBooking.guest_message}</p>
                    </div>
                  )}

                  {viewBooking.cancellation_reason && (
                    <div className="rounded-xl border-l-4 border-destructive bg-destructive/5 px-4 py-3">
                      <p className="text-[11px] uppercase tracking-wide text-destructive font-semibold mb-1">Cancellation Reason</p>
                      <p className="text-sm">{viewBooking.cancellation_reason}</p>
                    </div>
                  )}

                  <Separator />

                  {/* Price Breakdown */}
                  <div>
                    <h3 className="font-display text-base font-bold mb-3">Price Breakdown</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Nightly rate × {viewBooking.num_nights} nights</span>
                        <span className="font-semibold">${subtotal.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Service fee</span>
                        <span className="font-semibold">${serviceFee.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Taxes</span>
                        <span className="font-semibold">${Math.round(taxes).toLocaleString()}</span>
                      </div>
                      <Separator className="my-2" />
                      <div className="flex justify-between text-base">
                        <span className="font-bold">Total Guest Payment</span>
                        <span className="font-bold">${totalGuestPayment.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between rounded-lg bg-green-50 dark:bg-green-500/10 px-3 py-2 mt-3">
                        <span className="text-green-700 dark:text-green-400 font-semibold">Host Payout</span>
                        <span className="text-green-700 dark:text-green-400 font-bold">${Math.round(hostPayout).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between rounded-lg bg-blue-50 dark:bg-blue-500/10 px-3 py-2">
                        <span className="text-blue-700 dark:text-blue-400 font-semibold">Platform Fee</span>
                        <span className="text-blue-700 dark:text-blue-400 font-bold">${Math.round(platformFee).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <DialogFooter className="px-6 py-4 border-t border-border bg-muted/30 gap-2 sm:gap-2">
                  <Button variant="outline" onClick={() => setViewBooking(null)} className="flex-1 sm:flex-none">Close</Button>
                  {cancellable && (
                    <Button variant="destructive" onClick={cancelFromView} className="flex-1 sm:flex-none">
                      Cancel Booking
                    </Button>
                  )}
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
