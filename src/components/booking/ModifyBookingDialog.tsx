import { useEffect, useMemo, useState } from 'react';
import { addDays, differenceInDays, format } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Calendar as CalendarPicker } from '@/components/ui/calendar';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle, ArrowRight, CalendarDays } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { usePlatformSettings, calculateFees, formatBookingId } from '@/hooks/usePlatformSettings';
import { calculateCancellationOutcome, type CancellationInput } from '@/lib/cancellation/engine';
import { useCancellationPolicy } from '@/hooks/useCancellationPolicy';

interface ModifyBookingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: {
    id: string;
    property_id: string;
    host_id: string;
    guest_id: string;
    check_in_date: string;
    check_out_date: string;
    num_guests: number;
    nightly_rate: number | string;
    cleaning_fee: number | string | null;
    service_fee: number | string | null;
    total_price: number | string;
    currency: string | null;
    created_at: string;
    properties?: {
      title?: string | null;
      service_fee_charged_to?: string | null;
    } | null;
  };
  onModified: () => void;
}

/**
 * Guest-initiated booking date modification.
 *
 * Three flows depending on the proposed dates:
 *  1. Extending or shifting more expensive (delta > 0):
 *     We persist the proposed dates as `pending_modification` on the booking,
 *     then send the guest to Stripe to pay the price delta. The
 *     `confirm-booking-modification` edge function applies the new dates and
 *     re-blocks the calendar atomically once payment succeeds.
 *  2. Shortening or shifting cheaper (delta < 0):
 *     The dropped nights are routed through the cancellation engine — same
 *     tiered refund the platform applies to a cancellation. The kept nights
 *     stay confirmed; the new dates are written immediately and a partial
 *     refund is recorded.
 *  3. Same total (date shift, equal nights, all future, no overlap):
 *     Update dates only.
 *
 * Hard rule (matches existing booking flow): the new check-in must be at
 * least 24h in the future.
 */
