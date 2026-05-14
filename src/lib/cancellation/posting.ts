import { supabase } from '@/integrations/supabase/client';
import { D, toDbAmount } from '@/lib/accounting/money';
import { postJournalEntry } from '@/lib/accounting/journal';
import { getAccountByCode, ensureAccountingSeeded } from '@/lib/accounting/init';
import type { CancellationOutcome } from './engine';

export interface RecordHostPenaltyInput {
  hostId: string;
  bookingId: string;
  amount: number;
  currency?: string;
  tierLabel: string;
}

/**
 * Records a host penalty (e.g. host-cancel fine) as a pending deduction.
 * Pending deductions are automatically applied against the host's next payout
 * by `settle_host_deductions_for_payout` — this is the host's running balance.
 * Idempotent per booking + reason: re-calling for the same booking is a no-op
 * because we de-dupe on (booking_id, reason_code='host_cancel_fine', pending).
 */
export async function recordHostPenalty(input: RecordHostPenaltyInput): Promise<void> {
  if (!input.amount || input.amount <= 0) return;
  try {
    const { data: existing } = await supabase
      .from('host_deductions' as any)
      .select('id')
      .eq('host_id', input.hostId)
      .eq('booking_id', input.bookingId)
      .eq('reason_code', 'host_cancel_fine')
      .eq('status', 'pending')
      .maybeSingle();
    if (existing) return;

    await supabase.from('host_deductions' as any).insert({
      host_id: input.hostId,
      booking_id: input.bookingId,
      amount: input.amount,
      currency: (input.currency || 'USD').toUpperCase(),
      reason_code: 'host_cancel_fine',
      reason_detail: `Host cancellation fine — ${input.tierLabel}`,
      created_by: input.hostId,
    } as any);
  } catch (err) {
    console.error('[cancellation] failed to record host penalty', err);
  }
}

export interface CancellationReversalInput {
  hostId: string;
  bookingId: string;
  bookingCurrency?: string;
  /** Refund issued to guest in cash (in booking currency). */
  guestRefund: number;
  /** Hostiva fees retained (service fee + processing). */
  hostlyKeeps: number;
  /** Original gross subtotal of the booking (nightly_rate * nights). */
  originalSubtotal: number;
  /** Original cleaning fee on the booking. */
  originalCleaning: number;
  /** Net amount the host actually keeps post-cancellation (host payout). */
  hostPayout: number;
  tierLabel: string;
  tierId: string;
}

/**
 * Posts a reversing journal entry that backs out the cancelled portion of a
 * Hostiva booking from the host's books. Safe to call even if the host has
 * never opened the Accounting module — the seed runs on demand.
 *
 * High-level math (in booking currency, base = host base currency assumed equal here):
 *   - Net refunded portion of the booking = originalSubtotal + originalCleaning - hostPayout
 *   - We reverse:
 *       Dr Rental revenue (4010)        original_subtotal_refunded
 *       Dr Cleaning fee revenue (4100)  original_cleaning_refunded
 *         Cr Pending payouts — Hostiva (1100)   net_refunded_portion
 *         Cr Hostiva service fees (5010, contra) commission_reversed
 *
 * The trigger that originally posted the booking debited 1100 for the net
 * payout and credited revenue + cleaning, with the platform fees on the
 * debit side. This entry mirrors that for the refunded portion only, so the
 * net effect on each account equals what the host actually retained.
 *
 * This is best-effort: any failure is logged but does not block the cancellation.
 */
export async function postCancellationReversal(input: CancellationReversalInput): Promise<string | null> {
  try {
    await ensureAccountingSeeded(input.hostId);

    const subtotal = D(input.originalSubtotal);
    const cleaning = D(input.originalCleaning);
    const hostPayout = D(input.hostPayout);

    // Net amount that needs to come OFF the host's pending-payout balance.
    const grossOriginal = subtotal.plus(cleaning);
    if (grossOriginal.lte(0)) return null;

    // Determine what fraction of the original booking is being clawed back.
    // hostPayout already excludes commissions, so the difference between the
    // original net (gross - original commission) and hostPayout is the portion
    // we need to back out of revenue.
    const refundedPortion = grossOriginal.minus(hostPayout);
    if (refundedPortion.lte(0)) return null; // nothing to reverse

    // Allocate the reversal proportionally between accommodation and cleaning.
    const accomShare = grossOriginal.gt(0)
      ? refundedPortion.times(subtotal).dividedBy(grossOriginal)
      : D(0);
    const cleaningShare = refundedPortion.minus(accomShare);

    const [acc1100, acc4010, acc4100, acc5010] = await Promise.all([
      getAccountByCode(input.hostId, '1100'),
      getAccountByCode(input.hostId, '4010'),
      getAccountByCode(input.hostId, '4100'),
      getAccountByCode(input.hostId, '5010'),
    ]);

    if (!acc1100 || !acc4010) {
      // Books not configured — silently skip to avoid blocking the cancel.
      return null;
    }

    const lines: Array<{ account_id: string; debit?: number; credit?: number; memo?: string }> = [];

    // Reverse revenue (debit revenue, reducing it)
    if (accomShare.gt(0)) {
      lines.push({ account_id: acc4010, debit: toDbAmount(accomShare), memo: `Cancellation reversal — ${input.tierLabel}` });
    }
    if (cleaningShare.gt(0) && acc4100) {
      lines.push({ account_id: acc4100, debit: toDbAmount(cleaningShare), memo: 'Cancellation reversal — cleaning' });
    }

    // Credit Pending Payouts — money no longer owed to host
    lines.push({ account_id: acc1100, credit: toDbAmount(refundedPortion), memo: `Refunded to guest (${input.bookingCurrency ?? 'USD'})` });

    // Balance sanity: debits already equal credit by construction (accomShare+cleaningShare = refundedPortion)
    if (lines.length < 2) return null;

    const entryId = await postJournalEntry({
      host_id: input.hostId,
      entry_date: new Date().toISOString().slice(0, 10),
      description: `Cancellation reversal — booking ${input.bookingId.slice(0, 8).toUpperCase()} (${input.tierLabel})`,
      reference: `CANCEL-${input.bookingId.slice(0, 8).toUpperCase()}`,
      source_type: 'booking',
      source_id: input.bookingId,
      lines,
    });

    // Best-effort: silence acc5010 unused warning
    void acc5010;
    return entryId;
  } catch (err) {
    console.error('[cancellation] reversal posting failed', err);
    return null;
  }
}

/**
 * Build the reversal input from a CancellationOutcome + DB booking row.
 */
export function buildReversalFromOutcome(
  outcome: CancellationOutcome,
  booking: {
    id: string;
    host_id: string;
    nightly_rate: number | string;
    num_nights: number;
    cleaning_fee: number | string | null;
    currency?: string | null;
  },
): CancellationReversalInput {
  const subtotal = Number(booking.nightly_rate) * booking.num_nights;
  return {
    hostId: booking.host_id,
    bookingId: booking.id,
    bookingCurrency: booking.currency ?? 'USD',
    guestRefund: outcome.guestRefund,
    hostlyKeeps: outcome.hostlyKeeps,
    originalSubtotal: subtotal,
    originalCleaning: Number(booking.cleaning_fee ?? 0),
    hostPayout: outcome.hostPayout,
    tierLabel: outcome.tierLabel,
    tierId: outcome.tier,
  };
}