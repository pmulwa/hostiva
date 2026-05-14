import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePlatformSettings, calculateFees, formatBookingId } from '@/hooks/usePlatformSettings';
import type { ReceiptData } from '@/lib/generateReceiptPdf';
import { ReceiptPreviewDialog } from '@/components/ReceiptPreviewDialog';
import { ModifyBookingDialog } from '@/components/booking/ModifyBookingDialog';
import { shouldShowModifyButton } from '@/lib/modifyBookingVisibility';
import { hydrateReceiptLocksFromBookings } from '@/lib/receiptLock';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { dispatchNotification, dispatchToRoles } from '@/lib/notifications/dispatcher';
import {
  CheckCircle2, Calendar, Users, MapPin, Clock, ArrowRight, Home,
  DollarSign, Printer, MessageSquare, Phone, Mail, User, XCircle,
  CreditCard, Receipt, AlertTriangle, Download, Bed, Bath, Eye,
  RefreshCw, Circle, ArrowLeft, CalendarDays,
} from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import type { Database } from '@/integrations/supabase/types';

type Booking = Database['public']['Tables']['bookings']['Row'];
type Property = Database['public']['Tables']['properties']['Row'];
type Profile = Database['public']['Tables']['profiles']['Row'];

export default function BookingConfirmation() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { settings: platformSettings } = usePlatformSettings();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [property, setProperty] = useState<Property | null>(null);
  const [hostProfile, setHostProfile] = useState<Profile | null>(null);
  const [guestProfile, setGuestProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const receiptRef = useRef<HTMLDivElement>(null);
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false);
  // Guest-initiated booking modification (date change / extension). Only
  // surfaced for confirmed bookings before check-in — mirrors the action
  // already available on the /bookings list.
  const [modifyOpen, setModifyOpen] = useState(false);

  const paymentStatus = searchParams.get('payment');
  // Paystack returns ?reference=hostiva-bk-... in the callback URL.
  // URL. Forwarding it to the confirm function lets the server retrieve the
  // session by ID directly (cheap, version-independent) instead of relying on

  const paystackReference = searchParams.get("reference"); // Paystack reference
  // Set when the guest returns from a booking-modification Paystack checkout
  // (extending dates / paying the price delta). Triggers the modification
  // confirm function and refetches the booking. Triggers the modification
  const modificationStatus = searchParams.get('modification');
  // In-session guard so the realtime + polling + initial-confirm paths don't
  // each fire the success toast separately. The cross-refresh guard is the
  // localStorage key `bookings:lastConfirmedToastId` checked below.
  const confirmedToastShownRef = useRef(false);
  // True once we've waited the full 30s polling window without seeing the
  // booking flip to a non-pending state — surfaces the manual Retry button.
  const [confirmStalled, setConfirmStalled] = useState(false);
  const [manualRetrying, setManualRetrying] = useState(false);

  // localStorage key that remembers the last bookingId we toasted "confirmed"
  // for. Ensures that even if the user refreshes /booking-confirmation/:id
  // (or returns later from email link) we don't pop the success toast twice.
  const TOAST_DEDUPE_KEY = 'bookings:lastConfirmedToastId';

  useEffect(() => {
    if (id) fetchBooking();
  }, [id]);

  // Real-time subscription for booking status updates
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`booking-${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=eq.${id}` },
        (payload) => {
          const updated = payload.new as Booking;
          setBooking((prev) => prev ? { ...prev, ...updated } : prev);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id]);

  // Fallback polling: if we land here with payment=success but the booking
  // is still pending (realtime missed it / edge fn slow), poll the row every
  // 2s for up to 30s and also re-invoke the confirm function. This is the
  // belt-and-suspenders safety net — realtime stays the primary path.
  useEffect(() => {
    if (paymentStatus !== 'success' || !id) return;
    if (booking && booking.status !== 'pending' && booking.status !== 'draft') return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 15; // 15 × 2s = 30s

    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      try {
        // Re-ask the server to verify Paystack + flip the row (idempotent)
        await supabase.functions.invoke('confirm-booking-payment', {
          body: { bookingId: id, reference: paystackReference },
        });
      } catch {
        /* ignore — we'll still refetch */
      }
      const { data } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setBooking((prev) => (prev ? { ...prev, ...(data as Booking) } : (data as Booking)));
        if ((data as Booking).status !== 'pending') {
          // Notify other pages to refetch their lists
          try {
            localStorage.setItem('bookings:refetch', String(Date.now()));
            window.dispatchEvent(new CustomEvent('bookings:refetch', { detail: { bookingId: id } }));
          } catch {}
          return;
        }
      }
      if (attempts < maxAttempts) {
        setTimeout(tick, 2000);
      } else {
        // Polling window exhausted without flip — expose the manual
        // "Retry confirmation" button so the guest is never stuck.
        if (!cancelled) setConfirmStalled(true);
      }
    };
    const timer = setTimeout(tick, 2000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [paymentStatus, id, booking?.status]);

  // Modification confirmation flow — runs in parallel to the regular payment
  // confirm path. When the guest returns from `?modification=success`, we ask
  // the server to verify the Paystack transaction that paid the price delta, then
  // apply the staged `pending_modification` dates.
  useEffect(() => {
    if (modificationStatus !== 'success' || !id) return;
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 15;
    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      try {
        await supabase.functions.invoke('confirm-booking-modification', {
          body: { bookingId: id, reference: paystackReference },
        });
      } catch {
        /* ignore — refetch will tell us */
      }
      const { data } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (cancelled || !data) return;
      setBooking((prev) => (prev ? { ...prev, ...(data as Booking) } : (data as Booking)));
      if (!(data as any).pending_modification) {
        try {
          localStorage.setItem('bookings:refetch', String(Date.now()));
          window.dispatchEvent(new CustomEvent('bookings:refetch', { detail: { bookingId: id } }));
        } catch {}
        return;
      }
      if (attempts < maxAttempts) setTimeout(tick, 2000);
    };
    const timer = setTimeout(tick, 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [modificationStatus, id, paystackReference]);

  useEffect(() => {
    if (paymentStatus === 'success' && booking && booking.status === 'pending' && property) {
      const confirmAndNotify = async () => {
        // Server-authoritative: ask the edge function to verify the Paystack
        // session and flip the row using the service role. This means even if
        // the guest never returned to this page (closed the tab, slow network),
        // a later visit by the host will still see "confirmed" — and for the
        // current visitor we get an instant, race-safe upgrade.
        try {
          await supabase.functions.invoke('confirm-booking-payment', {
            body: { bookingId: booking.id, reference: paystackReference },
          });
        } catch (err) {
          console.error('[booking-confirm] verify failed, falling back', err);
          // Best-effort fallback — if the edge function is unreachable we still
          // try the direct update (will only succeed for the booking owner).
          await supabase.from('bookings').update({ status: 'confirmed' }).eq('id', booking.id);
        }
        setBooking({ ...booking, status: 'confirmed' });
        // Signal other tabs/pages (e.g. /bookings, host calendar) to refetch.
        // Realtime is the primary path, but this guarantees a refresh even if
        // the websocket dropped or the subscription missed the change.
        try {
          localStorage.setItem('bookings:refetch', String(Date.now()));
          window.dispatchEvent(new CustomEvent('bookings:refetch', { detail: { bookingId: booking.id } }));
        } catch {}
        if (user) {
          const fullCode = formatBookingId(
            booking.id,
            platformSettings?.booking_id_prefix,
            platformSettings?.booking_id_length
          );
          // Multi-channel booking-confirmed notification to both parties
          void dispatchToRoles(
            {
              eventType: 'booking_confirmed',
              subject: `Booking confirmed — ${property.title}`,
              body: `Booking ${fullCode} confirmed for ${format(new Date(booking.check_in_date), 'MMM d')} – ${format(new Date(booking.check_out_date), 'MMM d, yyyy')}. Total: $${Number(booking.total_price).toFixed(2)}.`,
              relatedEntityType: 'booking',
              relatedEntityId: booking.id,
            },
            [
              { userId: user.id, role: 'guest' },
              { userId: property.host_id, role: 'host' },
            ],
          );
          // Admin "[Admin] New booking" notifications were removed — guests
          // and hosts already receive the "Booking confirmed" notification
          // above, and admins can monitor new bookings from the dashboard
          // without a duplicate bell entry.
        }
        // The dedicated "status flipped to confirmed" effect below shows the
        // success toast (once) and handles the auto-redirect, so we don't
        // duplicate it here.
      };
      confirmAndNotify();
    }
    // Payment failed/cancelled — notify the guest across channels
    if (paymentStatus === 'cancelled' && booking && user && booking.guest_id === user.id) {
      void dispatchNotification({
        userId: user.id,
        eventType: 'payment_failed',
        role: 'guest',
        subject: 'Payment was not completed',
        body: `Your payment for ${property?.title ?? 'your booking'} did not go through. Tap "Retry payment" to try again — your dates are held until you confirm.`,
        relatedEntityType: 'booking',
        relatedEntityId: booking.id,
      });
    }
  }, [paymentStatus, booking?.id, property?.host_id]);

  // Auto-recovery for the cancelled-redirect path. When Paystack sends the
  // guest back here with `?payment=cancelled`, the booking row is still
  // `pending` — i.e. it belongs in Drafts. We (1) broadcast a refetch so
  // /bookings refreshes its list without a manual reload, (2) show a single
  // toast, and (3) auto-route the user to the Drafts tab so they can resume
  // or cancel. Ref guard makes this fire exactly once per page load.
  const cancelledHandledRef = useRef(false);
  useEffect(() => {
    if (paymentStatus !== 'cancelled') return;
    if (!booking) return;
    if (cancelledHandledRef.current) return;
    cancelledHandledRef.current = true;

    // Push a refetch signal so /bookings (and any other listening tab)
    // re-pulls the row immediately — the draft stays in Drafts because
    // its status is still `pending`.
    try {
      localStorage.setItem('bookings:refetch', String(Date.now()));
      window.dispatchEvent(new CustomEvent('bookings:refetch', { detail: { bookingId: booking.id } }));
    } catch {}

    toast.info('Payment was cancelled — your booking is still in Drafts. You can resume or cancel it there.');

    const timer = setTimeout(() => {
      navigate('/bookings?tab=drafts', { replace: true });
    }, 1800);
    return () => clearTimeout(timer);
  }, [paymentStatus, booking?.id, navigate]);

  // Single source of truth for the "payment confirmed" UX: when the booking
  // status transitions to `confirmed` after a payment=success redirect — no
  // matter which path got it there (initial confirm, realtime UPDATE, or the
  // polling fallback) — we (1) re-broadcast the refetch signal so the guest
  // and host lists pick it up, (2) show the success toast exactly once, and
  // (3) redirect to /bookings?tab=upcoming. The ref guard prevents duplicate
  // toasts when multiple paths race to the same final state.
  useEffect(() => {
    if (paymentStatus !== 'success') return;
    if (!booking || booking.status !== 'confirmed') return;
    if (confirmedToastShownRef.current) return;
    // Cross-refresh dedupe: if we already toasted this booking on a prior
    // page load (e.g. user hit refresh after the redirect), skip the toast
    // entirely but still keep the auto-redirect / refetch broadcast.
    let alreadyToasted = false;
    try {
      alreadyToasted = localStorage.getItem(TOAST_DEDUPE_KEY) === booking.id;
    } catch {}
    confirmedToastShownRef.current = true;
    // Confirmed — no longer "stalled", hide the retry button if it surfaced.
    setConfirmStalled(false);

    // Re-broadcast — guarantees the lists refetch after status flip even if
    // they mounted before the row updated.
    try {
      localStorage.setItem('bookings:refetch', String(Date.now()));
      window.dispatchEvent(new CustomEvent('bookings:refetch', { detail: { bookingId: booking.id } }));
    } catch {}

    if (!alreadyToasted) {
      toast.success('Payment confirmed — your booking is now visible in Upcoming.');
      try { localStorage.setItem(TOAST_DEDUPE_KEY, booking.id); } catch {}
    }
    const timer = setTimeout(() => {
      navigate('/bookings?tab=upcoming', { replace: true });
    }, 2200);
    return () => clearTimeout(timer);
  }, [paymentStatus, booking?.status, booking?.id, navigate]);


  const fetchBooking = async () => {
    const { data, error } = await supabase
      .from('bookings')
      .select('*, properties(*)')
      .eq('id', id)
      .single();

    if (error || !data) {
      navigate('/bookings');
      return;
    }

    setBooking(data);
    // Hydrate the local cancellation lock from DB so it works on a new device/browser
    await hydrateReceiptLocksFromBookings([data as any]);
    const prop = (data as any).properties as Property;
    setProperty(prop);

    if (prop?.host_id) {
      const [{ data: hProfile }, { data: gProfile }] = await Promise.all([
        supabase.from('profiles').select('*').eq('user_id', prop.host_id).single(),
        supabase.from('profiles').select('*').eq('user_id', data.guest_id).single(),
      ]);
      if (hProfile) setHostProfile(hProfile);
      if (gProfile) setGuestProfile(gProfile);
    }
    setIsLoading(false);
  };

  // Manual escape hatch for the "payment=success but never confirmed" edge
  // case. Re-invokes the server confirm function, refetches the booking row,
  // and broadcasts a refetch to the guest/host lists. Surfaced in the UI
  // only after the 30-second polling window elapses without a status flip.
  const handleManualRetryConfirmation = async () => {
    if (!booking) return;
    setManualRetrying(true);
    try {
      await supabase.functions.invoke('confirm-booking-payment', {
        body: { bookingId: booking.id, reference: paystackReference },
      });
      const { data: fresh } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', booking.id)
        .maybeSingle();
      if (fresh) {
        setBooking((prev) => (prev ? { ...prev, ...(fresh as Booking) } : (fresh as Booking)));
      }
      // Always re-broadcast — guest/host lists refetch even if the row was
      // already up-to-date (cheap, idempotent).
      try {
        localStorage.setItem('bookings:refetch', String(Date.now()));
        window.dispatchEvent(new CustomEvent('bookings:refetch', { detail: { bookingId: booking.id } }));
      } catch {}
      if ((fresh as Booking | null)?.status === 'pending') {
        toast.error("We still couldn't verify the payment. Please contact support if your card was charged.");
      } else {
        // Successful re-check — clear the stalled banner; the dedicated
        // confirmed-toast effect will fire the success toast on the next render.
        setConfirmStalled(false);
      }
    } catch (err) {
      console.error('[booking-confirm] manual retry failed', err);
      toast.error('Could not reach the confirmation service. Please try again in a moment.');
    } finally {
      setManualRetrying(false);
    }
  };

  const handleRetryPayment = async () => {
    if (!booking || !property) return;
    setRetrying(true);
    try {
      const { data: checkoutData } = await supabase.functions.invoke('create-booking-checkout', {
        body: {
          bookingId: booking.id,
          propertyTitle: property.title,
          totalPrice: Number(booking.total_price),
          currency: booking.currency || property.currency || 'USD',
          numNights: booking.num_nights,
          checkIn: booking.check_in_date,
          checkOut: booking.check_out_date,
        },
      });
      if (checkoutData?.url) window.location.href = checkoutData.url;
    } catch (err) {
      console.error('Retry payment failed:', err);
    } finally {
      setRetrying(false);
    }
  };

  const buildReceiptData = (): ReceiptData | null => {
    if (!booking || !property) return null;
    const subtotal = Number(booking.nightly_rate) * booking.num_nights;
    const cleaning = Number(booking.cleaning_fee || 0);
    const service = Number(booking.service_fee || 0);
    const totalAmt = Number(booking.total_price);
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
        cleaningFee: cleaning,
        serviceFee: service,
        total: totalAmt,
      },
      guestName: user?.user_metadata?.full_name || user?.email || null,
      guestEmail: user?.email || null,
    };
  };

  const handleOpenReceiptPreview = () => {
    if (!booking || !property) return;
    setReceiptDialogOpen(true);
  };

  if (isLoading || !booking || !property) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-16">
          <div className="animate-pulse max-w-2xl mx-auto space-y-6">
            <div className="h-16 w-16 bg-muted rounded-full mx-auto" />
            <div className="h-8 bg-muted rounded w-2/3 mx-auto" />
            <div className="h-64 bg-muted rounded-xl" />
          </div>
        </div>
      </Layout>
    );
  }

  const bookingSubtotal = Number(booking.nightly_rate) * booking.num_nights;
  const cleaningFee = Number(booking.cleaning_fee || 0);
  const serviceFee = Number(booking.service_fee || 0);
  const total = Number(booking.total_price);
  const bookingCode = formatBookingId(booking.id, platformSettings?.booking_id_prefix, platformSettings?.booking_id_length);
  const isHost = user?.id === property.host_id;
  const serviceFeeChargedTo = (property.service_fee_charged_to || 'guest') as 'guest' | 'host' | 'split';
  const hostFees = platformSettings && isHost
    ? calculateFees(bookingSubtotal, platformSettings, serviceFeeChargedTo)
    : null;
  // Auto-derive "completed" client-side once the scheduled checkout has
  // passed, so the timeline updates instantly without waiting on the hourly
  // lifecycle cron. Server remains the source of truth (cron flips the row
  // shortly after), but the user sees the right state immediately.
  const checkOutPassed = (() => {
    try {
      const checkOutAt = new Date(`${booking.check_out_date}T11:00:00Z`).getTime();
      return Date.now() > checkOutAt;
    } catch { return false; }
  })();
  const isPending = booking.status === 'pending';
  const isConfirmed = (booking.status === 'confirmed' || booking.status === 'in_progress') && !checkOutPassed;
  const isCompleted =
    booking.status === 'completed' ||
    (checkOutPassed && (booking.status === 'confirmed' || booking.status === 'in_progress'));
  const isCancelled = booking.status === 'cancelled' || booking.status === 'rejected';
  // Contact details visible only when booking is active (confirmed). Hidden for pending/cancelled/rejected/completed.
  const canViewContact = isConfirmed || booking.status === 'in_progress';
  const currency = booking.currency || property.currency || 'USD';

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        {/* Back button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/bookings'))}
          className="mb-4 -ml-2 gap-1 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('common.back')}
        </Button>

        {/* Payment Status Banners */}
        {paymentStatus === 'success' && (
          <Alert className="mb-6 border-green-500/40 bg-green-50 dark:bg-green-950/30">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <AlertTitle className="text-green-700 dark:text-green-400 font-semibold">{t('paymentBanner.success')}</AlertTitle>
            <AlertDescription className="text-green-600 dark:text-green-300">{t('paymentBanner.successDesc')}</AlertDescription>
          </Alert>
        )}
        {paymentStatus === 'cancelled' && (
          <Alert className="mb-6 border-destructive/40 bg-destructive/5">
            <XCircle className="h-5 w-5 text-destructive" />
            <AlertTitle className="text-destructive font-semibold">{t('paymentBanner.cancelled')}</AlertTitle>
            <AlertDescription className="text-destructive/80 flex items-center justify-between flex-wrap gap-2">
              <span>{t('paymentBanner.cancelledDesc')}</span>
              <Button size="sm" variant="destructive" onClick={handleRetryPayment} disabled={retrying} className="gap-2">
                <CreditCard className="w-4 h-4" />
                {retrying ? t('paymentBanner.processing') : t('paymentBanner.retryPayment')}
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {!paymentStatus && isPending && !isHost && (
          <Alert className="mb-6 border-amber-500/40 bg-amber-50 dark:bg-amber-950/30">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <AlertTitle className="text-amber-700 dark:text-amber-400 font-semibold">{t('bookingConfirmation.paymentPending')}</AlertTitle>
            <AlertDescription className="text-amber-600 dark:text-amber-300 flex items-center justify-between flex-wrap gap-2">
              <span>{t('bookingConfirmation.paymentPendingDesc')}</span>
              <Button size="sm" className="gap-2 bg-amber-600 hover:bg-amber-700 text-white" onClick={handleRetryPayment} disabled={retrying}>
                <CreditCard className="w-4 h-4" />
                {retrying ? t('paymentBanner.processing') : t('bookingConfirmation.makePayment')}
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/*
         * Manual confirmation retry — only surfaces when the user landed
         * here from a successful Paystack checkout (`payment=success`) but the
         * 30-second polling window elapsed without the booking flipping out
         * of `pending`. Lets the guest force a server re-check rather than
         * being stuck staring at a "pending" badge.
         */}
        {paymentStatus === 'success' && isPending && confirmStalled && (
          <Alert className="mb-6 border-amber-500/40 bg-amber-50 dark:bg-amber-950/30">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <AlertTitle className="text-amber-700 dark:text-amber-400 font-semibold">
              {t('bookingConfirmation.stillConfirming')}
            </AlertTitle>
            <AlertDescription className="text-amber-600 dark:text-amber-300 flex items-center justify-between flex-wrap gap-2">
              <span>
                {t('bookingConfirmation.stillConfirmingDesc')}
              </span>
              <Button
                size="sm"
                className="gap-2 bg-amber-600 hover:bg-amber-700 text-white"
                onClick={handleManualRetryConfirmation}
                disabled={manualRetrying}
              >
                <RefreshCw className={`w-4 h-4 ${manualRetrying ? 'animate-spin' : ''}`} />
                {manualRetrying ? t('bookingConfirmation.rechecking') : t('bookingConfirmation.retryConfirmation')}
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/*
         * Status timeline — Pending → Confirmed → Completed (or Cancelled).
         * Reflects the latest server status. Each step lights up green when
         * reached; if the booking ends in a cancelled/rejected state we
         * replace the final "Completed" step with a destructive "Cancelled"
         * step so the user sees the full trajectory at a glance.
         */}
        <BookingStatusTimeline
          isPending={isPending}
          isConfirmed={isConfirmed}
          isCompleted={isCompleted}
          isCancelled={isCancelled}
          cancellationReason={booking.cancellation_reason ?? null}
          isRejected={booking.status === 'rejected'}
        />

        {/* ═══ RECEIPT ═══ */}
        <div ref={receiptRef}>
          <Card className="overflow-hidden border-border/60 shadow-lg">
            {/* Receipt Header */}
            <div className="bg-primary/5 border-b border-border/40 px-6 py-8 sm:px-8">
              <div className="flex items-start justify-between flex-wrap gap-4">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isConfirmed ? 'bg-green-100 dark:bg-green-900/40' : 'bg-amber-100 dark:bg-amber-900/40'}`}>
                      {isConfirmed ? (
                        <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                      ) : (
                        <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                      )}
                    </div>
                    <div>
                      <h1 className="text-2xl font-bold tracking-tight">
                        {isConfirmed ? t('bookingConfirmation.bookingConfirmed') : t('bookingConfirmation.bookingCreated')}
                      </h1>
                      <p className="text-sm text-muted-foreground">
                        {isConfirmed ? t('bookingConfirmation.confirmedSubtitle') : t('bookingConfirmation.createdSubtitle')}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="text-right space-y-1">
                  <div className="flex items-center gap-2 justify-end">
                    <Receipt className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{t('bookingConfirmation.bookingCode')}</span>
                  </div>
                  <p className="font-mono text-xl font-bold tracking-widest text-primary">{bookingCode}</p>
                  <Badge
                    variant="outline"
                    className={`text-xs ${isConfirmed
                      ? 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700'
                      : 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700'
                    }`}
                  >
                    {isConfirmed ? `● ${t('bookings.status.confirmed')}` : `○ ${t('bookingConfirmation.pendingPayment')}`}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Property Details */}
            <div className="px-6 py-6 sm:px-8">
              <div className="flex flex-col sm:flex-row gap-5">
                <div className="sm:w-44 h-32 sm:h-auto flex-shrink-0 rounded-lg overflow-hidden">
                  <img
                    src={property.cover_image || '/placeholder.svg'}
                    alt={property.title}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-semibold mb-1 truncate">{property.title}</h2>
                  <div className="flex items-center gap-1.5 text-muted-foreground text-sm mb-3">
                    <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{property.city}, {property.country}</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5 capitalize">
                      <Home className="w-3.5 h-3.5" /> {property.property_type}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Bed className="w-3.5 h-3.5" /> {property.bedrooms} bed{property.bedrooms > 1 ? 's' : ''}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Bath className="w-3.5 h-3.5" /> {Number(property.bathrooms)} bath
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mx-6 sm:mx-8">
              <Separator />
            </div>

            {/* Trip Details Grid */}
            <div className="px-6 py-6 sm:px-8">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">{t('bookingConfirmation.tripDetails')}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-muted/40 rounded-lg p-3.5 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                    <Calendar className="w-3.5 h-3.5" /> {t('bookingConfirmation.checkIn')}
                  </div>
                  <p className="font-semibold text-sm">{format(new Date(booking.check_in_date), 'MMM d, yyyy')}</p>
                  {property.check_in_time && (
                    <p className="text-xs text-muted-foreground">
                      {t('bookingConfirmation.after', { time: format(new Date(`2000-01-01T${property.check_in_time}`), 'h:mm a') })}
                    </p>
                  )}
                </div>
                <div className="bg-muted/40 rounded-lg p-3.5 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                    <Calendar className="w-3.5 h-3.5" /> {t('bookingConfirmation.checkOut')}
                  </div>
                  <p className="font-semibold text-sm">{format(new Date(booking.check_out_date), 'MMM d, yyyy')}</p>
                  {property.check_out_time && (
                    <p className="text-xs text-muted-foreground">
                      {t('bookingConfirmation.before', { time: format(new Date(`2000-01-01T${property.check_out_time}`), 'h:mm a') })}
                    </p>
                  )}
                </div>
                <div className="bg-muted/40 rounded-lg p-3.5 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                    <Clock className="w-3.5 h-3.5" /> {t('bookingConfirmation.duration')}
                  </div>
                  <p className="font-semibold text-sm">{t('bookingConfirmation.nightCount', { count: booking.num_nights })}</p>
                </div>
                <div className="bg-muted/40 rounded-lg p-3.5 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                    <Users className="w-3.5 h-3.5" /> {t('bookingConfirmation.guests')}
                  </div>
                  <p className="font-semibold text-sm">{t('bookingConfirmation.guestCount', { count: booking.num_guests })}</p>
                </div>
              </div>
            </div>

            <div className="mx-6 sm:mx-8">
              <Separator />
            </div>

            {/* Host Info — guest view, only while booking is confirmed (active) */}
            {canViewContact && hostProfile && !isHost && (
              <>
                <div className="px-6 py-6 sm:px-8">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Your Host</h3>
                  <div className="flex items-center gap-4">
                    <Avatar className="w-12 h-12 border-2 border-primary/20">
                      <AvatarImage src={hostProfile.avatar_url || ''} />
                      <AvatarFallback className="bg-primary/10 text-primary font-bold text-lg">
                        {(hostProfile.full_name || hostProfile.email)?.[0]?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold">{hostProfile.full_name || 'Host'}</p>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground mt-0.5">
                        <a href={`mailto:${hostProfile.email}`} className="flex items-center gap-1.5 hover:text-primary transition-colors truncate">
                          <Mail className="w-3.5 h-3.5 flex-shrink-0" /> {hostProfile.email}
                        </a>
                        {hostProfile.phone && (
                          <a href={`tel:${hostProfile.phone}`} className="flex items-center gap-1.5 hover:text-primary transition-colors">
                            <Phone className="w-3.5 h-3.5 flex-shrink-0" /> {hostProfile.phone}
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mx-6 sm:mx-8">
                  <Separator />
                </div>
              </>
            )}

            {/* Guest Info — host view, only while booking is confirmed (active) */}
            {canViewContact && guestProfile && isHost && (
              <>
                <div className="px-6 py-6 sm:px-8">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Your Guest</h3>
                  <div className="flex items-center gap-4">
                    <Link to={`/user/${guestProfile.user_id}`}>
                      <Avatar className="w-12 h-12 border-2 border-primary/20 hover:border-primary transition-colors">
                        <AvatarImage src={guestProfile.avatar_url || ''} />
                        <AvatarFallback className="bg-primary/10 text-primary font-bold text-lg">
                          {(guestProfile.full_name || guestProfile.email)?.[0]?.toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    </Link>
                    <div className="flex-1 min-w-0">
                      <Link to={`/user/${guestProfile.user_id}`} className="font-semibold hover:text-primary transition-colors">
                        {guestProfile.full_name || 'Guest'}
                      </Link>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground mt-0.5 flex-wrap">
                        <a href={`mailto:${guestProfile.email}`} className="flex items-center gap-1.5 hover:text-primary transition-colors truncate">
                          <Mail className="w-3.5 h-3.5 flex-shrink-0" /> {guestProfile.email}
                        </a>
                        {guestProfile.phone && (
                          <a href={`tel:${guestProfile.phone}`} className="flex items-center gap-1.5 hover:text-primary transition-colors">
                            <Phone className="w-3.5 h-3.5 flex-shrink-0" /> {guestProfile.phone}
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mx-6 sm:mx-8">
                  <Separator />
                </div>
              </>
            )}

            {/* Contact unavailable notice — when booking is no longer active */}
            {!canViewContact && !isPending && (
              <>
                <div className="px-6 py-6 sm:px-8">
                  <div className="flex items-start gap-3 rounded-lg bg-muted/50 border border-border/60 p-4">
                    <AlertTriangle className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-muted-foreground">
                      <p className="font-medium text-foreground mb-0.5">Contact details unavailable</p>
                      <p>Contact information is only shared while a booking is active. It is hidden once the booking is cancelled or completed.</p>
                    </div>
                  </div>
                </div>
                <div className="mx-6 sm:mx-8">
                  <Separator />
                </div>
              </>
            )}

            {/* Price Breakdown */}
            <div className="px-6 py-6 sm:px-8">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
                <DollarSign className="w-4 h-4" /> Price Breakdown
              </h3>

              {isHost ? (
                <div className="space-y-5">
                  {/* Guest Payment Section */}
                  <div className="rounded-lg border border-border/60 p-4 space-y-2.5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Guest Payment</p>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">${Number(booking.nightly_rate).toFixed(2)} × {booking.num_nights} night{booking.num_nights > 1 ? 's' : ''}</span>
                      <span className="font-medium">${bookingSubtotal.toFixed(2)}</span>
                    </div>
                    {cleaningFee > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Cleaning fee</span>
                        <span className="font-medium">${cleaningFee.toFixed(2)}</span>
                      </div>
                    )}
                    {serviceFee > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Service fee (guest)</span>
                        <span className="font-medium">${serviceFee.toFixed(2)}</span>
                      </div>
                    )}
                    <Separator />
                    <div className="flex justify-between font-semibold">
                      <span>Total Guest Paid</span>
                      <span>${total.toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Host Payout Section */}
                  {hostFees && (
                    <div className="rounded-lg border border-green-300 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20 p-4 space-y-2.5">
                      <p className="text-xs font-semibold uppercase tracking-wider text-green-700 dark:text-green-400">Your Payout</p>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Accommodation revenue</span>
                        <span className="font-medium">${bookingSubtotal.toFixed(2)}</span>
                      </div>
                      {cleaningFee > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Cleaning fee</span>
                          <span className="font-medium">${cleaningFee.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm text-destructive">
                        <span>Host commission ({platformSettings!.host_commission_percent}%)</span>
                        <span>−${hostFees.hostCommission.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm text-destructive pl-3">
                        <span>Tax on commission ({platformSettings!.host_tax_percent}%)</span>
                        <span>−${hostFees.hostCommissionTax.toFixed(2)}</span>
                      </div>
                      {hostFees.hostServiceFee > 0 && (
                        <div className="flex justify-between text-sm text-destructive">
                          <span>Service fee (host portion)</span>
                          <span>−${hostFees.hostServiceFee.toFixed(2)}</span>
                        </div>
                      )}
                      <Separator />
                      <div className="flex justify-between font-bold text-green-700 dark:text-green-400">
                        <span>Net Payout</span>
                        <span>${(hostFees.hostPayout + cleaningFee).toFixed(2)}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Service fee charged to: <span className="capitalize font-medium">{serviceFeeChargedTo}</span>
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                /* Guest View */
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">${Number(booking.nightly_rate).toFixed(2)} × {booking.num_nights} night{booking.num_nights > 1 ? 's' : ''}</span>
                    <span className="font-medium">${bookingSubtotal.toFixed(2)}</span>
                  </div>
                  {cleaningFee > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t('bookingConfirmation.cleaningFee')}</span>
                      <span className="font-medium">${cleaningFee.toFixed(2)}</span>
                    </div>
                  )}
                  {serviceFee > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t('bookingConfirmation.serviceFee')}</span>
                      <span className="font-medium">${serviceFee.toFixed(2)}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between items-center pt-1">
                    <span className="font-bold text-base">Total</span>
                    <span className="font-bold text-xl text-primary">${total.toFixed(2)} <span className="text-xs font-normal text-muted-foreground uppercase">{currency}</span></span>
                  </div>
                </div>
              )}
            </div>

            {/* Receipt Footer */}
            <div className="bg-muted/30 border-t border-border/40 px-6 py-4 sm:px-8">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Booked on {format(new Date(booking.created_at), 'MMMM d, yyyy · h:mm a')}</span>
                <span className="font-mono">{bookingCode}</span>
              </div>
            </div>
          </Card>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 mt-6 print:hidden">
          {isPending && !isHost && !paymentStatus && (
            <Button className="flex-1 gap-2 bg-amber-600 hover:bg-amber-700" onClick={handleRetryPayment} disabled={retrying}>
              <CreditCard className="w-4 h-4" />
              {retrying ? 'Processing...' : 'Complete Payment'}
            </Button>
          )}
          <Button asChild className="flex-1 gap-2">
            <Link to="/bookings">
              {t('bookingConfirmation.viewMyBookings')} <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
          {canViewContact && (
            <Button variant="outline" className="flex-1 gap-2" asChild>
              <Link to={isHost ? `/messages?guest=${booking.guest_id}` : `/messages?host=${property.host_id}`}>
                <MessageSquare className="w-4 h-4" /> {isHost ? 'Message Guest' : t('bookingConfirmation.messageHost')}
              </Link>
            </Button>
          )}
          {isConfirmed && !isHost && (
            <Button variant="outline" className="flex-1 gap-2" onClick={handleOpenReceiptPreview}>
              <Eye className="w-4 h-4" /> Preview & Download Receipt
            </Button>
          )}
          {/* Guest can modify a confirmed booking up until the day before
              check-in (the dialog itself enforces the 24h-in-future rule).
              Visibility logic is centralised in `shouldShowModifyButton` so
              it can be unit-tested without rendering this page. */}
          {shouldShowModifyButton({
            status: booking.status,
            isHost,
            checkInDate: booking.check_in_date,
          }) && (
            <Button
              variant="outline"
              className="flex-1 gap-2"
              onClick={() => setModifyOpen(true)}
            >
              <CalendarDays className="w-4 h-4" /> Modify booking
            </Button>
          )}
          <Button variant="outline" className="flex-1 gap-2" onClick={() => window.print()}>
            <Printer className="w-4 h-4" /> Print Receipt
          </Button>
        </div>
      </div>

      <ReceiptPreviewDialog
        open={receiptDialogOpen}
        onOpenChange={setReceiptDialogOpen}
        bookingId={booking.id}
        receiptData={buildReceiptData()}
      />

      {/* Modify booking dialog — guest only, mirrors /bookings flow */}
      {!isHost && (
        <ModifyBookingDialog
          open={modifyOpen}
          onOpenChange={setModifyOpen}
          booking={{
            id: booking.id,
            property_id: booking.property_id,
            host_id: property.host_id,
            guest_id: booking.guest_id,
            check_in_date: booking.check_in_date,
            check_out_date: booking.check_out_date,
            num_guests: booking.num_guests,
            nightly_rate: booking.nightly_rate as any,
            cleaning_fee: booking.cleaning_fee as any,
            service_fee: booking.service_fee as any,
            total_price: booking.total_price as any,
            currency: booking.currency,
            created_at: booking.created_at,
            properties: {
              title: property.title,
              service_fee_charged_to: (property as any).service_fee_charged_to ?? null,
            },
          }}
          onModified={() => {
            // Refresh booking after a modification so dates / totals update.
            window.location.reload();
          }}
        />
      )}
    </Layout>
  );
}

/**
 * Visual status timeline for the booking lifecycle.
 *
 * Step semantics (driven entirely by the latest server status, not local state):
 *   • Pending   — payment still outstanding (initial state)
 *   • Confirmed — payment received, reservation locked in
 *   • Completed — stay finished and check-out lapsed
 *   • Cancelled — guest or host cancelled (replaces the Completed step
 *                 visually as the terminal state when applicable)
 *
 * Reached steps light up green; the cancelled terminal state uses the
 * destructive token. Future steps are muted.
 */
function BookingStatusTimeline({
  isPending,
  isConfirmed,
  isCompleted,
  isCancelled,
  cancellationReason,
  isRejected,
}: {
  isPending: boolean;
  isConfirmed: boolean;
  isCompleted: boolean;
  isCancelled: boolean;
  cancellationReason?: string | null;
  isRejected?: boolean;
}) {
  // Pending step: reached unless we've already moved past it (any non-pending
  // status implies the booking was at some point pending).
  const pendingReached = true;
  const confirmedReached = isConfirmed || isCompleted; // cancelled-from-pending shouldn't light this
  const finalIsCancelled = isCancelled;
  const finalReached = isCompleted || isCancelled;

  const steps = [
    {
      key: 'pending',
      label: 'Pending',
      reached: pendingReached,
      tone: 'neutral' as const,
    },
    {
      key: 'confirmed',
      label: 'Confirmed',
      reached: confirmedReached,
      tone: 'success' as const,
    },
    {
      key: 'final',
      label: finalIsCancelled ? (isRejected ? 'Rejected' : 'Cancelled') : 'Completed',
      reached: finalReached,
      tone: finalIsCancelled ? ('destructive' as const) : ('success' as const),
    },
  ];

  const dotClass = (reached: boolean, tone: 'neutral' | 'success' | 'destructive') => {
    if (!reached) return 'bg-muted text-muted-foreground border-border';
    if (tone === 'destructive') return 'bg-destructive text-destructive-foreground border-destructive';
    if (tone === 'success') return 'bg-green-600 text-white border-green-600';
    return 'bg-primary text-primary-foreground border-primary';
  };

  const labelClass = (reached: boolean, tone: 'neutral' | 'success' | 'destructive') => {
    if (!reached) return 'text-muted-foreground';
    if (tone === 'destructive') return 'text-destructive font-medium';
    if (tone === 'success') return 'text-green-700 dark:text-green-400 font-medium';
    return 'text-foreground font-medium';
  };

  // The connector between steps is green only when the *next* step is reached.
  const connectorClass = (nextReached: boolean, nextTone: 'neutral' | 'success' | 'destructive') => {
    if (!nextReached) return 'bg-border';
    if (nextTone === 'destructive') return 'bg-destructive';
    return 'bg-green-600';
  };

  return (
    <div
      className="mb-6 rounded-lg border border-border/60 bg-card px-5 py-4"
      aria-label="Booking status timeline"
    >
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Status
      </h3>
      <ol className="flex items-center w-full">
        {steps.map((step, idx) => {
          const isLast = idx === steps.length - 1;
          const next = steps[idx + 1];
          return (
            <li key={step.key} className={`flex items-center ${isLast ? '' : 'flex-1'}`}>
              <div className="flex flex-col items-center gap-1.5 min-w-0">
                <div
                  className={`w-7 h-7 rounded-full border-2 flex items-center justify-center transition-colors ${dotClass(step.reached, step.tone)}`}
                  aria-current={
                    // Highlight the most recent reached step
                    (step.key === 'pending' && isPending) ||
                    (step.key === 'confirmed' && isConfirmed) ||
                    (step.key === 'final' && (isCompleted || isCancelled))
                      ? 'step'
                      : undefined
                  }
                >
                  {step.reached ? (
                    step.tone === 'destructive' ? (
                      <XCircle className="w-4 h-4" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )
                  ) : (
                    <Circle className="w-3 h-3" />
                  )}
                </div>
                <span className={`text-xs ${labelClass(step.reached, step.tone)}`}>
                  {step.label}
                </span>
              </div>
              {!isLast && next && (
                <div className={`flex-1 h-0.5 mx-2 mb-5 transition-colors ${connectorClass(next.reached, next.tone)}`} />
              )}
            </li>
          );
        })}
      </ol>
      {finalIsCancelled && (
        <div
          className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
          role="status"
          aria-live="polite"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider text-destructive mb-0.5">
            {isRejected ? 'Rejection reason' : 'Cancellation reason'}
          </p>
          <p className="text-sm text-foreground/90 break-words">
            {cancellationReason?.trim()
              ? cancellationReason
              : 'No reason was provided.'}
          </p>
        </div>
      )}
    </div>
  );
}