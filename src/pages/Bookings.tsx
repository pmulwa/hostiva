import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Layout } from '@/components/layout/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { format, differenceInDays, addDays } from 'date-fns';
import {
  parseDateInTz,
  formatDateInTz,
  daysBetweenInTz,
  hoursUntilCheckInInTz,
  todayInTz,
  DEFAULT_TZ,
} from '@/lib/dates/propertyTz';
import { Calendar, MapPin, Clock, Users, MessageSquare, Star, X, UserCheck, ChevronDown, ChevronUp, AlertTriangle, Shield, Phone, Mail, CheckCircle, Check, Download, Eye, Lock, XCircle, Search, Filter, ArrowUpDown, Info, FileText } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarPicker } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { usePlatformSettings, calculateFees, formatBookingId } from '@/hooks/usePlatformSettings';
import type { ReceiptData } from '@/lib/generateReceiptPdf';
import { ReceiptPreviewDialog } from '@/components/ReceiptPreviewDialog';
import { isReceiptDownloaded, hydrateReceiptLocksFromBookings } from '@/lib/receiptLock';
import { ReviewForm } from '@/components/ReviewForm';
import { MutualReviewForm } from '@/components/MutualReviewForm';
import { CancellationPreviewDialog } from '@/components/cancellation/CancellationPreviewDialog';
import { HostCancellationSummary } from '@/components/cancellation/HostCancellationSummary';
import { calculateCancellationOutcome, type CancellationOutcome, type CancellationInput } from '@/lib/cancellation/engine';
import { postCancellationReversal, buildReversalFromOutcome, recordHostPenalty } from '@/lib/cancellation/posting';
import { useCancellationPolicy } from '@/hooks/useCancellationPolicy';
import { validateBookingLedger } from '@/lib/cancellation/ledgerValidation';
import { ArrivalConfirmButton } from '@/components/booking/ArrivalConfirmButton';
import { dispatchToRoles, notifyAdmins } from '@/lib/notifications/dispatcher';
import { usePlatformControls } from '@/hooks/usePlatformControls';
import { ReportIssueDialog } from '@/components/booking/ReportIssueDialog';
import { MutualReviewStatusBadge } from '@/components/cancellation/MutualReviewStatusBadge';
import { ModifyBookingDialog } from '@/components/booking/ModifyBookingDialog';
import { renderTemplate, effectiveTemplate } from '@/lib/autoMessageTemplates';
import type { Database } from '@/integrations/supabase/types';

type Booking = Database['public']['Tables']['bookings']['Row'] & {
  properties?: Database['public']['Tables']['properties']['Row'];
  guest_profile?: Database['public']['Tables']['profiles']['Row'] | null;
  host_profile?: Database['public']['Tables']['profiles']['Row'] | null;
};

