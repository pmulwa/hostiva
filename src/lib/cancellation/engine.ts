/**
 * Hostiva Cancellation Engine — 16 tiers
 * Computes guest refund, host payout, and Hostiva's retained portion
 * for any cancellation scenario. Pure functions — no DB calls.
 *
 * See /info/cancellation-policy for the full ruleset.
 */

import { D, toDbAmount } from '@/lib/accounting/money';
import Decimal from 'decimal.js';

// ---------- Configurable policy (admin-overridable) ----------

export interface CancellationPolicyConfig {
  tier3_cash_refund_pct: number;
  tier3_credit_pct: number;
  tier3_host_comp_pct: number;
  tier4_cash_refund_pct: number;
  tier4_credit_pct: number;
  tier4_host_comp_pct: number;
  /** Tier 7 — buffer nights charged to host beyond nights stayed (default 1) */
  tier7_buffer_nights: number;
  /** Tier 7 — additional unused nights deducted from guest refund (default 1) */
  tier7_refund_deduction_nights: number;
  tier8_unused_refund_pct: number;
  tier8_stayed_refund_pct: number;
  tier9_unused_refund_pct: number;
  tier9_stayed_refund_pct: number;
  host_cancel_fine_30plus: number;
  host_cancel_fine_7_30: number;
  host_cancel_fine_under_7: number;
  host_cancel_fine_under_24h: number;
  host_cancel_credit_30plus: number;
  host_cancel_credit_7_30: number;
  host_cancel_credit_under_7: number;
  host_cancel_credit_under_24h: number;
  goodwill_full_refund_enabled: boolean;
  /**
   * Admin Controls → "Guest cancellation window". When false, the 24h post-
   * booking grace period (Tier 1) is disabled — guests immediately fall into
   * the standard time-band tiers regardless of how recently they booked.
   */
  cancellation_window_enabled?: boolean;
  /**
   * Admin Controls → "Host cancellation penalty". When false, all host-cancel
   * fines and reliability impacts are zeroed out (guest-side refunds remain
   * unchanged — refunds are a contractual right, not a penalty).
   */
  host_penalty_enabled?: boolean;
}

export const DEFAULT_POLICY: CancellationPolicyConfig = {
  tier3_cash_refund_pct: 65,
  tier3_credit_pct: 90,
  tier3_host_comp_pct: 30,
  tier4_cash_refund_pct: 40,
  tier4_credit_pct: 70,
  tier4_host_comp_pct: 60,
  tier7_buffer_nights: 1,
  tier7_refund_deduction_nights: 1,
  tier8_unused_refund_pct: 100,
  tier8_stayed_refund_pct: 50,
  tier9_unused_refund_pct: 100,
  tier9_stayed_refund_pct: 25,
  host_cancel_fine_30plus: 0,
  host_cancel_fine_7_30: 100,
  host_cancel_fine_under_7: 200,
  host_cancel_fine_under_24h: 300,
  host_cancel_credit_30plus: 50,
  host_cancel_credit_7_30: 100,
  host_cancel_credit_under_7: 200,
  host_cancel_credit_under_24h: 300,
  goodwill_full_refund_enabled: true,
};

// ---------- Types ----------

export type CancellationInitiator = 'guest' | 'host' | 'system' | 'admin';

export type CancellationReason =
  | 'standard'           // Routes by timing (Tiers 1-7, 12-15)
  | 'no_show'            // Tier 6
  | 'property_issue'     // Tier 8 — host fault
  | 'emergency'          // Tier 9 — guest emergency
  | 'eviction'           // Tier 11 — guest fault
  | 'force_majeure'      // Case D
  | 'guest_death'        // Case G
  | 'property_destroyed' // Case H
  | 'double_booking'     // Case C
  | 'goodwill';          // Case I — host approves full refund minus service fee

export type CancellationOption = 'cash' | 'credit';

/**
 * Thrown when caller attempts to compute a cancellation outcome from
 * incomplete booking data (e.g., missing nightlyRate, totalNights, or
 * checkInAt). Callers MUST hydrate from the authoritative ledger
 * (bookings.total_price, bookings.actual_check_in_at, etc.) and never
 * silently fall back to recomputed defaults.
 */
export class CancellationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CancellationInputError';
  }
}

/**
 * Validate that a CancellationInput contains the authoritative fields
 * required by the engine. Throws CancellationInputError on the first
 * missing/invalid field so callers cannot compute math on stale or
 * partial booking rows.
 */
export function assertValidCancellationInput(input: CancellationInput): void {
  const nightly = Number(input.nightlyRate);
  if (!Number.isFinite(nightly) || nightly <= 0) {
    throw new CancellationInputError('nightlyRate must be a positive number from the booking ledger');
  }
  if (!Number.isFinite(input.totalNights) || input.totalNights <= 0) {
    throw new CancellationInputError('totalNights must be a positive integer from the booking ledger');
  }
  if (!input.checkInAt) {
    throw new CancellationInputError('checkInAt is required (use bookings.check_in_date + property check_in_time)');
  }
  const checkInDate = new Date(input.checkInAt);
  if (Number.isNaN(checkInDate.getTime())) {
    throw new CancellationInputError('checkInAt could not be parsed as a date');
  }
  if (!input.initiatedBy) {
    throw new CancellationInputError('initiatedBy is required');
  }
  // Optional fields, but if present must be valid numbers
  for (const field of ['cleaningFee', 'serviceFee', 'processingFee', 'taxes', 'securityDeposit'] as const) {
    const v = input[field];
    if (v !== undefined && v !== null) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) {
        throw new CancellationInputError(`${field} must be a non-negative number when provided`);
      }
    }
  }
  if (input.actualCheckInAt) {
    const d = new Date(input.actualCheckInAt);
    if (Number.isNaN(d.getTime())) {
      throw new CancellationInputError('actualCheckInAt could not be parsed as a date');
    }
  }
}

