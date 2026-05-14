/**
 * Fraud risk scoring engine — STUB IMPLEMENTATION.
 *
 * Schema and admin tier configuration are wired up. The actual signal
 * calculations return fixed values for now so admins can design the rule
 * weights manually. Each signal returns 0–25 (max combined = 100).
 *
 * To activate real scoring later, replace each `calculate*` function below
 * with the real signal logic (IP geolocation, payment history, velocity, etc.)
 * and `routeBookingByScore` will route the booking through the correct tier.
 */

import type { TrustSafetySettings } from '@/hooks/useTrustSafetySettings';

export type FraudTier = 'auto_approve' | 'flag_review' | 'require_verification' | 'block_review';

export interface FraudInput {
  guestId: string;
  bookingId: string;
  bookingAmountUsd: number;
  guestAccountAgeDays: number;
  guestPriorBookings: number;
  guestPriorChargebacks: number;
  bookingCompletionSeconds?: number;
  guestCountry?: string;
  propertyCountry?: string;
  ipCountry?: string;
  paymentMethodCountry?: string;
}

export interface FraudScore {
  score: number;
  tier: FraudTier;
  base_score: number;
  payment_signals: number;
  geo_signals: number;
  behavioural_signals: number;
  signals_detail: Record<string, unknown>;
}

function calculateBaseScore(input: FraudInput, settings: TrustSafetySettings): number {
  // Stub: returns a small risk for new accounts on high-value bookings
  let score = 0;
  if (input.guestAccountAgeDays < settings.new_account_days) score += 10;
  if (input.bookingAmountUsd > settings.high_value_booking_usd) score += 10;
  if (input.guestPriorBookings === 0) score += 5;
  return Math.min(25, score);
}

function calculatePaymentSignals(input: FraudInput): number {
  // Stub: chargeback history is the only signal wired
  let score = 0;
  if (input.guestPriorChargebacks > 0) score += 15;
  if (input.guestPriorChargebacks > 2) score += 10;
  return Math.min(25, score);
}

function calculateGeoSignals(input: FraudInput): number {
  // Stub: simple country mismatch checks (no IP geolocation yet)
  let score = 0;
  if (input.ipCountry && input.paymentMethodCountry && input.ipCountry !== input.paymentMethodCountry) score += 15;
  if (input.guestCountry && input.propertyCountry && input.guestCountry !== input.propertyCountry) score += 5;
  return Math.min(25, score);
}

function calculateBehaviouralSignals(input: FraudInput, settings: TrustSafetySettings): number {
  // Stub: rapid booking is the only behavioural signal wired
  let score = 0;
  if (input.bookingCompletionSeconds !== undefined && input.bookingCompletionSeconds < settings.rapid_booking_seconds) score += 15;
  return Math.min(25, score);
}

export function tierFromScore(score: number, settings: TrustSafetySettings): FraudTier {
  if (score <= settings.risk_threshold_auto_approve) return 'auto_approve';
  if (score <= settings.risk_threshold_flag_review) return 'flag_review';
  if (score <= settings.risk_threshold_require_verification) return 'require_verification';
  return 'block_review';
}

export function calculateFraudScore(input: FraudInput, settings: TrustSafetySettings): FraudScore {
  const base_score = calculateBaseScore(input, settings);
  const payment_signals = calculatePaymentSignals(input);
  const geo_signals = calculateGeoSignals(input);
  const behavioural_signals = calculateBehaviouralSignals(input, settings);
  const score = Math.min(100, base_score + payment_signals + geo_signals + behavioural_signals);
  const tier = tierFromScore(score, settings);

  return {
    score,
    tier,
    base_score,
    payment_signals,
    geo_signals,
    behavioural_signals,
    signals_detail: {
      account_age_days: input.guestAccountAgeDays,
      prior_bookings: input.guestPriorBookings,
      prior_chargebacks: input.guestPriorChargebacks,
      booking_amount_usd: input.bookingAmountUsd,
      completion_seconds: input.bookingCompletionSeconds,
      ip_country: input.ipCountry,
      payment_country: input.paymentMethodCountry,
      guest_country: input.guestCountry,
      property_country: input.propertyCountry,
    },
  };
}

export const TIER_LABELS: Record<FraudTier, string> = {
  auto_approve: 'Auto-approve',
  flag_review: 'Approve & flag',
  require_verification: 'Require verification',
  block_review: 'Block & review',
};

export const TIER_COLORS: Record<FraudTier, string> = {
  auto_approve: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
  flag_review: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
  require_verification: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20',
  block_review: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
};