export function ModifyBookingDialog({ open, onOpenChange, booking, onModified }: ModifyBookingDialogProps) {
  const { toast } = useToast();
  const { settings: platformSettings } = usePlatformSettings();
  const { policy } = useCancellationPolicy();

  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [blockedRanges, setBlockedRanges] = useState<Array<{ start: Date; end: Date }>>([]);
  const [isLoadingDates, setIsLoadingDates] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset when reopened with a fresh booking
  useEffect(() => {
    if (open) {
      setDateRange({
        from: new Date(booking.check_in_date + 'T00:00:00'),
        to: new Date(booking.check_out_date + 'T00:00:00'),
      });
    }
  }, [open, booking.id]);

  // Pull every confirmed/pending booking on this property EXCEPT the one
  // we're editing — those nights are off-limits for the modification.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      setIsLoadingDates(true);
      const { data } = await supabase
        .from('bookings')
        .select('check_in_date, check_out_date')
        .eq('property_id', booking.property_id)
        .neq('id', booking.id)
        .in('status', ['confirmed', 'pending', 'pending_host_approval', 'in_progress']);
      if (!alive) return;
      setBlockedRanges(
        (data || []).map((b: any) => ({
          start: new Date(b.check_in_date + 'T00:00:00'),
          end: new Date(b.check_out_date + 'T00:00:00'),
        })),
      );
      setIsLoadingDates(false);
    })();
    return () => {
      alive = false;
    };
  }, [open, booking.id, booking.property_id]);

  const currentNights = useMemo(
    () => differenceInDays(new Date(booking.check_out_date), new Date(booking.check_in_date)),
    [booking.check_in_date, booking.check_out_date],
  );

  const newNights = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return 0;
    return differenceInDays(dateRange.to, dateRange.from);
  }, [dateRange]);

  const nightlyRate = Number(booking.nightly_rate) || 0;
  const cleaningFee = Number(booking.cleaning_fee) || 0;
  const currentTotal = Number(booking.total_price) || 0;
  const currency = (booking.currency || 'USD').toUpperCase();

  // Recompute pricing with the SAME engine the original booking used.
  const newPricing = useMemo(() => {
    if (!newNights || !platformSettings) return null;
    const subtotal = nightlyRate * newNights;
    const chargedTo = (booking.properties?.service_fee_charged_to || 'guest') as 'guest' | 'host' | 'split';
    const fees = calculateFees(subtotal, platformSettings, chargedTo);
    const newTotal = subtotal + cleaningFee + (fees.guestServiceFee || 0);
    return {
      subtotal,
      cleaningFee,
      guestServiceFee: fees.guestServiceFee,
      hostServiceFee: fees.hostServiceFee,
      serviceFeeWithTax: fees.serviceFeeWithTax,
      newTotal,
      delta: newTotal - currentTotal,
    };
  }, [newNights, platformSettings, nightlyRate, cleaningFee, booking.properties, currentTotal]);

  // Validation (date sanity + overlap with other bookings).
  // Note: guests can adjust their booking dates at any time; no 24h floor.
  const validation = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return { ok: false, reason: 'Pick a check-in and check-out date.' };
    if (newNights < 1) return { ok: false, reason: 'Stay must be at least 1 night.' };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (dateRange.from < today) {
      return { ok: false, reason: 'Check-in date cannot be in the past.' };
    }
    // Overlap with another booking?
    const overlap = blockedRanges.some(({ start, end }) => dateRange.from! < end && dateRange.to! > start);
    if (overlap) return { ok: false, reason: 'Selected dates overlap another booking on this property.' };
    // Identical?
    const sameStart = format(dateRange.from, 'yyyy-MM-dd') === booking.check_in_date;
    const sameEnd = format(dateRange.to, 'yyyy-MM-dd') === booking.check_out_date;
    if (sameStart && sameEnd) return { ok: false, reason: 'These are your current dates — nothing to modify.' };
    return { ok: true as const, reason: '' };
  }, [dateRange, newNights, blockedRanges, booking.check_in_date, booking.check_out_date]);

  // Cancellation-engine preview for the SHORTEN path (delta < 0).
  // We treat the dropped nights as a partial cancellation — same tiered
  // refund a full cancellation would yield, prorated to the dropped nights.
  const shortenPreview = useMemo(() => {
    if (!newPricing || newPricing.delta >= 0) return null;
    const droppedNights = currentNights - newNights;
    if (droppedNights <= 0) return null;
    const droppedSubtotal = nightlyRate * droppedNights;
    // Build a synthetic cancellation input as if the guest cancelled a
    // booking equal to JUST the dropped nights, with the same check-in date
    // band (so the same tier is detected based on hours-until-check-in).
    const input: CancellationInput = {
      nightlyRate,
      totalNights: droppedNights,
      cleaningFee: 0,
      serviceFee: (newPricing.serviceFeeWithTax * droppedNights) / Math.max(1, currentNights),
      processingFee: 0,
      taxes: 0,
      checkInAt: new Date(booking.check_in_date + 'T15:00:00').toISOString(),
      bookingCreatedAt: booking.created_at,
      initiatedBy: 'guest',
      reason: 'standard',
    };
    try {
      const outcome = calculateCancellationOutcome(input, policy);
      return { droppedNights, droppedSubtotal, outcome };
    } catch {
      return null;
    }
  }, [newPricing, currentNights, newNights, nightlyRate, booking.check_in_date, booking.created_at, policy]);

  const handleSubmit = async () => {
    if (!validation.ok || !newPricing || !dateRange?.from || !dateRange?.to) return;
    setIsSubmitting(true);
    try {
      const newCheckIn = format(dateRange.from, 'yyyy-MM-dd');
      const newCheckOut = format(dateRange.to, 'yyyy-MM-dd');

      if (newPricing.delta > 0) {
        // EXTEND / MORE EXPENSIVE — stage the modification then redirect
        // to Stripe to pay only the price delta.
        const { error: stageErr } = await supabase
          .from('bookings')
          .update({
            pending_modification: {
              new_check_in_date: newCheckIn,
              new_check_out_date: newCheckOut,
              new_num_nights: newNights,
              new_subtotal: newPricing.subtotal,
              new_service_fee: newPricing.serviceFeeWithTax,
              new_total_price: newPricing.newTotal,
              delta: newPricing.delta,
              requested_at: new Date().toISOString(),
            },
          })
          .eq('id', booking.id);
        if (stageErr) throw stageErr;

        const { data: checkout, error: checkoutErr } = await supabase.functions.invoke(
          'create-booking-modification-checkout',
          {
            body: {
              bookingId: booking.id,
              propertyTitle: booking.properties?.title ?? 'Booking modification',
              deltaAmount: newPricing.delta,
              currency,
              newCheckIn,
              newCheckOut,
              newNights,
            },
          },
        );
        if (checkoutErr || !checkout?.url) {
          toast({
            title: 'Could not start payment',
            description: checkoutErr?.message || 'Please try again.',
            variant: 'destructive',
          });
          setIsSubmitting(false);
          return;
        }
        window.location.href = checkout.url;
        return;
      }

      // SHORTEN OR SAME-PRICE: apply directly. No Stripe charge.
      // For shorten, we record a refund for the difference (minus retained
      // service fee on dropped nights), per the cancellation engine.
      let refundAmount = 0;
      let refundReason = '';
      if (newPricing.delta < 0 && shortenPreview) {
        refundAmount = shortenPreview.outcome.guestRefund;
        refundReason = `Modification refund — dropped ${shortenPreview.droppedNights} night(s). ${shortenPreview.outcome.tierLabel}.`;
      }

      const updates: Record<string, any> = {
        check_in_date: newCheckIn,
        check_out_date: newCheckOut,
        num_nights: newNights,
        subtotal: newPricing.subtotal,
        service_fee: newPricing.serviceFeeWithTax,
        total_price: newPricing.newTotal,
        last_modified_at: new Date().toISOString(),
        pending_modification: null,
      };
      if (refundAmount > 0) {
        updates.refund_amount = (Number(booking.total_price) - newPricing.newTotal); // record gross diff
        updates.refund_status = 'pending';
        updates.refund_reason = refundReason;
        updates.refund_date = new Date().toISOString();
      }

      const { error: updErr } = await supabase
        .from('bookings')
        .update(updates)
        .eq('id', booking.id);
      if (updErr) throw updErr;

      // System message in the booking thread (visible to host).
      const fullCode = formatBookingId(
        booking.id,
        platformSettings?.booking_id_prefix,
        platformSettings?.booking_id_length,
      );
      const msg =
        `🗓️ Booking ${fullCode} dates were modified by the guest. ` +
        `New stay: ${newCheckIn} (check-in) to ${newCheckOut} (check-out) — ${newNights} night${newNights > 1 ? 's' : ''}.` +
        (refundAmount > 0
          ? ` A refund of $${refundAmount.toFixed(2)} (${shortenPreview?.outcome.tierLabel}) is being processed for the dropped night${(shortenPreview?.droppedNights || 0) > 1 ? 's' : ''}.`
          : '');
      await supabase.from('messages').insert({
        sender_id: booking.guest_id,
        receiver_id: booking.host_id,
        booking_id: booking.id,
        content: msg,
        message_type: 'system',
      });

      toast({
        title: 'Booking updated',
        description:
          refundAmount > 0
            ? `New dates saved. Refund of $${refundAmount.toFixed(2)} is on its way.`
            : 'Your new dates have been saved.',
      });
      onOpenChange(false);
      onModified();
    } catch (err: any) {
      toast({
        title: 'Could not modify booking',
        description: err?.message || 'Unexpected error',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isDateDisabled = (date: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date < today) return true;
    return blockedRanges.some(({ start, end }) => date >= start && date < end);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-primary" /> Modify Booking Dates
          </DialogTitle>
          <DialogDescription>
            Pick new dates for your stay. Extending the stay charges the price difference plus
            service fee; shortening applies the standard cancellation policy to the dropped nights.
            Dates cannot overlap another booking on this property.
          </DialogDescription>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Calendar */}
          <div>
            <div className="text-sm font-medium mb-2">Select new dates</div>
            {isLoadingDates ? (
              <div className="flex items-center justify-center h-72">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <CalendarPicker
                mode="range"
                numberOfMonths={1}
                selected={dateRange}
                onSelect={setDateRange}
                disabled={isDateDisabled}
                className="rounded-md border w-full"
              />
            )}
          </div>

          {/* Summary */}
          <div className="space-y-4 text-sm">
            <div className="rounded-md border p-3 bg-muted/30">
              <div className="text-xs text-muted-foreground mb-1">Current</div>
              <div className="flex items-center gap-2 font-medium">
                {booking.check_in_date} <ArrowRight className="w-3.5 h-3.5" /> {booking.check_out_date}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {currentNights} night{currentNights > 1 ? 's' : ''} · ${currentTotal.toFixed(2)} {currency}
              </div>
            </div>

            {dateRange?.from && dateRange?.to && newPricing && (
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground mb-1">New</div>
                <div className="flex items-center gap-2 font-medium">
                  {format(dateRange.from, 'yyyy-MM-dd')}
                  <ArrowRight className="w-3.5 h-3.5" />
                  {format(dateRange.to, 'yyyy-MM-dd')}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {newNights} night{newNights > 1 ? 's' : ''}
                </div>
                <Separator className="my-3" />
                <div className="space-y-1.5">
                  <Row label={`Nightly × ${newNights}`} value={`$${newPricing.subtotal.toFixed(2)}`} />
                  {cleaningFee > 0 && <Row label="Cleaning fee" value={`$${cleaningFee.toFixed(2)}`} />}
                  <Row label="Service fee" value={`$${newPricing.guestServiceFee.toFixed(2)}`} />
                  <Separator className="my-1.5" />
                  <Row bold label="New total" value={`$${newPricing.newTotal.toFixed(2)}`} />
                </div>

                <Separator className="my-3" />
                {newPricing.delta > 0 ? (
                  <div className="flex items-start gap-2 rounded-md bg-primary/5 p-2.5">
                    <Badge className="bg-primary text-primary-foreground">Pay extra</Badge>
                    <div className="text-xs">
                      You'll be redirected to pay an additional{' '}
                      <strong>${newPricing.delta.toFixed(2)} {currency}</strong> for the new dates.
                    </div>
                  </div>
                ) : newPricing.delta < 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-start gap-2 rounded-md bg-emerald-500/5 p-2.5">
                      <Badge variant="outline" className="text-emerald-600 border-emerald-500/30">
                        Refund
                      </Badge>
                      <div className="text-xs">
                        You'll receive{' '}
                        <strong>
                          ${shortenPreview?.outcome.guestRefund.toFixed(2) ?? Math.abs(newPricing.delta).toFixed(2)}{' '}
                          {currency}
                        </strong>{' '}
                        back. Service fees on the booking are non-refundable.
                      </div>
                    </div>
                    {shortenPreview && (
                      <div className="flex items-start gap-2 rounded-md bg-amber-500/5 p-2.5">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div className="text-xs text-muted-foreground">
                          <strong className="text-foreground">{shortenPreview.outcome.tierLabel}</strong>{' '}
                          applies to the {shortenPreview.droppedNights} dropped night
                          {shortenPreview.droppedNights > 1 ? 's' : ''}. Late changes inside the
                          cancellation window may reduce your refund per platform policy.
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">No price change.</div>
                )}
              </div>
            )}

            {!validation.ok && validation.reason && (
              <div className="text-xs text-destructive flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {validation.reason}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!validation.ok || isSubmitting || !newPricing}
            className="btn-primary"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {newPricing && newPricing.delta > 0
              ? `Pay $${newPricing.delta.toFixed(2)} & Modify`
              : newPricing && newPricing.delta < 0
                ? 'Confirm & Refund'
                : 'Confirm New Dates'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? 'font-semibold' : ''}`}>
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}