export interface CancellationInput {
  /** Nightly rate (subtotal / total nights, in booking currency) */
  nightlyRate: number | string;
  /** Total booked nights */
  totalNights: number;
  /** One-time cleaning fee */
  cleaningFee?: number | string;
  /** Guest-side service fee (Hostiva platform fee, with tax) */
  serviceFee?: number | string;
  /** Paystack processing fee — always non-refundable */
  processingFee?: number | string;
  /** Taxes collected on the booking (tourism levy, VAT, occupancy) */
  taxes?: number | string;
  /** Refundable security deposit, if pre-authed */
  securityDeposit?: number | string;

  /** ISO check-in datetime */
  checkInAt: string | Date;
  /** Cancellation submission time (defaults to now) */
  cancelledAt?: string | Date;
  /** When the booking was originally created */
  bookingCreatedAt?: string | Date;
  /** When the guest actually checked in (null if not yet) */
  actualCheckInAt?: string | Date | null;

  initiatedBy: CancellationInitiator;
  reason?: CancellationReason;
  /** Tier 3/4 only — guest's payout choice */
  chosenOption?: CancellationOption;
  /** Tier 5 — was the property cleaned before the cancellation arrived? */
  cleaningPerformed?: boolean;
  /** Tier 7b — host successfully rebooked some refunded nights within 7 days */
  rebookedNightsAfterCancel?: number;
  /** Tier 9 emergency / Case G — supporting documentation supplied */
  documentationProvided?: boolean;
}

export interface CancellationOutcome {
  tier: TierId;
  tierLabel: string;
  guestRefund: number;        // Cash back to guest
  guestCredit: number;        // Future-stay rebooking credit
  hostPayout: number;         // What the host receives
  hostlyKeeps: number;        // Platform retains (service fee + processing)
  hostPenalty: number;        // Fine deducted from next host payout (host-cancels)
  cleaningFeeRefunded: boolean;
  serviceFeeRefunded: boolean;
  processingFeeRefunded: boolean; // Always false in current implementation
  hostlyAbsorbs: number;      // Costs Hostiva absorbs (relocation stipends, etc.)
  reliabilityImpact: number;  // Negative points to host reliability score
  breakdown: BreakdownLine[];
  notes: string[];
}

export interface BreakdownLine {
  label: string;
  amount: number;
  kind: 'refund' | 'retain' | 'payout' | 'penalty' | 'credit' | 'absorb';
}

export type TierId =
  | 'tier1_grace'
  | 'tier2_early'
  | 'tier3_standard'
  | 'tier4_late'
  | 'tier5_same_day'
  | 'tier6_no_show'
  | 'tier7_mid_stay'
  | 'tier7b_mid_stay_rebooked'
  | 'tier8_property_issue'
  | 'tier9_emergency'
  | 'tier10_extended'
  | 'tier11_eviction'
  | 'tier12_host_30plus'
  | 'tier13_host_7_30'
  | 'tier14_host_under_7'
  | 'tier15_host_under_24h'
  | 'tier16_host_post_checkin'
  | 'goodwill_full_refund'
  | 'force_majeure'
  | 'guest_death'
  | 'property_destroyed'
  | 'double_booking';

const TIER_LABELS: Record<TierId, string> = {
  tier1_grace: 'Grace Period',
  tier2_early: 'Early Cancellation',
  tier3_standard: 'Standard Cancellation',
  tier4_late: 'Late Cancellation',
  tier5_same_day: 'Same-Day Cancellation',
  tier6_no_show: 'No-Show',
  tier7_mid_stay: 'Mid-Stay Cancellation',
  tier7b_mid_stay_rebooked: 'Mid-Stay (Rebooked Bonus)',
  tier8_property_issue: 'Property Issue (Host Fault)',
  tier9_emergency: 'Emergency Mid-Stay',
  tier10_extended: 'Extended Stay',
  tier11_eviction: 'Guest Eviction',
  tier12_host_30plus: 'Host Cancels (30+ days)',
  tier13_host_7_30: 'Host Cancels (7–30 days)',
  tier14_host_under_7: 'Host Cancels (<7 days)',
  tier15_host_under_24h: 'Host Cancels (<24 hours)',
  tier16_host_post_checkin: 'Host Cancels (Post-Check-in)',
  goodwill_full_refund: 'Goodwill — Full Refund (host approved)',
  force_majeure: 'Force Majeure',
  guest_death: 'Guest Death',
  property_destroyed: 'Property Destroyed',
  double_booking: 'Double-Booking (System Error)',
};

// ---------- Helpers ----------

const round2 = (v: Decimal | number | string): number => toDbAmount(D(v));

const hoursBetween = (a: Date, b: Date): number =>
  (a.getTime() - b.getTime()) / 3_600_000;

function nightsStayed(input: CancellationInput, now: Date): number {
  if (!input.actualCheckInAt) return 0;
  const checkedInAt = new Date(input.actualCheckInAt);
  const days = Math.floor((now.getTime() - checkedInAt.getTime()) / 86_400_000);
  return Math.max(0, Math.min(days, input.totalNights));
}

function gracePeriodEligible(input: CancellationInput, now: Date): boolean {
  if (!input.bookingCreatedAt) return false;
  const created = new Date(input.bookingCreatedAt);
  const hoursSinceBooking = hoursBetween(now, created);
  const hoursUntilCheckIn = hoursBetween(new Date(input.checkInAt), now);
  return hoursSinceBooking <= 24 && hoursUntilCheckIn >= 24 * 7;
}

function prorateTax(taxes: Decimal, totalNights: number, refundedNights: number): Decimal {
  if (totalNights <= 0) return D(0);
  return taxes.times(refundedNights).dividedBy(totalNights);
}

// ---------- Public API ----------

/**
 * Main entry point. Returns a deterministic outcome for any cancellation.
 * Pure function — safe to call from UI to preview math before writing to DB.
 */