export default function GuestBookings() {
  const { t } = useTranslation();
  const { user, isHost } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const { settings: platformSettings } = usePlatformSettings();
  const { policy: cancellationPolicy } = useCancellationPolicy();
  const { controls: platformControls } = usePlatformControls();
  // Merge admin Controls toggles into the cancellation policy so the engine
  // honours `cancellation_window` and `cancellation_penalty` everywhere.
  const effectivePolicy = useMemo(() => ({
    ...cancellationPolicy,
    cancellation_window_enabled: platformControls.guest_rights.cancellation_window !== false,
    host_penalty_enabled: platformControls.host_rights.cancellation_penalty !== false,
  }), [cancellationPolicy, platformControls]);
  const reviewsAllowed = platformControls.guest_rights.allow_reviews !== false;
  const alertCancellationsToAdmins = platformControls.notifications.alert_cancellations !== false;
  const initialTab = ['upcoming', 'drafts', 'past', 'cancelled'].includes(searchParams.get('tab') || '')
    ? (searchParams.get('tab') as string)
    : 'upcoming';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [reviewedBookingIds, setReviewedBookingIds] = useState<Set<string>>(new Set());
  const [mutualReviewedBookingIds, setMutualReviewedBookingIds] = useState<Set<string>>(new Set());
  // booking_id -> { mineDone, counterpartDone, windowClosesAt }
  const [mutualReviewState, setMutualReviewState] = useState<Record<string, { mineDone: boolean; counterpartDone: boolean; windowClosesAt: string | null }>>({});
  const [reviewBooking, setReviewBooking] = useState<Booking | null>(null);
  const [mutualReviewBooking, setMutualReviewBooking] = useState<Booking | null>(null);
  const [receiptPreviewBooking, setReceiptPreviewBooking] = useState<Booking | null>(null);
  // bump to force re-render after a receipt download (so lock state refreshes)
  const [receiptLockTick, setReceiptLockTick] = useState(0);

  // ---------- Search / filter / sort state ----------
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [sortKey, setSortKey] = useState<'check_in_date' | 'total_price' | 'updated_at'>('check_in_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [detailsBooking, setDetailsBooking] = useState<Booking | null>(null);

  // Detect if user is in host mode
  const isHostMode = isHost && localStorage.getItem('hostly_mode') === 'host';

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    fetchBookings();
    fetchReviewedBookings();
    fetchMutualReviewedBookings();
  }, [user, navigate, isHostMode]);

  // Realtime: re-fetch the bookings list whenever any row touching this user
  // changes (insert/update/delete). Guest sees their new bookings instantly,
  // host sees them flip from pending → confirmed the moment payment lands,
  // and either side sees cancellations propagate without a page reload.
  useEffect(() => {
    if (!user) return;
    const filter = isHostMode ? `host_id=eq.${user.id}` : `guest_id=eq.${user.id}`;
    // Track which booking IDs we've already toasted-on-confirm in this
    // session so a noisy realtime stream doesn't spam the host with the
    // same "new paid booking" toast multiple times.
    const toastedConfirmIds = new Set<string>();
    const channel = supabase
      .channel(`bookings-${isHostMode ? 'host' : 'guest'}-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter },
        (payload) => {
          // Host module: surface a toast the moment a booking transitions
          // pending → confirmed (i.e. the guest's payment just settled).
          // We rely on the realtime payload's `old` row to detect the
          // actual transition rather than firing on every UPDATE.
          if (isHostMode && payload.eventType === 'UPDATE') {
            const newRow = payload.new as { id?: string; status?: string };
            const oldRow = payload.old as { status?: string };
            if (
              newRow?.id &&
              newRow.status === 'confirmed' &&
              oldRow?.status === 'pending' &&
              !toastedConfirmIds.has(newRow.id)
            ) {
              toastedConfirmIds.add(newRow.id);
              toast({
                title: 'New booking confirmed',
                description: 'A guest just completed payment — the booking is now in your upcoming list.',
              });
            }
          }
          fetchBookings();
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isHostMode]);

  // Fallback refetch triggers — covers the case where realtime drops the
  // change (websocket reconnect, mobile background, etc). We refetch when:
  //   • Another tab/page signals via the `bookings:refetch` storage key
  //     (BookingConfirmation writes this after a successful payment).
  //   • The same tab dispatches the `bookings:refetch` CustomEvent.
  //   • The user returns to this tab (visibility / focus).
  useEffect(() => {
    if (!user) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'bookings:refetch') fetchBookings();
    };
    const onCustom = () => { fetchBookings(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchBookings();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('bookings:refetch', onCustom as EventListener);
    window.addEventListener('focus', onCustom);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('bookings:refetch', onCustom as EventListener);
      window.removeEventListener('focus', onCustom);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isHostMode]);

  const fetchReviewedBookings = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('reviews')
      .select('booking_id')
      .eq('guest_id', user.id);
    if (data) {
      setReviewedBookingIds(new Set(data.map(r => r.booking_id)));
    }
  };

  const fetchMutualReviewedBookings = async () => {
    if (!user) return;
    const myType = isHostMode ? 'host' : 'guest';
    // Pull all mutual_reviews for any booking touching this user. RLS exposes
    // the user's own row always; the counterpart row only when published or
    // window has closed — perfect for surfacing waiting state.
    const { data } = await supabase
      .from('mutual_reviews' as any)
      .select('booking_id, reviewer_type, review_window_closes_at')
      .or(`guest_id.eq.${user.id},host_id.eq.${user.id}`);
    if (data) {
      const map: Record<string, { mineDone: boolean; counterpartDone: boolean; windowClosesAt: string | null }> = {};
      const mine = new Set<string>();
      for (const row of data as any[]) {
        const slot = map[row.booking_id] || { mineDone: false, counterpartDone: false, windowClosesAt: null };
        slot.windowClosesAt = row.review_window_closes_at || slot.windowClosesAt;
        if (row.reviewer_type === myType) { slot.mineDone = true; mine.add(row.booking_id); }
        else slot.counterpartDone = true;
        map[row.booking_id] = slot;
      }
      setMutualReviewState(map);
      setMutualReviewedBookingIds(mine);
    }
  };

  const fetchBookings = async () => {
    if (!user) return;
    setIsLoading(true);

    if (isHostMode) {
      // Host mode: show reservations from clients (guests who booked host's properties)
      const { data, error } = await supabase
        .from('bookings')
        .select(`*, properties (*)`)
        .eq('host_id', user.id)
        .order('created_at', { ascending: false });

      if (!error && data) {
        // Fetch guest profiles for each booking
        const guestIds = [...new Set(data.map(b => b.guest_id))];
        const { data: profiles } = await supabase
          .from('profiles')
          .select('*')
          .in('user_id', guestIds);

        const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);
        const enriched = data.map(b => ({
          ...b,
          guest_profile: profileMap.get(b.guest_id) || null,
        }));
        setBookings(enriched);
      }
    } else {
      // Guest mode: show user's own bookings
      const { data, error } = await supabase
        .from('bookings')
        .select(`*, properties (*)`)
        .eq('guest_id', user.id)
        .order('created_at', { ascending: false });
      if (!error && data) {
        // Fetch host profiles
        const hostIds = [...new Set(data.map(b => b.host_id))];
        const { data: hostProfiles } = await supabase
          .from('profiles')
          .select('*')
          .in('user_id', hostIds);
        const hostMap = new Map(hostProfiles?.map(p => [p.user_id, p]) || []);
        const enriched = data.map(b => ({
          ...b,
          host_profile: hostMap.get(b.host_id) || null,
        }));
        setBookings(enriched);
        // Hydrate cross-device receipt-download lock from DB
        await hydrateReceiptLocksFromBookings(data as any);
        setReceiptLockTick((t) => t + 1);
      }
    }
    setIsLoading(false);
  };

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancellingBooking, setCancellingBooking] = useState<Booking | null>(null);
  const [hostCancelDialogOpen, setHostCancelDialogOpen] = useState(false);
  const [hostCancellingBooking, setHostCancellingBooking] = useState<Booking | null>(null);
  const [hostSummaryOpen, setHostSummaryOpen] = useState(false);
  const [hostSummaryOutcome, setHostSummaryOutcome] = useState<CancellationOutcome | null>(null);
  const [hostSummaryGuestName, setHostSummaryGuestName] = useState<string>('');
  const [hostSummaryHours, setHostSummaryHours] = useState<number>(0);
  const [isCancelSubmitting, setIsCancelSubmitting] = useState(false);
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const [issueBooking, setIssueBooking] = useState<Booking | null>(null);
  // Guest date-modification dialog
  const [modifyBooking, setModifyBooking] = useState<Booking | null>(null);

  const getRefundInfo = (booking: Booking) => {
    // Compare today (in property zone) to check-in (also in property zone) so
    // a guest in a different country never sees the wrong refund tier.
    const tz = booking.properties?.timezone || DEFAULT_TZ;
    const daysUntilCheckin = daysBetweenInTz(todayInTz(tz), booking.check_in_date, tz);
    const serviceFee = Number(booking.service_fee || 0);
    const totalPaid = Number(booking.total_price);
    if (daysUntilCheckin >= 5) {
      return { percent: 100, label: 'Full Refund', amount: totalPaid - serviceFee, serviceFeeKept: serviceFee, color: 'text-green-600', description: '5 or more days before check-in. 100% refund — no host approval required. Service fee is non-refundable.', tier: 'full' };
    } else if (daysUntilCheckin >= 3) {
      const refundable = (totalPaid - serviceFee) * 0.5;
      return { percent: 50, label: 'Partial Refund (50%)', amount: refundable, serviceFeeKept: serviceFee, color: 'text-yellow-600', description: '3–4 days before check-in. 50% refund automatically. You may also request free cancellation from the host for a higher refund.', tier: 'partial' };
    } else {
      return { percent: 0, label: 'No Refund', amount: 0, serviceFeeKept: serviceFee, color: 'text-destructive', description: 'Less than 3 days (within 24–72 hours) before check-in. No automatic refund. You may request free cancellation from the host.', tier: 'none' };
    }
  };

  /**
   * Build a CancellationInput from a booking row for use with the engine.
   * Pulls authoritative ledger values directly from the booking record
   * (total_price, nightly_rate, num_nights, actual_check_in_at). Throws
   * if a critical field is missing rather than silently recomputing
   * totals — refund math must never run on partial data.
   */
  const buildCancellationInput = (booking: Booking, initiatedBy: 'guest' | 'host'): CancellationInput => {
    const nightly = Number(booking.nightly_rate);
    const nights = Number(booking.num_nights);
    const total = Number(booking.total_price);
    if (!Number.isFinite(nightly) || nightly <= 0) {
      throw new Error('Booking is missing nightly_rate; cannot compute cancellation refund.');
    }
    if (!Number.isFinite(nights) || nights <= 0) {
      throw new Error('Booking is missing num_nights; cannot compute cancellation refund.');
    }
    if (!Number.isFinite(total) || total <= 0) {
      throw new Error('Booking is missing total_price (ledger value); cannot compute cancellation refund.');
    }
    if (!booking.check_in_date) {
      throw new Error('Booking is missing check_in_date; cannot compute cancellation refund.');
    }
    const processingFee = Number((total * 0.029 + 0.30).toFixed(2));
    return {
      nightlyRate: nightly,
      totalNights: nights,
      cleaningFee: Number(booking.cleaning_fee ?? 0),
      serviceFee: Number(booking.service_fee ?? 0),
      processingFee,
      taxes: 0,
      checkInAt: `${booking.check_in_date}T${(booking.properties?.check_in_time as any) || '15:00:00'}`,
      bookingCreatedAt: booking.created_at,
      actualCheckInAt: (booking as any).actual_check_in_at ?? null,
      initiatedBy,
    };
  };

  const openCancelDialog = (booking: Booking) => {
    if (isReceiptDownloaded(booking.id)) {
      toast({
        title: 'Cancellation locked',
        description: 'You downloaded the receipt for this booking, so it cannot be cancelled. Cancelling now would result in a 0% refund.',
        variant: 'destructive',
      });
      return;
    }
    setCancellingBooking(booking);
    setCancelDialogOpen(true);
  };

  /**
   * Apply a computed cancellation outcome: update booking, free calendar,
   * post system message, and write the reversing journal entry.
   */
  const applyCancellation = async (
    booking: Booking,
    outcome: CancellationOutcome,
    initiatedBy: 'guest' | 'host',
  ) => {
    setIsCancelSubmitting(true);
    try {
      const refundStatus = outcome.guestRefund > 0 ? 'pending' : 'none';
      // cancellation_reason is shown to the guest in the confirmation timeline,
      // so for host cancellations we omit any mention of host payout / penalty.
      const reasonText =
        initiatedBy === 'host'
          ? `[${outcome.tierLabel}] Host cancellation. ` +
            `Refund: $${outcome.guestRefund.toFixed(2)}` +
            (outcome.guestCredit > 0 ? ` + $${outcome.guestCredit.toFixed(2)} credit` : '') +
            `.`
          : `[${outcome.tierLabel}] Guest cancellation. ` +
            `Refund: $${outcome.guestRefund.toFixed(2)}` +
            (outcome.guestCredit > 0 ? ` + $${outcome.guestCredit.toFixed(2)} credit` : '') +
            `. Host payout: $${outcome.hostPayout.toFixed(2)}.` +
            (outcome.hostPenalty > 0 ? ` Host penalty: $${outcome.hostPenalty.toFixed(2)}.` : '');

      const { error } = await supabase.from('bookings').update({
        status: 'cancelled',
        cancellation_reason: reasonText,
        refund_amount: outcome.guestRefund,
        refund_status: refundStatus,
        refund_reason: `${outcome.tierLabel} (${initiatedBy})`,
      }).eq('id', booking.id);
      if (error) throw error;

      // Free up calendar
      const tz = booking.properties?.timezone || DEFAULT_TZ;
      const start = parseDateInTz(booking.check_in_date, tz);
      const end = parseDateInTz(booking.check_out_date, tz);
      let current = new Date(start);
      while (current < end) {
        const dateStr = format(current, 'yyyy-MM-dd');
        await supabase
          .from('property_availability')
          .delete()
          .eq('property_id', booking.property_id)
          .eq('date', dateStr)
          .eq('is_available', false);
        current = addDays(current, 1);
      }

      // System message in the booking thread.
      // For host-initiated cancellations the recipient is the guest, who must
      // never see the host's payout figure — only their own refund.
      const fullCode = formatBookingId(
        booking.id,
        platformSettings?.booking_id_prefix,
        platformSettings?.booking_id_length,
      );
      const otherParty = initiatedBy === 'guest' ? booking.host_id : booking.guest_id;
      const guestCount = `${booking.num_guests} guest${booking.num_guests > 1 ? 's' : ''}`;
      // Standard auto-cancellation message (one of the 3 toggleable automated
      // messages). Wording comes from the admin-editable template stored in
      // platform_settings.auto_message_templates with a built-in default.
      const { data: psTpl } = await supabase
        .from('platform_settings')
        .select('auto_message_templates')
        .maybeSingle();
      const overrides = (psTpl?.auto_message_templates as Record<string, string> | null) ?? null;
      const messageContent = renderTemplate(
        effectiveTemplate('booking_cancelled', overrides),
        {
          code: fullCode,
          initiator: initiatedBy,
          check_in: booking.check_in_date,
          check_out: booking.check_out_date,
          guests: guestCount,
          title: booking.properties?.title ?? 'this property',
        },
      );
      await supabase.from('messages').insert({
        sender_id: user!.id,
        receiver_id: otherParty,
        booking_id: booking.id,
        content: messageContent,
        message_type: 'system',
      });

      // Reversing journal entry (best-effort, non-blocking)
      void postCancellationReversal(buildReversalFromOutcome(outcome, booking as any));

      // Persist host penalty as a pending deduction — settled from next payout.
      if (initiatedBy === 'host' && outcome.hostPenalty > 0) {
        void recordHostPenalty({
          hostId: booking.host_id,
          bookingId: booking.id,
          amount: outcome.hostPenalty,
          currency: booking.currency ?? 'USD',
          tierLabel: outcome.tierLabel,
        });
      }

      // Multi-channel cancellation notification — separate bodies per role so
      // the guest never receives the host's payout figure.
      const guestBody =
        `${outcome.tierLabel} applied. Cancelled by ${initiatedBy}. ` +
        `Your refund: $${outcome.guestRefund.toFixed(2)}` +
        (outcome.guestCredit > 0 ? ` + $${outcome.guestCredit.toFixed(2)} credit` : '') +
        `.`;
      const hostBody =
        `${outcome.tierLabel} applied. Cancelled by ${initiatedBy}. ` +
        `Guest refund: $${outcome.guestRefund.toFixed(2)}. ` +
        `Your payout: $${outcome.hostPayout.toFixed(2)}.`;
      void dispatchToRoles(
        {
          eventType: 'cancellation',
          subject: `Booking ${fullCode} cancelled`,
          body: guestBody,
          relatedEntityType: 'booking',
          relatedEntityId: booking.id,
        },
        [{ userId: booking.guest_id, role: 'guest' }],
      );
      void dispatchToRoles(
        {
          eventType: 'cancellation',
          subject: `Booking ${fullCode} cancelled`,
          body: hostBody,
          relatedEntityType: 'booking',
          relatedEntityId: booking.id,
        },
        [{ userId: booking.host_id, role: 'host' }],
      );

      // Admin Controls: notifications.alert_cancellations — broadcast every
      // cancellation to all platform admins for visibility / audit.
      if (alertCancellationsToAdmins) {
        void notifyAdmins({
          eventType: 'cancellation',
          subject: `[Admin] Booking ${fullCode} cancelled (${initiatedBy})`,
          body: `${outcome.tierLabel}. Guest refund: $${outcome.guestRefund.toFixed(2)}. Host payout: $${outcome.hostPayout.toFixed(2)}.`,
          relatedEntityType: 'booking',
          relatedEntityId: booking.id,
          metadata: { initiatedBy, tier: outcome.tier },
        });
      }

      // The toast appears for whichever party performed the action — show the
      // correct figure for that party only.
      toast({
        title: 'Booking cancelled',
        description:
          initiatedBy === 'host'
            ? `${outcome.tierLabel} applied. Guest refund: $${outcome.guestRefund.toFixed(2)}` +
              (outcome.hostPayout > 0 ? `, your payout: $${outcome.hostPayout.toFixed(2)}` : '')
            : `${outcome.tierLabel} applied. Your refund: $${outcome.guestRefund.toFixed(2)}.`,
      });

      // For host-initiated, show the payout summary right after
      if (initiatedBy === 'host') {
        const tz = booking.properties?.timezone || DEFAULT_TZ;
        const hours = hoursUntilCheckInInTz(
          booking.check_in_date,
          (booking.properties?.check_in_time as any) || '15:00:00',
          tz,
        );
        setHostSummaryOutcome(outcome);
        setHostSummaryGuestName(booking.guest_profile?.full_name || booking.guest_profile?.email || 'Guest');
        setHostSummaryHours(hours);
        setHostSummaryOpen(true);
      }

      fetchBookings();
    } catch (e: any) {
      toast({ title: t('common.error'), description: e?.message || 'Cancellation failed', variant: 'destructive' });
    } finally {
      setIsCancelSubmitting(false);
    }
  };

  const handleGuestConfirmCancel = async (outcome: CancellationOutcome) => {
    if (!cancellingBooking) return;
    await applyCancellation(cancellingBooking, outcome, 'guest');
    setCancelDialogOpen(false);
    setCancellingBooking(null);
  };

  const handleGuestRequestFreeCancellation = async () => {
    if (!cancellingBooking) return;
    const serviceFee = Number(cancellingBooking.service_fee || 0);
    // Send message to host requesting free cancellation
    const fullCode = formatBookingId(
      cancellingBooking.id,
      platformSettings?.booking_id_prefix,
      platformSettings?.booking_id_length
    );
    await supabase.from('messages').insert({
      sender_id: user!.id,
      receiver_id: cancellingBooking.host_id,
      booking_id: cancellingBooking.id,
      content: `🔔 Goodwill cancellation request: Guest is asking for a 100% refund of accommodation, cleaning, and taxes for booking ${fullCode}. The service fee ($${serviceFee.toFixed(2)}) is non-refundable per Hostiva policy. Reply Approve / Decline.`,
      message_type: 'system',
    });
    toast({ title: 'Goodwill request sent', description: 'Your host has been notified. They will review your request for a 100% refund (minus service fee).' });
    setCancelDialogOpen(false);
    setCancellingBooking(null);
  };

  const openHostCancelDialog = (booking: Booking) => {
    if (isReceiptDownloaded(booking.id)) {
      toast({
        title: 'Cancellation locked',
        description: 'The guest has downloaded the receipt for this booking, so it can no longer be cancelled.',
        variant: 'destructive',
      });
      return;
    }
    setHostCancellingBooking(booking);
    setHostCancelDialogOpen(true);
  };

  const handleHostConfirmCancel = async (outcome: CancellationOutcome) => {
    if (!hostCancellingBooking) return;
    await applyCancellation(hostCancellingBooking, outcome, 'host');
    setHostCancelDialogOpen(false);
    setHostCancellingBooking(null);
  };

  const handleAction = async (bookingId: string, status: 'confirmed' | 'rejected') => {
    const { error } = await supabase.from('bookings').update({ status }).eq('id', bookingId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: status === 'confirmed' ? 'Booking confirmed!' : 'Booking declined' });
      fetchBookings();
    }
  };

  // ---------- Draft bookings (pending, never paid) ----------
  // Track which draft is in-flight so the buttons can show a spinner.
  const [draftBusyId, setDraftBusyId] = useState<string | null>(null);
  const [cancelDraftId, setCancelDraftId] = useState<string | null>(null);

  // Resume payment → re-create a Paystack transaction for the existing
  // draft booking and redirect. The booking row is reused; only its status
  // flips to "confirmed" once the webhook/return URL processes payment.
  const resumeDraftPayment = async (booking: Booking) => {
    if (!booking.properties) {
      toast({ title: 'Cannot resume', description: 'Property details unavailable.', variant: 'destructive' });
      return;
    }
    // Guard 1 — already in flight for this draft (or any other). Prevents
    // back-to-back clicks from spinning up multiple Paystack sessions while
    // we're mid-redirect.
    if (draftBusyId) return;
    setDraftBusyId(booking.id);
    try {
      // Guard 2 — re-read the row from the DB. If a parallel tab already
      // completed payment (status flipped to confirmed / pending_host_approval),
      // refuse to create a new Checkout session and refresh the list instead.
      const { data: fresh } = await supabase
        .from('bookings')
        .select('id,status')
        .eq('id', booking.id)
        .maybeSingle();
      if (!fresh || fresh.status !== 'pending') {
        toast({
          title: 'Already processed',
          description: 'This booking is no longer a draft. Refreshing your list…',
        });
        setDraftBusyId(null);
        fetchBookings();
        return;
      }
      const { data, error } = await supabase.functions.invoke('create-booking-checkout', {
        body: {
          bookingId: booking.id,
          propertyTitle: booking.properties.title,
          totalPrice: Number(booking.total_price),
          currency: booking.currency || booking.properties.currency || 'USD',
          numNights: booking.num_nights,
          checkIn: format(new Date(booking.check_in_date), 'MMM d, yyyy'),
          checkOut: format(new Date(booking.check_out_date), 'MMM d, yyyy'),
        },
      });
      if (error || !data?.url) {
        toast({
          title: 'Could not start payment',
          description: error?.message || 'Paystack session could not be created. Try again.',
          variant: 'destructive',
        });
        setDraftBusyId(null);
        return;
      }
      // Note: we do NOT clear draftBusyId here — the page is about to
      // unload via the redirect. Leaving it set keeps the button disabled
      // during the transition so the user can't fire another session.
      window.location.href = data.url as string;
    } catch (err: any) {
      toast({
        title: 'Could not start payment',
        description: err?.message || 'Unexpected error.',
        variant: 'destructive',
      });
      setDraftBusyId(null);
    }
  };

  // Cancel a draft → no refund logic, no engine call (no money was ever
  // captured). Just flip status to 'cancelled' so the row leaves Drafts.
  const cancelDraft = async (bookingId: string) => {
    setDraftBusyId(bookingId);
    const { error } = await supabase
      .from('bookings')
      .update({
        status: 'cancelled',
        cancellation_reason: 'Draft cancelled by guest before payment',
        refund_amount: 0,
        refund_status: 'none',
      })
      .eq('id', bookingId);
    setDraftBusyId(null);
    setCancelDraftId(null);
    if (error) {
      toast({ title: 'Could not cancel draft', description: error.message, variant: 'destructive' });
      return;
    }
    toast({
      title: 'Draft cancelled',
      description: 'No payment was made, so no refund is due.',
    });
    fetchBookings();
  };

  // Derive a "display status" for a booking. A `confirmed` booking whose
  // check-in date has arrived (and check-out hasn't passed) is shown as
  // "In Progress" to match the lifecycle the user expects, even before the
  // server-side cron flips the row. A `confirmed` booking whose check-in is
  // still in the future is shown as "Upcoming". All other statuses pass
  // through unchanged.
  const effectiveStatus = (booking: Pick<Booking, 'status' | 'check_in_date' | 'check_out_date' | 'properties'>): string => {
    if (booking.status !== 'confirmed') return booking.status;
    const tz = booking.properties?.timezone || DEFAULT_TZ;
    const today = todayInTz(tz);
    if (booking.check_in_date <= today && booking.check_out_date > today) {
      return 'in_progress';
    }
    if (booking.check_in_date > today) {
      return 'upcoming';
    }
    return booking.status;
  };

  const getStatusBadge = (statusOrBooking: string | Pick<Booking, 'status' | 'check_in_date' | 'check_out_date' | 'properties'>) => {
    const status = typeof statusOrBooking === 'string'
      ? statusOrBooking
      : effectiveStatus(statusOrBooking);
    const variants: Record<string, { className: string }> = {
      pending: { className: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30' },
      pending_host_approval: { className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30' },
      upcoming: { className: 'bg-green-500/10 text-green-500 border-green-500/30' },
      confirmed: { className: 'bg-green-500/10 text-green-500 border-green-500/30' },
      in_progress: { className: 'bg-blue-500/10 text-blue-500 border-blue-500/30' },
      completed: { className: 'bg-primary/10 text-primary border-primary/30' },
      cancelled: { className: 'bg-destructive/10 text-destructive border-destructive/30' },
      rejected: { className: 'bg-muted text-muted-foreground border-border' },
      expired: { className: 'bg-muted text-muted-foreground border-border' },
      disputed: { className: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30' },
      no_show: { className: 'bg-destructive/10 text-destructive border-destructive/30' },
      closed: { className: 'bg-muted text-muted-foreground border-border' },
    };
    const variant = variants[status] || variants.pending;
    const label = status === 'pending_host_approval'
      ? 'Awaiting Host'
      : status === 'in_progress'
      ? 'In Progress'
      : status === 'upcoming'
      ? 'Upcoming'
      : status === 'no_show'
      ? 'No-Show'
      : status.charAt(0).toUpperCase() + status.slice(1);
    return <Badge className={variant.className}>{label}</Badge>;
  };

  // "Upcoming" = the stay hasn't ended yet (check-out is today or later in
  // the property's timezone). Comparing as YYYY-MM-DD strings against
  // today-in-property-zone avoids the off-by-one bug where a viewer in a
  // different timezone would see a booking jump between Upcoming and Past.
  const isStillActive = (b: Booking) => {
    const tz = b.properties?.timezone || DEFAULT_TZ;
    return b.check_out_date >= todayInTz(tz);
  };
  const upcomingBookings = bookings.filter((b) => {
    if (['cancelled', 'rejected', 'expired'].includes(b.status)) return false;
    const stillActive = isStillActive(b);
    if (isHostMode) return ['confirmed', 'in_progress'].includes(b.status) && stillActive;
    // Guest-side: `pending` means "awaiting Paystack payment" → shown under Drafts
    // tab instead of Upcoming. `pending_host_approval` is the RTB flow.
    return ['pending_host_approval', 'confirmed', 'in_progress'].includes(b.status) && stillActive;
  });
  // Drafts = guest-initiated bookings that never completed payment.
  // Hidden in host mode (hosts don't see other guests' drafts).
  const draftBookings = bookings.filter((b) => {
    if (isHostMode) return false;
    if (b.status !== 'pending') return false;
    // Only show drafts whose stay window hasn't already passed.
    return isStillActive(b);
  });
  const pastBookings = bookings.filter((b) => {
    if (['cancelled', 'rejected', 'expired'].includes(b.status)) return false;
    if (['completed', 'closed', 'no_show'].includes(b.status)) return true;
    return !isStillActive(b);
  });
  const cancelledBookings = bookings.filter((b) => ['cancelled', 'rejected', 'expired'].includes(b.status));

  // ---------- Apply search / filter / sort to a base list ----------
  const applyFiltersAndSort = (list: Booking[]) => {
    const q = searchQuery.trim().toLowerCase();
    let out = list.filter((b) => {
      // Property name / city / country / booking id search
      if (q) {
        const code = formatBookingId(
          b.id,
          platformSettings?.booking_id_prefix,
          platformSettings?.booking_id_length,
        ).toLowerCase();
        const haystack = [
          b.properties?.title,
          b.properties?.city,
          b.properties?.country,
          b.guest_profile?.full_name,
          b.guest_profile?.email,
          b.host_profile?.full_name,
          code,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      // Status filter
      if (statusFilter !== 'all' && b.status !== statusFilter) return false;
      // Date range — overlap test against the stay window
      if (dateFrom) {
        const checkOut = new Date(b.check_out_date).getTime();
        if (checkOut < dateFrom.setHours(0, 0, 0, 0)) return false;
      }
      if (dateTo) {
        const checkIn = new Date(b.check_in_date).getTime();
        if (checkIn > dateTo.setHours(23, 59, 59, 999)) return false;
      }
      return true;
    });
    out = [...out].sort((a, b) => {
      let av: number; let bv: number;
      if (sortKey === 'check_in_date') {
        av = new Date(a.check_in_date).getTime();
        bv = new Date(b.check_in_date).getTime();
      } else if (sortKey === 'updated_at') {
        av = new Date(a.updated_at || a.created_at).getTime();
        bv = new Date(b.updated_at || b.created_at).getTime();
      } else {
        av = Number(a.total_price);
        bv = Number(b.total_price);
      }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return out;
  };

  const upcomingFiltered = applyFiltersAndSort(upcomingBookings);
  const draftFiltered = applyFiltersAndSort(draftBookings);
  const pastFiltered = applyFiltersAndSort(pastBookings);
  const cancelledFiltered = applyFiltersAndSort(cancelledBookings);

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setDateFrom(undefined);
    setDateTo(undefined);
  };
  const hasActiveFilters =
    searchQuery.trim().length > 0 || statusFilter !== 'all' || !!dateFrom || !!dateTo;

  if (isLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <div className="animate-pulse space-y-8">
            <div className="h-8 bg-muted rounded w-1/3" />
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => <div key={i} className="h-48 bg-muted rounded-xl" />)}
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  const FeeBreakdown = ({ booking }: { booking: Booking }) => {
    const [open, setOpen] = useState(isHostMode);
    const property = booking.properties;
    if (!platformSettings || !property) return null;

    const subtotal = Number(booking.nightly_rate) * booking.num_nights;
    const cleaningFee = Number(booking.cleaning_fee || 0);
    const chargedTo = (property.service_fee_charged_to || 'guest') as 'guest' | 'host' | 'split';
    const fees = calculateFees(subtotal, platformSettings, chargedTo);
    const totalDeductions = fees.hostServiceFee + fees.hostCommissionWithTax;
    const netPayout = fees.hostPayout + cleaningFee;

    return (
      <div className="mt-3 border-t border-border pt-3">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-sm text-primary font-medium hover:underline">
          {isHostMode ? 'Earnings Breakdown' : 'Price Breakdown'} {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        {open && (
          <div className="mt-3 space-y-1 text-sm">
            {isHostMode ? (
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                {/* Revenue section */}
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Revenue</p>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">${Number(booking.nightly_rate).toFixed(2)} × {booking.num_nights} nights</span>
                  <span className="font-medium">${subtotal.toFixed(2)}</span>
                </div>
                {cleaningFee > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cleaning fee</span>
                    <span className="font-medium">${cleaningFee.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-border pt-1">
                  <span className="text-muted-foreground font-medium">Gross revenue</span>
                  <span className="font-semibold">${(subtotal + cleaningFee).toFixed(2)}</span>
                </div>

                {/* Deductions section */}
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-3 mb-1">Platform Deductions</p>
                {fees.hostServiceFee > 0 && (
                  <div className="flex justify-between text-destructive">
                    <span>Service fee ({platformSettings.service_fee_percent}% host portion)</span>
                    <span>-${fees.hostServiceFee.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-destructive">
                  <span>Platform commission ({platformSettings.host_commission_percent}%)</span>
                  <span>-${fees.hostCommission.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-destructive/80 text-xs">
                  <span className="pl-3">Commission tax ({platformSettings.host_tax_percent}%)</span>
                  <span>-${fees.hostCommissionTax.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-destructive border-t border-border pt-1">
                  <span className="font-medium">Total deductions</span>
                  <span className="font-semibold">-${totalDeductions.toFixed(2)}</span>
                </div>

                {/* Net payout */}
                <div className="flex justify-between items-center mt-2 pt-2 border-t-2 border-primary/30 bg-primary/5 -mx-3 px-3 py-2 rounded-b-lg">
                  <span className="font-bold text-base">Your Take-Home</span>
                  <span className="font-bold text-lg text-primary">${netPayout.toFixed(2)}</span>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">${Number(booking.nightly_rate).toFixed(2)} × {booking.num_nights} nights</span><span>${subtotal.toFixed(2)}</span></div>
                {cleaningFee > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Cleaning fee</span><span>${cleaningFee.toFixed(2)}</span></div>}
                {fees.guestServiceFee > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Service fee (incl. tax)</span><span>${fees.guestServiceFee.toFixed(2)}</span></div>}
                <div className="flex justify-between font-semibold border-t border-border pt-1 mt-1"><span>Total</span><span className="text-primary">${(subtotal + cleaningFee + fees.guestServiceFee).toFixed(2)}</span></div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const buildReceiptDataFor = (booking: Booking): ReceiptData | null => {
    const property = booking.properties;
    if (!property) return null;
    const subtotal = Number(booking.nightly_rate) * booking.num_nights;
    const code = formatBookingId(
      booking.id,
      platformSettings?.booking_id_prefix,
      platformSettings?.booking_id_length
    );
    return {
      bookingCode: code,
      bookingCreatedAt: booking.created_at,
      status: booking.status,
      currency: booking.currency || property.currency || 'USD',
      property: {
        title: property.title,
        propertyType: property.property_type,
        address: property.address,
        city: property.city,
        state: property.state,
        country: property.country,
        postalCode: property.postal_code,
        bedrooms: property.bedrooms,
        beds: property.beds,
        bathrooms: Number(property.bathrooms),
        maxGuests: property.max_guests,
        checkInTime: property.check_in_time,
        checkOutTime: property.check_out_time,
      },
      trip: {
        checkIn: booking.check_in_date,
        checkOut: booking.check_out_date,
        numNights: booking.num_nights,
        numGuests: booking.num_guests,
      },
      pricing: {
        nightlyRate: Number(booking.nightly_rate),
        subtotal,
        cleaningFee: Number(booking.cleaning_fee || 0),
        serviceFee: Number(booking.service_fee || 0),
        total: Number(booking.total_price),
      },
      guestName: user?.user_metadata?.full_name || user?.email || null,
      guestEmail: user?.email || null,
    };
  };

  const openReceiptPreview = (booking: Booking) => {
    if (!booking.properties) {
      toast({ title: 'Could not open receipt', description: 'Property details unavailable.', variant: 'destructive' });
      return;
    }
    setReceiptPreviewBooking(booking);
  };

  // Compact card for unpaid draft bookings — only shows trip summary,
  // total due, and the two key actions (Complete Payment / Cancel Draft).
  const DraftBookingCard = ({
    booking,
    busy,
    onComplete,
    onCancel,
  }: {
    booking: Booking;
    busy: boolean;
    onComplete: () => void;
    onCancel: () => void;
  }) => {
    const property = booking.properties;
    const tz = property?.timezone || DEFAULT_TZ;
    const code = formatBookingId(
      booking.id,
      platformSettings?.booking_id_prefix,
      platformSettings?.booking_id_length,
    );
    return (
      <Card className="card-luxury overflow-hidden h-full border-amber-500/30">
        <CardContent className="p-0">
          <div className="flex flex-col sm:flex-row h-full">
            <div className="w-full sm:w-2/5 aspect-[16/10] sm:aspect-auto bg-muted overflow-hidden flex-shrink-0">
              <img
                src={property?.cover_image || '/placeholder.svg'}
                alt={property?.title || 'Property'}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 p-5 flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30">
                      Draft · Unpaid
                    </Badge>
                    {busy && (
                      <Badge
                        className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30 animate-pulse"
                        aria-live="polite"
                      >
                        <Clock className="w-3 h-3 mr-1 animate-spin" />
                        Processing payment…
                      </Badge>
                    )}
                  </div>
                  <h3 className="font-display text-lg font-semibold mt-2 truncate">{property?.title || 'Property'}</h3>
                  {(property?.city || property?.country) && (
                    <div className="flex items-center gap-1 text-muted-foreground text-sm mt-1">
                      <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">{[property?.city, property?.country].filter(Boolean).join(', ')}</span>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-1 font-mono">{code}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-display text-xl font-bold text-primary">
                    ${Number(booking.total_price).toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">Total due</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground mt-3">
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4" />
                  {formatDateInTz(booking.check_in_date, tz, { month: 'short', day: 'numeric' })}
                  {' – '}
                  {formatDateInTz(booking.check_out_date, tz)}
                </span>
                <span className="flex items-center gap-1.5"><Clock className="w-4 h-4" />{booking.num_nights} night{booking.num_nights === 1 ? '' : 's'}</span>
                <span className="flex items-center gap-1.5"><Users className="w-4 h-4" />{booking.num_guests} guest{booking.num_guests === 1 ? '' : 's'}</span>
              </div>

              <p className="text-xs text-muted-foreground mt-3">
                Started {format(new Date(booking.created_at), 'MMM d, yyyy h:mm a')}. Dates are not held until payment is completed.
              </p>

              <div className="flex flex-wrap gap-2 mt-auto pt-4 border-t border-border/60">
                <Button
                  className="btn-gold"
                  size="sm"
                  onClick={onComplete}
                  disabled={busy}
                >
                  {busy ? 'Redirecting…' : 'Complete Payment'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/property/${property?.id}`)}
                  disabled={!property?.id}
                >
                  View Property
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onCancel}
                  disabled={busy}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 ml-auto"
                >
                  <X className="w-4 h-4 mr-1" /> Cancel Draft
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const BookingCard = ({ booking }: { booking: Booking }) => {
    const property = booking.properties;
    const guest = booking.guest_profile;
    // re-evaluated per render; receiptLockTick forces refresh after a download
    void receiptLockTick;
    const receiptLocked = isReceiptDownloaded(booking.id);

    return (
      <Card className="card-luxury overflow-hidden h-full">
        <CardContent className="p-0">
          <div className="flex flex-col lg:flex-row h-full">
            {/* LEFT: image + property summary stacked vertically */}
            <div className="w-full lg:w-1/2 flex flex-col flex-shrink-0">
              <div className="w-full aspect-[16/10] overflow-hidden bg-muted">
                <img src={property?.cover_image || '/placeholder.svg'} alt={property?.title} className="w-full h-full object-cover" />
              </div>
              <div className="p-5 flex flex-col flex-1">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    {getStatusBadge(booking)}
                    <h3 className="font-display text-xl font-semibold mt-2 truncate">{property?.title}</h3>
                    <div className="flex items-center gap-1 text-muted-foreground mt-1">
                      <MapPin className="w-4 h-4 flex-shrink-0" /><span className="truncate">{property?.city}, {property?.country}</span>
                    </div>
                    {property?.address && (
                      <p className="text-xs text-muted-foreground mt-0.5 pl-5 truncate" title={property.address}>
                        {property.address}
                      </p>
                    )}
                    {/* Show guest info in host mode */}
                    {isHostMode && guest && (
                      <div className="flex items-center gap-2 mt-2">
                        <UserCheck className="w-4 h-4 text-primary" />
                        <span className="text-sm font-medium truncate">{guest.full_name || guest.email}</span>
                      </div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-display text-2xl font-bold text-primary">${Number(booking.total_price).toLocaleString()}</p>
                    <p className="text-sm text-muted-foreground">{t('bookings.total')}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2"><Calendar className="w-4 h-4" /><span>{formatDateInTz(booking.check_in_date, booking.properties?.timezone || DEFAULT_TZ, { month: 'short', day: 'numeric' })} - {formatDateInTz(booking.check_out_date, booking.properties?.timezone || DEFAULT_TZ)}</span></div>
                  <div className="flex items-center gap-2"><Clock className="w-4 h-4" /><span>{booking.num_nights} nights</span></div>
                  <div className="flex items-center gap-2"><Users className="w-4 h-4" /><span>{booking.num_guests} guests</span></div>
                </div>

                {/* Quick actions: View Property + Message Guest/Host + Details */}
                <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-border/60">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDetailsBooking(booking)}
                    title="View details"
                  >
                    <Info className="w-4 h-4 mr-1" /> Details
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => navigate(`/property/${property?.id}`)}>
                    {t('bookings.viewProperty')}
                  </Button>
                  {(property?.latitude != null || property?.address) && (
                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                    >
                      <a
                        href={
                          property?.latitude != null && property?.longitude != null
                            ? `https://www.google.com/maps?q=${property.latitude},${property.longitude}`
                            : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([property?.address, property?.city, property?.country].filter(Boolean).join(', '))}`
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        <MapPin className="w-4 h-4 mr-1" /> Directions
                      </a>
                    </Button>
                  )}
                  {isHostMode ? (
                    <Button variant="outline" size="sm" onClick={() => navigate(`/messages?host=${booking.guest_id}`)}>
                      <MessageSquare className="w-4 h-4 mr-1" />Message Guest
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => navigate(`/messages?host=${booking.host_id}`)}>
                      <MessageSquare className="w-4 h-4 mr-1" />{t('bookings.contactHost')}
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT: contextual banners + earnings breakdown + actions */}
            <div className="w-full lg:w-1/2 p-5 flex flex-col min-w-0 border-t lg:border-t-0 lg:border-l border-border">

              {/* Host Contact Details — guest mode, active bookings only */}
              {!isHostMode && booking.host_profile && ['pending', 'confirmed'].includes(booking.status) && new Date(booking.check_out_date) >= new Date() && (
                <div className="mb-4 p-3 rounded-lg border border-primary/20 bg-primary/5">
                  <div className="flex items-center gap-3">
                    <Avatar className="w-10 h-10">
                      <AvatarImage src={booking.host_profile.avatar_url || ''} />
                      <AvatarFallback className="bg-primary/10 text-primary font-bold text-sm">
                        {(booking.host_profile.full_name || booking.host_profile.email)?.[0]?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">{booking.host_profile.full_name || 'Host'}</p>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mt-0.5">
                        <span className="flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          <a href={`mailto:${booking.host_profile.email}`} className="hover:text-primary transition-colors">{booking.host_profile.email}</a>
                        </span>
                        {booking.host_profile.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            <a href={`tel:${booking.host_profile.phone}`} className="hover:text-primary transition-colors">{booking.host_profile.phone}</a>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {booking.guest_message && (
                <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg px-3 py-2 mb-4 italic">
                  "{booking.guest_message}"
                </p>
              )}

              {/* RTB status banner — visible to guest while host decides */}
              {!isHostMode && booking.status === 'pending_host_approval' && (
                <div className="mb-4 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 flex items-start gap-2">
                  <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-amber-700 dark:text-amber-300">Waiting for host approval</p>
                    <p className="text-muted-foreground text-xs mt-0.5">
                      Your dates are tentatively held. The host has up to 24 hours to accept or decline.
                      {booking.host_approval_deadline && (
                        <> Expires {format(new Date(booking.host_approval_deadline), 'MMM d, h:mm a')}.</>
                      )}
                      {' '}You'll be notified the moment they respond — no charge until accepted.
                    </p>
                  </div>
                </div>
              )}

              {!isHostMode && booking.status === 'expired' && (
                <div className="mb-4 p-3 rounded-lg border border-border bg-muted/40 flex items-start gap-2">
                  <Clock className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium">Request expired</p>
                    <p className="text-muted-foreground text-xs mt-0.5">
                      The host didn't respond within 24 hours. Your payment authorisation has been released — no charge to your card.
                    </p>
                  </div>
                </div>
              )}

              {!isHostMode && booking.status === 'rejected' && booking.host_declined_at && (
                <div className="mb-4 p-3 rounded-lg border border-border bg-muted/40 flex items-start gap-2">
                  <XCircle className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium">Request declined by host</p>
                    <p className="text-muted-foreground text-xs mt-0.5">
                      Your card has not been charged. Find similar listings on the search page.
                    </p>
                  </div>
                </div>
              )}

              <FeeBreakdown booking={booking} />

              <div className="flex flex-wrap gap-2 mt-3">
                {/* View Receipt — visible for any booking where payment has been
                    captured (confirmed / in-progress / completed). Re-downloadable
                    once first downloaded; cancellation becomes locked thereafter. */}
                {['confirmed', 'completed', 'in_progress'].includes(booking.status) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openReceiptPreview(booking)}
                    title={receiptLocked ? 'Re-download receipt' : 'View / download receipt'}
                  >
                    {receiptLocked ? <Download className="w-4 h-4 mr-1" /> : <FileText className="w-4 h-4 mr-1" />}
                    {receiptLocked ? 'Re-download Receipt' : 'View Receipt'}
                  </Button>
                )}

                {isHostMode ? (
                  <>
                    {/* Host-initiated cancellation — allowed any time before check-in.
                        Penalty/payout are computed by the cancellation engine per
                        the platform policy (Section 8.4). */}
                    {['confirmed'].includes(booking.status) && !receiptLocked && (
                      <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive hover:text-destructive-foreground" onClick={() => openHostCancelDialog(booking)}>
                        <X className="w-4 h-4 mr-1" /> Cancel Booking
                      </Button>
                    )}
                    {booking.status === 'completed' && !mutualReviewedBookingIds.has(booking.id) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setMutualReviewBooking(booking)}
                        disabled={!reviewsAllowed}
                        title={!reviewsAllowed ? 'Reviews are temporarily disabled by the platform' : undefined}
                      >
                        <Star className="w-4 h-4 mr-1" /> Rate Guest
                      </Button>
                    )}
                    {booking.status === 'completed' && mutualReviewedBookingIds.has(booking.id) && (
                      <MutualReviewStatusBadge state={mutualReviewState[booking.id]} myLabel="Guest Rated" />
                    )}
                  </>
                ) : (
                  <>
                    {booking.status === 'confirmed' && (() => {
                      const today = new Date(); today.setHours(0,0,0,0);
                      const checkIn = new Date(booking.check_in_date);
                      const checkOut = new Date(booking.check_out_date);
                      const arrivalWindowOpen = today >= addDays(checkIn, -1) && today <= addDays(checkOut, 1);
                      if (!arrivalWindowOpen) return null;
                      return (
                        <>
                          <ArrivalConfirmButton
                            bookingId={booking.id}
                            hostId={booking.host_id}
                            guestId={booking.guest_id}
                            alreadyArrived={!!booking.actual_check_in_at}
                            onConfirmed={fetchBookings}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { setIssueBooking(booking); setIssueDialogOpen(true); }}
                          >
                            <AlertTriangle className="w-4 h-4 mr-1" /> Report Issue
                          </Button>
                        </>
                      );
                    })()}
                    {booking.status === 'completed' && !reviewedBookingIds.has(booking.id) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setReviewBooking(booking)}
                        disabled={!reviewsAllowed}
                        title={!reviewsAllowed ? 'Reviews are temporarily disabled by the platform' : undefined}
                      >
                        <Star className="w-4 h-4 mr-1" />{t('bookings.leaveReview')}
                      </Button>
                    )}
                    {booking.status === 'completed' && reviewedBookingIds.has(booking.id) && (
                      <Badge variant="outline" className="gap-1 text-green-600 border-green-500/30">
                        <CheckCircle className="w-3.5 h-3.5" /> Reviewed
                      </Badge>
                    )}
                    {/* "Rate Your Stay" (mutual blind review) removed — guests rate the
                        property exclusively via the "Leave Review" entry above so there
                        is a single, unambiguous review path. */}
                    {booking.status === 'completed' && mutualReviewedBookingIds.has(booking.id) && (
                      <MutualReviewStatusBadge state={mutualReviewState[booking.id]} myLabel="Stay Rated" />
                    )}
                    {/* Guest-initiated cancellation — refund computed by the
                        cancellation engine per platform policy (Section 8.1–8.6):
                        24-hour grace period, tiered refunds based on host policy,
                        cleaning/service fee handling, and non-refundable rate logic. */}
                    {/* Guest-initiated date modification — only allowed before
                        check-in. Extending charges the price delta via Paystack;
                        shortening triggers a partial refund through the same
                        cancellation engine on the dropped nights. */}
                    {!isHostMode &&
                      ['confirmed', 'in_progress'].includes(effectiveStatus(booking)) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setModifyBooking(booking)}
                        >
                          <Calendar className="w-4 h-4 mr-1" /> Modify Booking
                        </Button>
                      )}
                    {['pending', 'pending_host_approval', 'confirmed'].includes(booking.status) && !receiptLocked && (
                      <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive hover:text-destructive-foreground" onClick={() => openCancelDialog(booking)}>
                        <X className="w-4 h-4 mr-1" /> Cancel Booking
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold">
            {isHostMode ? 'Client Reservations' : t('bookings.myBookings')}
          </h1>
          {isHostMode && (
            <p className="text-muted-foreground mt-1">Reservations made by guests on your properties</p>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setSearchParams({ tab: v }, { replace: true }); }}>
          {/* Search / filter / sort toolbar */}
          <div className="mb-4 flex flex-col lg:flex-row gap-3 lg:items-center">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by property, city, booking ID, or guest…"
                className="pl-9"
                aria-label="Search bookings"
              />
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px]" aria-label="Filter by status">
                  <Filter className="w-3.5 h-3.5 mr-1" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="pending_host_approval">Awaiting host</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="in_progress">In progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="no_show">No-show</SelectItem>
                </SelectContent>
              </Select>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn('justify-start font-normal', !dateFrom && 'text-muted-foreground')}
                  >
                    <Calendar className="w-3.5 h-3.5 mr-1" />
                    {dateFrom ? format(dateFrom, 'MMM d, yyyy') : 'From'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker
                    mode="single"
                    selected={dateFrom}
                    onSelect={setDateFrom}
                    initialFocus
                    className={cn('p-3 pointer-events-auto')}
                  />
                </PopoverContent>
              </Popover>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn('justify-start font-normal', !dateTo && 'text-muted-foreground')}
                  >
                    <Calendar className="w-3.5 h-3.5 mr-1" />
                    {dateTo ? format(dateTo, 'MMM d, yyyy') : 'To'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker
                    mode="single"
                    selected={dateTo}
                    onSelect={setDateTo}
                    initialFocus
                    className={cn('p-3 pointer-events-auto')}
                  />
                </PopoverContent>
              </Popover>
              <Select value={sortKey} onValueChange={(v) => setSortKey(v as typeof sortKey)}>
                <SelectTrigger className="w-[170px]" aria-label="Sort by">
                  <ArrowUpDown className="w-3.5 h-3.5 mr-1" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="check_in_date">Check-in date</SelectItem>
                  <SelectItem value="total_price">Total price</SelectItem>
                  <SelectItem value="updated_at">Last updated</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                title={sortDir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
                aria-label="Toggle sort direction"
              >
                {sortDir === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </Button>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} title="Clear all filters">
                  <X className="w-4 h-4 mr-1" /> Clear
                </Button>
              )}
            </div>
          </div>

          <TabsList className="mb-6">
            <TabsTrigger value="upcoming">
              {isHostMode ? 'Active' : t('bookings.upcoming')} ({upcomingFiltered.length})
            </TabsTrigger>
            {!isHostMode && (
              <TabsTrigger value="drafts">
                Drafts ({draftFiltered.length})
              </TabsTrigger>
            )}
            <TabsTrigger value="past">
              {t('bookings.past')} ({pastFiltered.length})
            </TabsTrigger>
            <TabsTrigger value="cancelled">
              {t('bookings.cancelled')} ({cancelledFiltered.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upcoming">
            {upcomingFiltered.length > 0 ? (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">{upcomingFiltered.map((b) => <BookingCard key={b.id} booking={b} />)}</div>
            ) : (
              <div className="card-luxury text-center py-16">
                <Calendar className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-display text-xl font-semibold mb-2">
                  {isHostMode ? 'No active reservations' : t('bookings.noUpcoming')}
                </h3>
                <p className="text-muted-foreground mb-6">
                  {isHostMode ? 'New guest reservations will appear here' : t('bookings.startExploring')}
                </p>
                {!isHostMode && (
                  <Button className="btn-gold" onClick={() => navigate('/search')}>{t('bookings.exploreProperties')}</Button>
                )}
              </div>
            )}
          </TabsContent>

          {!isHostMode && (
            <TabsContent value="drafts">
              {draftFiltered.length > 0 ? (
                <>
                  <div className="mb-4 p-4 rounded-lg border border-amber-500/30 bg-amber-500/5 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium text-amber-700 dark:text-amber-300">Drafts are bookings awaiting payment</p>
                      <p className="text-muted-foreground text-xs mt-0.5">
                        Complete payment to confirm your reservation. Drafts hold no calendar dates and will not affect availability for other guests.
                        Cancelling a draft is free — no payment was taken.
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    {draftFiltered.map((b) => (
                      <DraftBookingCard
                        key={b.id}
                        booking={b}
                        busy={draftBusyId === b.id}
                        onComplete={() => resumeDraftPayment(b)}
                        onCancel={() => setCancelDraftId(b.id)}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <div className="card-luxury text-center py-16">
                  <FileText className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                  <h3 className="font-display text-xl font-semibold mb-2">No draft bookings</h3>
                  <p className="text-muted-foreground">
                    Bookings appear here when you start a reservation but don't complete payment.
                  </p>
                </div>
              )}
            </TabsContent>
          )}

          <TabsContent value="past">
            {pastFiltered.length > 0 ? (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">{pastFiltered.map((b) => <BookingCard key={b.id} booking={b} />)}</div>
            ) : (
              <div className="card-luxury text-center py-16">
                <Clock className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-display text-xl font-semibold mb-2">{t('bookings.noPast')}</h3>
                <p className="text-muted-foreground">{isHostMode ? 'Completed guest stays will appear here' : t('bookings.completedTrips')}</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="cancelled">
            {cancelledFiltered.length > 0 ? (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">{cancelledFiltered.map((b) => <BookingCard key={b.id} booking={b} />)}</div>
            ) : (
              <div className="card-luxury text-center py-16">
                <X className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-display text-xl font-semibold mb-2">{t('bookings.noCancelled')}</h3>
                <p className="text-muted-foreground">{t('bookings.noCancelledDesc')}</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Booking details drawer (quick action) */}
      <Sheet open={!!detailsBooking} onOpenChange={(open) => !open && setDetailsBooking(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {detailsBooking && (() => {
            const prop = detailsBooking.properties;
            const code = formatBookingId(
              detailsBooking.id,
              platformSettings?.booking_id_prefix,
              platformSettings?.booking_id_length,
            );
            const counterpart = isHostMode ? detailsBooking.guest_profile : detailsBooking.host_profile;
            return (
              <>
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2">
                    Booking Details
                    {getStatusBadge(detailsBooking)}
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
                      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Nights</p>
                      <p className="font-medium">{detailsBooking.num_nights}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Guests</p>
                      <p className="font-medium">{detailsBooking.num_guests}</p>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>${Number(detailsBooking.subtotal).toFixed(2)}</span></div>
                    {Number(detailsBooking.cleaning_fee || 0) > 0 && (
                      <div className="flex justify-between"><span className="text-muted-foreground">Cleaning fee</span><span>${Number(detailsBooking.cleaning_fee).toFixed(2)}</span></div>
                    )}
                    {Number(detailsBooking.service_fee || 0) > 0 && (
                      <div className="flex justify-between"><span className="text-muted-foreground">Service fee</span><span>${Number(detailsBooking.service_fee).toFixed(2)}</span></div>
                    )}
                    <div className="flex justify-between font-semibold border-t border-border pt-1.5 mt-1.5">
                      <span>Total</span>
                      <span className="text-primary">${Number(detailsBooking.total_price).toFixed(2)}</span>
                    </div>
                  </div>

                  {counterpart && (
                    <>
                      <Separator />
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                          {isHostMode ? 'Guest' : 'Host'}
                        </p>
                        <div className="flex items-center gap-3">
                          <Avatar className="w-10 h-10">
                            <AvatarImage src={counterpart.avatar_url || ''} />
                            <AvatarFallback className="bg-primary/10 text-primary text-sm font-bold">
                              {(counterpart.full_name || counterpart.email || '?')[0]?.toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="font-medium truncate">{counterpart.full_name || counterpart.email}</p>
                            <p className="text-xs text-muted-foreground truncate">{counterpart.email}</p>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {detailsBooking.guest_message && (
                    <>
                      <Separator />
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Guest message</p>
                        <p className="text-sm italic bg-muted/40 rounded-lg px-3 py-2">"{detailsBooking.guest_message}"</p>
                      </div>
                    </>
                  )}

                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/messages?host=${isHostMode ? detailsBooking.guest_id : detailsBooking.host_id}`)}
                    >
                      <MessageSquare className="w-4 h-4 mr-1" />
                      {isHostMode ? 'Message Guest' : t('bookings.contactHost')}
                    </Button>
                    {['confirmed', 'completed', 'in_progress'].includes(detailsBooking.status) && (
                      <Button variant="outline" size="sm" onClick={() => openReceiptPreview(detailsBooking)}>
                        <FileText className="w-4 h-4 mr-1" /> Receipt
                      </Button>
                    )}
                  </div>
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* Guest Cancellation Preview — 16-tier engine */}
      {cancellingBooking && (() => {
        const ledger = validateBookingLedger(cancellingBooking);
        if (!ledger.valid) {
          return (
            <Dialog open={cancelDialogOpen} onOpenChange={(open) => { setCancelDialogOpen(open); if (!open) setCancellingBooking(null); }}>
              <DialogContent className="sm:max-w-md" data-testid="ledger-validation-error">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="w-5 h-5" /> Cannot calculate refund
                  </DialogTitle>
                  <DialogDescription>
                    This booking is missing required ledger fields, so we can't safely compute the cancellation refund.
                    Please contact support before proceeding.
                  </DialogDescription>
                </DialogHeader>
                <ul className="text-sm text-destructive space-y-1 list-disc pl-5">
                  {ledger.issues.map((i) => (
                    <li key={i.field} data-field={i.field}>{i.label}: {i.message}</li>
                  ))}
                </ul>
                <DialogFooter>
                  <Button variant="outline" onClick={() => { setCancelDialogOpen(false); setCancellingBooking(null); }}>Close</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          );
        }
        return (
        <CancellationPreviewDialog
          open={cancelDialogOpen}
          onOpenChange={(open) => { setCancelDialogOpen(open); if (!open) setCancellingBooking(null); }}
          input={buildCancellationInput(cancellingBooking, 'guest')}
          currency={cancellingBooking.currency || cancellingBooking.properties?.currency || 'USD'}
          onConfirm={handleGuestConfirmCancel}
          onRequestGoodwill={handleGuestRequestFreeCancellation}
          isSubmitting={isCancelSubmitting}
          policy={effectivePolicy}
          originalTotalPaid={Number(cancellingBooking.total_price || 0)}
        />
        );
      })()}

      {/* Host Cancellation Preview — same engine, host-initiated */}
      {hostCancellingBooking && (() => {
        const ledger = validateBookingLedger(hostCancellingBooking);
        if (!ledger.valid) {
          return (
            <Dialog open={hostCancelDialogOpen} onOpenChange={(open) => { setHostCancelDialogOpen(open); if (!open) setHostCancellingBooking(null); }}>
              <DialogContent className="sm:max-w-md" data-testid="ledger-validation-error-host">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="w-5 h-5" /> Cannot calculate refund
                  </DialogTitle>
                  <DialogDescription>
                    This booking is missing required ledger fields, so we can't safely compute the cancellation refund.
                  </DialogDescription>
                </DialogHeader>
                <ul className="text-sm text-destructive space-y-1 list-disc pl-5">
                  {ledger.issues.map((i) => (
                    <li key={i.field} data-field={i.field}>{i.label}: {i.message}</li>
                  ))}
                </ul>
                <DialogFooter>
                  <Button variant="outline" onClick={() => { setHostCancelDialogOpen(false); setHostCancellingBooking(null); }}>Close</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          );
        }
        return (
        <CancellationPreviewDialog
          open={hostCancelDialogOpen}
          onOpenChange={(open) => { setHostCancelDialogOpen(open); if (!open) setHostCancellingBooking(null); }}
          input={buildCancellationInput(hostCancellingBooking, 'host')}
          currency={hostCancellingBooking.currency || hostCancellingBooking.properties?.currency || 'USD'}
          onConfirm={handleHostConfirmCancel}
          isSubmitting={isCancelSubmitting}
          policy={effectivePolicy}
          originalTotalPaid={Number(hostCancellingBooking.total_price || 0)}
        />
        );
      })()}

      {/* Host post-cancellation payout summary */}
      {hostSummaryOutcome && (
        <HostCancellationSummary
          open={hostSummaryOpen}
          onOpenChange={setHostSummaryOpen}
          outcome={hostSummaryOutcome}
          guestName={hostSummaryGuestName}
          hoursUntilCheckIn={hostSummaryHours}
        />
      )}

      {/* Review Form Dialog */}
      {reviewBooking && (
        <ReviewForm
          open={!!reviewBooking}
          onOpenChange={(open) => { if (!open) setReviewBooking(null); }}
          bookingId={reviewBooking.id}
          propertyId={reviewBooking.property_id}
          hostId={reviewBooking.host_id}
          propertyTitle={reviewBooking.properties?.title || 'Property'}
          onReviewSubmitted={() => {
            fetchReviewedBookings();
            setReviewBooking(null);
          }}
        />
      )}

      {/* Mutual Review Form Dialog */}
      {mutualReviewBooking && platformSettings && (
        <MutualReviewForm
          open={!!mutualReviewBooking}
          onOpenChange={(open) => { if (!open) setMutualReviewBooking(null); }}
          bookingId={mutualReviewBooking.id}
          propertyId={mutualReviewBooking.property_id}
          guestId={mutualReviewBooking.guest_id}
          hostId={mutualReviewBooking.host_id}
          checkOutDate={mutualReviewBooking.check_out_date}
          reviewWindowDays={platformSettings.review_window_days}
          reviewerType={isHostMode ? 'host' : 'guest'}
          targetName={
            isHostMode
              ? (mutualReviewBooking as any).guest_profile?.full_name || 'Guest'
              : (mutualReviewBooking as any).host_profile?.full_name || 'Host'
          }
          onReviewSubmitted={() => {
            fetchMutualReviewedBookings();
            setMutualReviewBooking(null);
          }}
        />
      )}

      {/* Receipt Preview & Download Dialog */}
      <ReceiptPreviewDialog
        open={!!receiptPreviewBooking}
        onOpenChange={(open) => { if (!open) setReceiptPreviewBooking(null); }}
        bookingId={receiptPreviewBooking?.id || ''}
        receiptData={receiptPreviewBooking ? buildReceiptDataFor(receiptPreviewBooking) : null}
        onDownloaded={() => setReceiptLockTick((n) => n + 1)}
      />

      {/* Report-an-Issue Dialog (guest, during stays) */}
      {issueBooking && (
        <ReportIssueDialog
          open={issueDialogOpen}
          onOpenChange={(o) => { setIssueDialogOpen(o); if (!o) setIssueBooking(null); }}
          bookingId={issueBooking.id}
          propertyId={issueBooking.property_id}
          guestId={issueBooking.guest_id}
          hostId={issueBooking.host_id}
        />
      )}

      {/* Modify-booking dialog (guest, before check-in) */}
      {modifyBooking && (
        <ModifyBookingDialog
          open={!!modifyBooking}
          onOpenChange={(o) => { if (!o) setModifyBooking(null); }}
          booking={modifyBooking as any}
          onModified={fetchBookings}
        />
      )}

      {/* Cancel Draft Confirmation Dialog */}
      <Dialog
        open={!!cancelDraftId}
        onOpenChange={(open) => { if (!open) setCancelDraftId(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this draft booking?</DialogTitle>
            <DialogDescription>
              No payment was ever taken for this draft, so <strong>no refund is due</strong>.
              The draft will be removed from your list and the dates remain available for other guests.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCancelDraftId(null)}
              disabled={!!draftBusyId}
            >
              Keep draft
            </Button>
            <Button
              variant="destructive"
              onClick={() => cancelDraftId && cancelDraft(cancelDraftId)}
              disabled={!!draftBusyId}
            >
              {draftBusyId ? 'Cancelling…' : 'Yes, cancel draft'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}