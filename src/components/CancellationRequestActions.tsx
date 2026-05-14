import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Check, X, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format, addDays } from 'date-fns';
import { parseDateInTz, DEFAULT_TZ } from '@/lib/dates/propertyTz';

interface Props {
  bookingId: string;
  hostId: string;
  guestId: string;
  onResolved?: () => void;
}

/**
 * Inline action panel rendered inside a system "Cancellation Request" message.
 * Lets the host approve (free cancellation, charge service fee only) or decline
 * (guest must use automatic cancellation per policy).
 */
export function CancellationRequestActions({ bookingId, hostId, guestId, onResolved }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState<'approve' | 'decline' | null>(null);
  const [bookingStatus, setBookingStatus] = useState<string | null>(null);
  const [resolved, setResolved] = useState<'approved' | 'declined' | null>(null);
  const [bookingData, setBookingData] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('bookings')
        .select('id, status, total_price, service_fee, check_in_date, check_out_date, property_id, host_id, cancellation_reason, properties(timezone)')
        .eq('id', bookingId)
        .maybeSingle();
      if (cancelled || !data) return;
      setBookingData(data);
      setBookingStatus(data.status);
      if (data.status === 'cancelled') {
        if (data.cancellation_reason?.includes('Free cancellation approved')) setResolved('approved');
        else if (data.cancellation_reason?.includes('Free cancellation declined')) setResolved('declined');
      }
    })();
    return () => { cancelled = true; };
  }, [bookingId]);

  // Only the host (recipient of the request) sees these controls
  const isHost = bookingData?.host_id === hostId;
  if (!isHost) return null;

  const handleApprove = async () => {
    if (!bookingData) return;
    setLoading('approve');
    const totalPaid = Number(bookingData.total_price);
    const serviceFee = Number(bookingData.service_fee || 0);
    const refundAmount = totalPaid - serviceFee;

    const { error } = await supabase.from('bookings').update({
      status: 'cancelled',
      cancellation_reason: `Free cancellation approved by host. Refund: $${refundAmount.toFixed(2)} (service fee $${serviceFee.toFixed(2)} retained).`,
      refund_amount: refundAmount,
      refund_status: 'pending',
      refund_reason: 'Host-approved free cancellation',
    }).eq('id', bookingId);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setLoading(null);
      return;
    }

    // Unblock dates
    const tz = (bookingData.properties as any)?.timezone || DEFAULT_TZ;
    const start = parseDateInTz(bookingData.check_in_date, tz);
    const end = parseDateInTz(bookingData.check_out_date, tz);
    let current = new Date(start);
    while (current < end) {
      const dateStr = format(current, 'yyyy-MM-dd');
      await supabase.from('property_availability').delete()
        .eq('property_id', bookingData.property_id)
        .eq('date', dateStr)
        .eq('is_available', false);
      current = addDays(current, 1);
    }

    // Notify guest — courtesy reply, always sent (not part of the 3 toggleable
    // automated messages).
    await supabase.from('messages').insert({
      sender_id: hostId,
      receiver_id: guestId,
      booking_id: bookingId,
      content: `✅ Your free cancellation request has been APPROVED. A refund of $${refundAmount.toFixed(2)} will be processed (service fee of $${serviceFee.toFixed(2)} is non-refundable).`,
      message_type: 'system',
    });

    setResolved('approved');
    toast({ title: 'Cancellation Approved', description: `Guest will be refunded $${refundAmount.toFixed(2)}.` });
    setLoading(null);
    onResolved?.();
  };

  const handleDecline = async () => {
    setLoading('decline');
    await supabase.from('messages').insert({
      sender_id: hostId,
      receiver_id: guestId,
      booking_id: bookingId,
      content: `❌ Your free cancellation request has been DECLINED. You may still cancel through the standard cancellation policy from your bookings page.`,
      message_type: 'system',
    });
    // Mark a flag in booking notes (no separate field, store via cancellation_reason only on actual cancel)
    setResolved('declined');
    toast({ title: 'Request Declined', description: 'Guest has been notified.' });
    setLoading(null);
    onResolved?.();
  };

  if (bookingStatus === 'cancelled' && resolved !== 'approved') {
    return (
      <div className="mt-2 pt-2 border-t border-border/40 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <XCircle className="w-3.5 h-3.5" /> Booking already cancelled
      </div>
    );
  }

  if (resolved === 'approved') {
    return (
      <div className="mt-2 pt-2 border-t border-border/40 flex items-center gap-1.5 text-[11px] text-green-600 font-medium">
        <CheckCircle className="w-3.5 h-3.5" /> You approved this cancellation
      </div>
    );
  }
  if (resolved === 'declined') {
    return (
      <div className="mt-2 pt-2 border-t border-border/40 flex items-center gap-1.5 text-[11px] text-destructive font-medium">
        <XCircle className="w-3.5 h-3.5" /> You declined this request
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-border/40 flex flex-col sm:flex-row gap-2">
      <Button
        size="sm"
        className="flex-1 h-8 text-xs gap-1.5 bg-green-600 hover:bg-green-700 text-white"
        onClick={handleApprove}
        disabled={loading !== null}
      >
        {loading === 'approve' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        Approve Free Cancellation
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="flex-1 h-8 text-xs gap-1.5"
        onClick={handleDecline}
        disabled={loading !== null}
      >
        {loading === 'decline' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
        Decline
      </Button>
    </div>
  );
}