export function calculateCancellationOutcome(
  input: CancellationInput,
  policy: CancellationPolicyConfig = DEFAULT_POLICY,
): CancellationOutcome {
  assertValidCancellationInput(input);
  const now = input.cancelledAt ? new Date(input.cancelledAt) : new Date();
  const checkInAt = new Date(input.checkInAt);
  const hoursUntilCheckIn = hoursBetween(checkInAt, now);
  const hasCheckedIn = !!input.actualCheckInAt && new Date(input.actualCheckInAt) <= now;

  // Route by reason first
  if (input.reason === 'goodwill' && input.initiatedBy === 'host' && policy.goodwill_full_refund_enabled) {
    return goodwillFullRefund(input);
  }
  if (input.reason === 'force_majeure') return forceMajeure(input);
  if (input.reason === 'guest_death') return guestDeath(input, now);
  if (input.reason === 'property_destroyed') return propertyDestroyed(input);
  if (input.reason === 'double_booking') return doubleBooking(input);
  if (input.reason === 'eviction' && hasCheckedIn) return tier11Eviction(input);
  if (input.reason === 'emergency' && hasCheckedIn) return tier9Emergency(input, now, policy);
  if (input.reason === 'property_issue' && hasCheckedIn) return tier8PropertyIssue(input, now, policy);
  if (input.reason === 'no_show' && hoursUntilCheckIn <= 0 && !hasCheckedIn) {
    return tier6NoShow(input);
  }

  // Host-initiated time bands
  if (input.initiatedBy === 'host') {
    let outcome: CancellationOutcome;
    if (hasCheckedIn) return tier16HostPostCheckIn(input, now);
    if (hoursUntilCheckIn >= 24 * 30) outcome = tier12Host30Plus(input, policy);
    else if (hoursUntilCheckIn >= 24 * 7) outcome = tier13Host7to30(input, policy);
    else if (hoursUntilCheckIn >= 24) outcome = tier14HostUnder7(input, policy);
    else outcome = tier15HostUnder24h(input, policy);
    // Admin Controls: when host_penalty_enabled === false, zero out the
    // punitive components. Guest refund/credit remain intact.
    if (policy.host_penalty_enabled === false && outcome.hostPenalty > 0) {
      outcome = {
        ...outcome,
        hostPenalty: 0,
        reliabilityImpact: 0,
        breakdown: outcome.breakdown.filter(b => b.kind !== 'penalty'),
        notes: [...outcome.notes, 'Host penalty waived by platform policy.'],
      };
    }
    return outcome;
  }

  // Guest-initiated, post-check-in => Tier 7
  if (hasCheckedIn) {
    const stayed = nightsStayed(input, now);
    return tier7MidStay(input, stayed, policy);
  }

  // Guest-initiated, pre-check-in time bands
  if (policy.cancellation_window_enabled !== false && gracePeriodEligible(input, now)) {
    return tier1Grace(input);
  }
  if (hoursUntilCheckIn >= 24 * 7) return tier2Early(input);
  if (hoursUntilCheckIn >= 24 * 3) return tier3Standard(input, policy);
  if (hoursUntilCheckIn >= 24) return tier4Late(input, policy);
  if (hoursUntilCheckIn > 0) return tier5SameDay(input);

  // Past check-in time, no actual check-in recorded => no-show
  return tier6NoShow(input);
}

// Convenience: returns just the tier id without doing financial math (e.g. for badging)
export function detectTier(input: CancellationInput): TierId {
  return calculateCancellationOutcome(input).tier;
}

// ---------- Tier implementations ----------

function tier1Grace(input: CancellationInput): CancellationOutcome {
  const subtotal = D(input.nightlyRate).times(input.totalNights);
  const cleaning = D(input.cleaningFee ?? 0);
  const taxes = D(input.taxes ?? 0);
  const serviceFee = D(input.serviceFee ?? 0);
  const processing = D(input.processingFee ?? 0);
  const refund = subtotal.plus(cleaning).plus(taxes).plus(serviceFee);
  return {
    tier: 'tier1_grace',
    tierLabel: TIER_LABELS.tier1_grace,
    guestRefund: round2(refund),
    guestCredit: 0,
    hostPayout: 0,
    hostlyKeeps: round2(processing),
    hostPenalty: 0,
    cleaningFeeRefunded: true,
    serviceFeeRefunded: true,
    processingFeeRefunded: false,
    hostlyAbsorbs: 0,
    reliabilityImpact: 0,
    breakdown: [
      { label: 'Accommodation refund', amount: round2(subtotal), kind: 'refund' },
      { label: 'Cleaning fee refund', amount: round2(cleaning), kind: 'refund' },
      { label: 'Service fee refund', amount: round2(serviceFee), kind: 'refund' },
      { label: 'Taxes refund', amount: round2(taxes), kind: 'refund' },
      { label: 'Processing fee retained', amount: round2(processing), kind: 'retain' },
    ],
    notes: ['Cancelled within 24 hours of booking and 7+ days before check-in.'],
  };
}

function tier2Early(input: CancellationInput): CancellationOutcome {
  return { ...tier1Grace(input), tier: 'tier2_early', tierLabel: TIER_LABELS.tier2_early,
    notes: ['Cancelled 7+ days before check-in. Property not yet prepared.'] };
}

function tier3Standard(input: CancellationInput, policy: CancellationPolicyConfig): CancellationOutcome {
  const subtotal = D(input.nightlyRate).times(input.totalNights);
  const cleaning = D(input.cleaningFee ?? 0);
  const taxes = D(input.taxes ?? 0);
  const serviceFee = D(input.serviceFee ?? 0);
  const processing = D(input.processingFee ?? 0);
  const cashPct = D(policy.tier3_cash_refund_pct).dividedBy(100);
  const hostCompPct = D(policy.tier3_host_comp_pct).dividedBy(100);

  // Cash refund only (credit option removed). Service fee is non-refundable
  // for every tier except T1/T2 — Hostiva keeps the full service fee here.
  const refundAccom = subtotal.times(cashPct);
  const guestRefund = refundAccom.plus(cleaning).plus(taxes);
  const hostPayout = subtotal.times(hostCompPct);
  const hostlyKeeps = serviceFee.plus(processing);
  return {
    tier: 'tier3_standard', tierLabel: TIER_LABELS.tier3_standard,
    guestRefund: round2(guestRefund), guestCredit: 0,
    hostPayout: round2(hostPayout), hostlyKeeps: round2(hostlyKeeps),
    hostPenalty: 0, cleaningFeeRefunded: true, serviceFeeRefunded: false,
    processingFeeRefunded: false, hostlyAbsorbs: 0, reliabilityImpact: 0,
    breakdown: [
      { label: `Accommodation refund (${policy.tier3_cash_refund_pct}%)`, amount: round2(refundAccom), kind: 'refund' },
      { label: 'Cleaning fee refund', amount: round2(cleaning), kind: 'refund' },
      { label: 'Taxes refund', amount: round2(taxes), kind: 'refund' },
      { label: `Host compensation (${policy.tier3_host_comp_pct}%)`, amount: round2(hostPayout), kind: 'payout' },
      { label: 'Service + processing fees retained', amount: round2(hostlyKeeps), kind: 'retain' },
    ],
    notes: [`3–7 days before check-in. ${policy.tier3_cash_refund_pct}% accommodation refund returned to your card.`],
  };
}

function tier4Late(input: CancellationInput, policy: CancellationPolicyConfig): CancellationOutcome {
  const subtotal = D(input.nightlyRate).times(input.totalNights);
  const cleaning = D(input.cleaningFee ?? 0);
  const taxes = D(input.taxes ?? 0);
  const serviceFee = D(input.serviceFee ?? 0);
  const processing = D(input.processingFee ?? 0);
  const cashPct = D(policy.tier4_cash_refund_pct).dividedBy(100);
  const hostCompPct = D(policy.tier4_host_comp_pct).dividedBy(100);

  // Cash refund only (credit option removed)
  const refundAccom = subtotal.times(cashPct);
  const guestRefund = refundAccom.plus(cleaning).plus(taxes);
  const hostPayout = subtotal.times(hostCompPct);
  const hostlyKeeps = serviceFee.plus(processing);
  return {
    tier: 'tier4_late', tierLabel: TIER_LABELS.tier4_late,
    guestRefund: round2(guestRefund), guestCredit: 0,
    hostPayout: round2(hostPayout), hostlyKeeps: round2(hostlyKeeps),
    hostPenalty: 0, cleaningFeeRefunded: true, serviceFeeRefunded: false,
    processingFeeRefunded: false, hostlyAbsorbs: 0, reliabilityImpact: 0,
    breakdown: [
      { label: `Accommodation refund (${policy.tier4_cash_refund_pct}%)`, amount: round2(refundAccom), kind: 'refund' },
      { label: 'Cleaning fee refund', amount: round2(cleaning), kind: 'refund' },
      { label: 'Taxes refund', amount: round2(taxes), kind: 'refund' },
      { label: `Host compensation (${policy.tier4_host_comp_pct}%)`, amount: round2(hostPayout), kind: 'payout' },
      { label: 'Service + processing fees retained', amount: round2(hostlyKeeps), kind: 'retain' },
    ],
    notes: [`24–72 hours before check-in. ${policy.tier4_cash_refund_pct}% accommodation refund returned to your card.`],
  };
}

function tier5SameDay(input: CancellationInput): CancellationOutcome {
  const nightly = D(input.nightlyRate);
  const totalNights = input.totalNights;
  const cleaning = D(input.cleaningFee ?? 0);
  const taxes = D(input.taxes ?? 0);
  const serviceFee = D(input.serviceFee ?? 0);
  const processing = D(input.processingFee ?? 0);
  const cleaned = !!input.cleaningPerformed;

  const refundedNights = Math.max(0, totalNights - 1);
  const refundAccom = nightly.times(refundedNights);
  const refundTaxes = prorateTax(taxes, totalNights, refundedNights);
  const refundCleaning = cleaned ? D(0) : cleaning;
  const guestRefund = refundAccom.plus(refundCleaning).plus(refundTaxes);

  const hostCleaning = cleaned ? cleaning : D(0);
  const hostPayout = nightly.plus(serviceFee).plus(hostCleaning);
  const hostlyKeeps = processing;

  return {
    tier: 'tier5_same_day', tierLabel: TIER_LABELS.tier5_same_day,
    guestRefund: round2(guestRefund), guestCredit: 0,
    hostPayout: round2(hostPayout), hostlyKeeps: round2(hostlyKeeps),
    hostPenalty: 0, cleaningFeeRefunded: !cleaned, serviceFeeRefunded: false,
    processingFeeRefunded: false, hostlyAbsorbs: 0, reliabilityImpact: 0,
    breakdown: [
      { label: `Accommodation refund (${refundedNights} nights)`, amount: round2(refundAccom), kind: 'refund' },
      { label: cleaned ? 'Cleaning fee forfeited (already cleaned)' : 'Cleaning fee refund', amount: round2(refundCleaning), kind: cleaned ? 'retain' : 'refund' },
      { label: 'Prorated taxes refund', amount: round2(refundTaxes), kind: 'refund' },
      { label: 'Host: 1 compensation night', amount: round2(nightly), kind: 'payout' },
      { label: 'Host: full service fee', amount: round2(serviceFee), kind: 'payout' },
      ...(cleaned ? [{ label: 'Host: cleaning fee', amount: round2(cleaning), kind: 'payout' as const }] : []),
      { label: 'Processing fee retained', amount: round2(processing), kind: 'retain' },
    ],
    notes: ['Within 24 hours of check-in. Host receives 1 night + service fee.'],
  };
}

function tier6NoShow(input: CancellationInput): CancellationOutcome {
  const nightly = D(input.nightlyRate);
  const cleaning = D(input.cleaningFee ?? 0);
  const serviceFee = D(input.serviceFee ?? 0);
  const processing = D(input.processingFee ?? 0);
  const taxes = D(input.taxes ?? 0);
  const totalNights = Math.max(1, input.totalNights);
  const cleaned = !!input.cleaningPerformed;

  // Host always charged 1 night + service fee, plus cleaning only if performed.
  const chargedNights = Math.min(1, totalNights);
  const refundableNights = Math.max(0, totalNights - chargedNights);

  const refundAccom = nightly.times(refundableNights);
  const refundTaxes = prorateTax(taxes, totalNights, refundableNights);
  const refundCleaning = cleaned ? D(0) : cleaning;

  const guestRefund = refundAccom.plus(refundTaxes).plus(refundCleaning);
  const hostPayout = nightly.times(chargedNights).plus(serviceFee).plus(cleaned ? cleaning : D(0));

  const isMultiNight = totalNights > 1;
  return {
    tier: 'tier6_no_show', tierLabel: TIER_LABELS.tier6_no_show,
    guestRefund: round2(guestRefund), guestCredit: 0,
    hostPayout: round2(hostPayout), hostlyKeeps: round2(processing),
    hostPenalty: 0, cleaningFeeRefunded: !cleaned, serviceFeeRefunded: false,
    processingFeeRefunded: false, hostlyAbsorbs: 0, reliabilityImpact: 0,
    breakdown: [
      ...(refundableNights > 0
        ? [{ label: `Accommodation refund (${refundableNights} unused night${refundableNights === 1 ? '' : 's'})`, amount: round2(refundAccom), kind: 'refund' as const }]
        : []),
      ...(refundableNights > 0 && refundTaxes.gt(0)
        ? [{ label: 'Prorated taxes refund', amount: round2(refundTaxes), kind: 'refund' as const }]
        : []),
      { label: cleaned ? 'Cleaning fee forfeited (already cleaned)' : 'Cleaning fee refund', amount: round2(refundCleaning), kind: cleaned ? 'retain' : 'refund' },
      { label: 'Host: 1 night charge', amount: round2(nightly.times(chargedNights)), kind: 'payout' },
      ...(cleaned ? [{ label: 'Host: cleaning fee', amount: round2(cleaning), kind: 'payout' as const }] : []),
      { label: 'Host: full service fee', amount: round2(serviceFee), kind: 'payout' },
      { label: 'Processing fee retained', amount: round2(processing), kind: 'retain' },
    ],
    notes: [
      isMultiNight
        ? `Guest never arrived. Host charged 1 night${cleaned ? ' + cleaning' : ''} + service fee; remaining ${refundableNights} night${refundableNights === 1 ? '' : 's'} refunded to guest.`
        : 'Guest never arrived. Single-night booking forfeited per policy.',
      'Remaining nights auto-released to calendar.',
    ],
  };
}

function tier7MidStay(input: CancellationInput, stayed: number, policy: CancellationPolicyConfig): CancellationOutcome {
  const nightly = D(input.nightlyRate);
  const totalNights = input.totalNights;
  const cleaning = D(input.cleaningFee ?? 0);
  const taxes = D(input.taxes ?? 0);
  const serviceFee = D(input.serviceFee ?? 0);
  const processing = D(input.processingFee ?? 0);

  // Admin-configurable buffer (extra nights charged to host beyond stayed)
  // and deduction (extra unused nights guest forfeits — the "minus 1").
  const buffer = Math.max(0, Math.floor(policy.tier7_buffer_nights ?? 1));
  const deduction = Math.max(0, Math.floor(policy.tier7_refund_deduction_nights ?? 1));

  const chargeable = Math.min(totalNights, stayed + buffer);
  const remainingUnused = Math.max(0, totalNights - chargeable);
  const refundableNights = Math.max(0, remainingUnused - deduction);
  const refundAccom = nightly.times(refundableNights);
  const refundTaxes = prorateTax(taxes, totalNights, refundableNights);

  const guestRefund = refundAccom.plus(refundTaxes);
  // Service fee is non-refundable for all tiers except T1/T2 → Hostiva keeps it.
  const hostPayout = nightly.times(chargeable).plus(cleaning);
  const hostlyKeeps = serviceFee.plus(processing);

  return {
    tier: 'tier7_mid_stay',
    tierLabel: TIER_LABELS.tier7_mid_stay,
    guestRefund: round2(guestRefund),
    guestCredit: 0,
    hostPayout: round2(hostPayout),
    hostlyKeeps: round2(hostlyKeeps),
    hostPenalty: 0, cleaningFeeRefunded: false, serviceFeeRefunded: false,
    processingFeeRefunded: false, hostlyAbsorbs: 0, reliabilityImpact: 0,
    breakdown: [
      { label: `Accommodation refund (${refundableNights} unused nights, minus ${deduction})`, amount: round2(refundAccom), kind: 'refund' },
      { label: 'Prorated taxes refund', amount: round2(refundTaxes), kind: 'refund' },
      { label: `Host: ${chargeable} nights (stayed + ${buffer} buffer)`, amount: round2(nightly.times(chargeable)), kind: 'payout' },
      { label: 'Host: cleaning fee (property used)', amount: round2(cleaning), kind: 'payout' },
      { label: 'Service + processing fees retained', amount: round2(hostlyKeeps), kind: 'retain' },
    ],
    notes: [`Guest stayed ${stayed} night(s). Host charged for stayed + ${buffer} buffer night${buffer === 1 ? '' : 's'}; guest refund minus ${deduction} unused night${deduction === 1 ? '' : 's'}.`],
  };
}

function tier8PropertyIssue(input: CancellationInput, now: Date, policy: CancellationPolicyConfig): CancellationOutcome {
  const nightly = D(input.nightlyRate);
  const totalNights = input.totalNights;
  const cleaning = D(input.cleaningFee ?? 0);
  const stayed = nightsStayed(input, now);
  const unused = Math.max(0, totalNights - stayed);
  const unusedPct = D(policy.tier8_unused_refund_pct).dividedBy(100);
  const stayedPct = D(policy.tier8_stayed_refund_pct).dividedBy(100);
  const refund = nightly.times(unused).times(unusedPct).plus(nightly.times(stayed).times(stayedPct)).plus(cleaning);
  const hostPayout = nightly.times(stayed).times(D(1).minus(stayedPct));
  return {
    tier: 'tier8_property_issue', tierLabel: TIER_LABELS.tier8_property_issue,
    guestRefund: round2(refund), guestCredit: 0,
    hostPayout: round2(hostPayout), hostlyKeeps: 0,
    hostPenalty: 0, cleaningFeeRefunded: true, serviceFeeRefunded: true,
    processingFeeRefunded: false, hostlyAbsorbs: round2(D(input.processingFee ?? 0)),
    reliabilityImpact: -10,
    breakdown: [
      { label: `Refund: ${unused} unused nights`, amount: round2(nightly.times(unused)), kind: 'refund' },
      { label: 'Refund: 50% of nights already stayed', amount: round2(nightly.times(stayed).times(0.5)), kind: 'refund' },
      { label: 'Cleaning fee refund', amount: round2(cleaning), kind: 'refund' },
      { label: 'Host: 50% of stayed nights only', amount: round2(hostPayout), kind: 'payout' },
    ],
    notes: ['Verified property issue (host fault). Quality strike on host record.'],
  };
}

function tier9Emergency(input: CancellationInput, now: Date, policy: CancellationPolicyConfig): CancellationOutcome {
  const nightly = D(input.nightlyRate);
  const totalNights = input.totalNights;
  const cleaning = D(input.cleaningFee ?? 0);
  const serviceFee = D(input.serviceFee ?? 0);
  const stayed = nightsStayed(input, now);
  const unused = Math.max(0, totalNights - stayed);
  const unusedPct = D(policy.tier9_unused_refund_pct).dividedBy(100);
  const stayedPct = D(policy.tier9_stayed_refund_pct).dividedBy(100);
  const refund = nightly.times(unused).times(unusedPct).plus(nightly.times(stayed).times(stayedPct)).plus(cleaning);
  const hostPayout = nightly.times(stayed).times(D(1).minus(stayedPct)).plus(serviceFee);
  const hostlyAdmin = refund.times(0.05);
  return {
    tier: 'tier9_emergency', tierLabel: TIER_LABELS.tier9_emergency,
    guestRefund: round2(refund.minus(hostlyAdmin)), guestCredit: 0,
    hostPayout: round2(hostPayout), hostlyKeeps: round2(hostlyAdmin),
    hostPenalty: 0, cleaningFeeRefunded: true, serviceFeeRefunded: false,
    processingFeeRefunded: false, hostlyAbsorbs: 0, reliabilityImpact: 0,
    breakdown: [
      { label: `Refund: ${unused} unused nights`, amount: round2(nightly.times(unused)), kind: 'refund' },
      { label: 'Refund: 25% of stayed nights', amount: round2(nightly.times(stayed).times(0.25)), kind: 'refund' },
      { label: 'Cleaning fee refund', amount: round2(cleaning), kind: 'refund' },
      { label: 'Host: 75% of stayed nights + service fee', amount: round2(hostPayout), kind: 'payout' },
      { label: 'Hostiva admin fee (5%)', amount: round2(hostlyAdmin), kind: 'retain' },
    ],
    notes: ['Documented emergency. Subject to 48-hour host review and admin arbitration if disputed.'],
  };
}

function tier11Eviction(input: CancellationInput): CancellationOutcome {
  const subtotal = D(input.nightlyRate).times(input.totalNights);
  const cleaning = D(input.cleaningFee ?? 0);
  const serviceFee = D(input.serviceFee ?? 0);
  return {
    tier: 'tier11_eviction', tierLabel: TIER_LABELS.tier11_eviction,
    guestRefund: 0, guestCredit: 0,
    hostPayout: round2(subtotal.plus(cleaning).plus(serviceFee)),
    hostlyKeeps: round2(D(input.processingFee ?? 0)),
    hostPenalty: 0, cleaningFeeRefunded: false, serviceFeeRefunded: false,
    processingFeeRefunded: false, hostlyAbsorbs: 0, reliabilityImpact: 0,
    breakdown: [
      { label: 'Host: 100% of booking + cleaning + service fee', amount: round2(subtotal.plus(cleaning).plus(serviceFee)), kind: 'payout' },
      { label: 'Plus right to claim damages from security deposit', amount: round2(D(input.securityDeposit ?? 0)), kind: 'payout' },
    ],
    notes: ['Host eviction for documented rule violation. 24-hour admin review before refund release.'],
  };
}

// Host-initiated cancellations
function tier12Host30Plus(input: CancellationInput, policy: CancellationPolicyConfig): CancellationOutcome {
  const total = D(input.nightlyRate).times(input.totalNights)
    .plus(D(input.cleaningFee ?? 0)).plus(D(input.taxes ?? 0)).plus(D(input.serviceFee ?? 0));
  const fine = policy.host_cancel_fine_30plus;
  const hostlyKeeps = D(input.processingFee ?? 0).plus(fine);
  return {
    tier: 'tier12_host_30plus', tierLabel: TIER_LABELS.tier12_host_30plus,
    guestRefund: round2(total), guestCredit: policy.host_cancel_credit_30plus,
    hostPayout: 0, hostlyKeeps: round2(hostlyKeeps),
    hostPenalty: fine, cleaningFeeRefunded: true, serviceFeeRefunded: true,
    processingFeeRefunded: false, hostlyAbsorbs: policy.host_cancel_credit_30plus, reliabilityImpact: -5,
    breakdown: [
      { label: '100% guest refund', amount: round2(total), kind: 'refund' },
      ...(fine > 0 ? [{ label: 'Penalty', amount: fine, kind: 'penalty' as const }] : []),
    ],
    notes: ['Host cancelled 30+ days out. First-offense warning, calendar blocked.'],
  };
}

function tier13Host7to30(input: CancellationInput, policy: CancellationPolicyConfig): CancellationOutcome {
  const total = D(input.nightlyRate).times(input.totalNights)
    .plus(D(input.cleaningFee ?? 0)).plus(D(input.taxes ?? 0)).plus(D(input.serviceFee ?? 0));
  const fine = policy.host_cancel_fine_7_30;
  const hostlyKeeps = D(input.processingFee ?? 0).plus(fine);
  return {
    tier: 'tier13_host_7_30', tierLabel: TIER_LABELS.tier13_host_7_30,
    guestRefund: round2(total), guestCredit: policy.host_cancel_credit_7_30,
    hostPayout: 0, hostlyKeeps: round2(hostlyKeeps),
    hostPenalty: fine, cleaningFeeRefunded: true, serviceFeeRefunded: true,
    processingFeeRefunded: false, hostlyAbsorbs: 0, reliabilityImpact: -10,
    breakdown: [
      { label: '100% guest refund', amount: round2(total), kind: 'refund' },
      { label: 'Penalty', amount: fine, kind: 'penalty' },
    ],
    notes: [`Host cancelled 7–30 days out. $${policy.host_cancel_fine_7_30} fine, 30-day probation.`],
  };
}

function tier14HostUnder7(input: CancellationInput, policy: CancellationPolicyConfig): CancellationOutcome {
  const total = D(input.nightlyRate).times(input.totalNights)
    .plus(D(input.cleaningFee ?? 0)).plus(D(input.taxes ?? 0)).plus(D(input.serviceFee ?? 0));
  const fine = policy.host_cancel_fine_under_7;
  const hostlyKeeps = D(input.processingFee ?? 0).plus(fine);
  return {
    tier: 'tier14_host_under_7', tierLabel: TIER_LABELS.tier14_host_under_7,
    guestRefund: round2(total), guestCredit: policy.host_cancel_credit_under_7,
    hostPayout: 0, hostlyKeeps: round2(hostlyKeeps),
    hostPenalty: fine, cleaningFeeRefunded: true, serviceFeeRefunded: true,
    processingFeeRefunded: false, hostlyAbsorbs: 0, reliabilityImpact: -20,
    breakdown: [
      { label: '100% guest refund', amount: round2(total), kind: 'refund' },
      { label: 'Penalty', amount: fine, kind: 'penalty' },
    ],
    notes: [`Host cancelled <7 days out. $${policy.host_cancel_fine_under_7} fine, 90-day probation.`],
  };
}

function tier15HostUnder24h(input: CancellationInput, policy: CancellationPolicyConfig): CancellationOutcome {
  const total = D(input.nightlyRate).times(input.totalNights)
    .plus(D(input.cleaningFee ?? 0)).plus(D(input.taxes ?? 0)).plus(D(input.serviceFee ?? 0));
  const fine = policy.host_cancel_fine_under_24h;
  const hostlyKeeps = D(input.processingFee ?? 0).plus(fine);
  return {
    tier: 'tier15_host_under_24h', tierLabel: TIER_LABELS.tier15_host_under_24h,
    guestRefund: round2(total), guestCredit: policy.host_cancel_credit_under_24h,
    hostPayout: 0, hostlyKeeps: round2(hostlyKeeps),
    hostPenalty: fine, cleaningFeeRefunded: true, serviceFeeRefunded: true,
    processingFeeRefunded: false, hostlyAbsorbs: 0, reliabilityImpact: -40,
    breakdown: [
      { label: '100% guest refund', amount: round2(total), kind: 'refund' },
      { label: 'Penalty', amount: fine, kind: 'penalty' },
    ],
    notes: [`Host cancelled <24 hours out. $${policy.host_cancel_fine_under_24h} fine, 2nd occurrence = 6-month suspension.`],
  };
}

function tier16HostPostCheckIn(input: CancellationInput, now: Date): CancellationOutcome {
  const stayed = nightsStayed(input, now);
  const unused = Math.max(0, input.totalNights - stayed);
  const total = D(input.nightlyRate).times(input.totalNights)
    .plus(D(input.cleaningFee ?? 0)).plus(D(input.taxes ?? 0)).plus(D(input.serviceFee ?? 0));
  const relocationCap = D(200).times(unused);
  const fine = round2(total);
  const hostlyKeeps = D(input.processingFee ?? 0).plus(fine);
  return {
    tier: 'tier16_host_post_checkin', tierLabel: TIER_LABELS.tier16_host_post_checkin,
    guestRefund: round2(total), guestCredit: 500,
    hostPayout: 0, hostlyKeeps: round2(hostlyKeeps),
    hostPenalty: fine, cleaningFeeRefunded: true, serviceFeeRefunded: true,
    processingFeeRefunded: false, hostlyAbsorbs: round2(relocationCap.plus(500)),
    reliabilityImpact: -100,
    breakdown: [
      { label: '100% guest refund', amount: round2(total), kind: 'refund' },
      { label: 'Relocation stipend (Hostiva absorbs)', amount: 500, kind: 'absorb' },
      { label: `Alt lodging up to $200/night × ${unused} nights`, amount: round2(relocationCap), kind: 'absorb' },
      { label: 'Penalty', amount: fine, kind: 'penalty' },
      { label: 'Host: permanent ban pending appeal', amount: 0, kind: 'penalty' },
    ],
    notes: ['Host evicted guest without cause. Account banned. Hostiva pursues full reimbursement.'],
  };
}

// Special cases

function goodwillFullRefund(input: CancellationInput): CancellationOutcome {
  // 100% refund minus service fee (host approves; guest service fee NEVER refunded)
  const subtotal = D(input.nightlyRate).times(input.totalNights);
  const cleaning = D(input.cleaningFee ?? 0);
  const taxes = D(input.taxes ?? 0);
  const serviceFee = D(input.serviceFee ?? 0);
  const processing = D(input.processingFee ?? 0);
  const refund = subtotal.plus(cleaning).plus(taxes);
  return {
    tier: 'goodwill_full_refund', tierLabel: TIER_LABELS.goodwill_full_refund,
    guestRefund: round2(refund), guestCredit: 0,
    hostPayout: 0, hostlyKeeps: round2(serviceFee.plus(processing)),
    hostPenalty: 0, cleaningFeeRefunded: true, serviceFeeRefunded: false,
    processingFeeRefunded: false, hostlyAbsorbs: 0, reliabilityImpact: 0,
    breakdown: [
      { label: 'Accommodation refund (100%)', amount: round2(subtotal), kind: 'refund' },
      { label: 'Cleaning fee refund', amount: round2(cleaning), kind: 'refund' },
      { label: 'Taxes refund', amount: round2(taxes), kind: 'refund' },
      { label: 'Service fee retained (non-refundable)', amount: round2(serviceFee), kind: 'retain' },
      { label: 'Processing fee retained', amount: round2(processing), kind: 'retain' },
    ],
    notes: ['Host approved a goodwill 100% refund. Guest service fee is never refunded.'],
  };
}

function forceMajeure(input: CancellationInput): CancellationOutcome {
  const total = D(input.nightlyRate).times(input.totalNights)
    .plus(D(input.cleaningFee ?? 0)).plus(D(input.taxes ?? 0)).plus(D(input.serviceFee ?? 0));
  const goodwill = D(input.nightlyRate).times(input.totalNights).times(0.25);
  return {
    tier: 'force_majeure', tierLabel: TIER_LABELS.force_majeure,
    guestRefund: round2(total), guestCredit: round2(total.times(0.1)),
    hostPayout: round2(goodwill), hostlyKeeps: 0,
    hostPenalty: 0, cleaningFeeRefunded: true, serviceFeeRefunded: true,
    processingFeeRefunded: false, hostlyAbsorbs: round2(goodwill.plus(total.times(0.1))),
    reliabilityImpact: 0,
    breakdown: [
      { label: '100% guest refund', amount: round2(total), kind: 'refund' },
      { label: 'Host goodwill (Hostiva Trust Fund)', amount: round2(goodwill), kind: 'absorb' },
      { label: '10% bonus credit for both parties', amount: round2(total.times(0.1)), kind: 'absorb' },
    ],
    notes: ['Force majeure event (disaster, pandemic, lockdown). No host penalty.'],
  };
}

function guestDeath(input: CancellationInput, now: Date): CancellationOutcome {
  const nightly = D(input.nightlyRate);
  const totalNights = input.totalNights;
  const cleaning = D(input.cleaningFee ?? 0);
  const serviceFee = D(input.serviceFee ?? 0);
  const stayed = nightsStayed(input, now);
  const unused = Math.max(0, totalNights - stayed);
  const refund = nightly.times(unused).plus(cleaning);
  const hostPayout = nightly.times(stayed).plus(serviceFee);
  return {
    tier: 'guest_death', tierLabel: TIER_LABELS.guest_death,
    guestRefund: round2(refund), guestCredit: 0,
    hostPayout: round2(hostPayout), hostlyKeeps: 0,
    hostPenalty: 0, cleaningFeeRefunded: true, serviceFeeRefunded: true,
    processingFeeRefunded: true, hostlyAbsorbs: round2(D(input.processingFee ?? 0)),
    reliabilityImpact: 0,
    breakdown: [
      { label: `Refund: ${unused} unused nights`, amount: round2(nightly.times(unused)), kind: 'refund' },
      { label: 'Cleaning fee refund', amount: round2(cleaning), kind: 'refund' },
      { label: 'Host: stayed nights + service fee', amount: round2(hostPayout), kind: 'payout' },
      { label: 'All Hostiva fees waived as goodwill', amount: round2(D(input.processingFee ?? 0)), kind: 'absorb' },
    ],
    notes: ['Death certificate required. All Hostiva fees waived as goodwill.'],
  };
}

function propertyDestroyed(input: CancellationInput): CancellationOutcome {
  const total = D(input.nightlyRate).times(input.totalNights)
    .plus(D(input.cleaningFee ?? 0)).plus(D(input.taxes ?? 0)).plus(D(input.serviceFee ?? 0));
  return {
    tier: 'property_destroyed', tierLabel: TIER_LABELS.property_destroyed,
    guestRefund: round2(total), guestCredit: 100,
    hostPayout: 0, hostlyKeeps: 0,
    hostPenalty: 0, cleaningFeeRefunded: true, serviceFeeRefunded: true,
    processingFeeRefunded: false, hostlyAbsorbs: round2(D(input.processingFee ?? 0).plus(100)),
    reliabilityImpact: 0,
    breakdown: [
      { label: '100% guest refund', amount: round2(total), kind: 'refund' },
      { label: 'Priority relocation credit', amount: 100, kind: 'absorb' },
    ],
    notes: ['Property uninhabitable. No host penalty. Hostiva assists with insurance claim.'],
  };
}

function doubleBooking(input: CancellationInput): CancellationOutcome {
  const total = D(input.nightlyRate).times(input.totalNights)
    .plus(D(input.cleaningFee ?? 0)).plus(D(input.taxes ?? 0)).plus(D(input.serviceFee ?? 0));
  return {
    tier: 'double_booking', tierLabel: TIER_LABELS.double_booking,
    guestRefund: round2(total), guestCredit: 150,
    hostPayout: 0, hostlyKeeps: 0,
    hostPenalty: 0, cleaningFeeRefunded: true, serviceFeeRefunded: true,
    processingFeeRefunded: false, hostlyAbsorbs: round2(D(input.processingFee ?? 0).plus(150)),
    reliabilityImpact: 0,
    breakdown: [
      { label: '100% guest refund', amount: round2(total), kind: 'refund' },
      { label: 'Goodwill credit (Hostiva absorbs)', amount: 150, kind: 'absorb' },
    ],
    notes: ['Calendar sync failure. No host penalty.'],
  };
}