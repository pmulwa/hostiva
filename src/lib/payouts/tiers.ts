import { PayoutTiersConfig } from '@/hooks/usePayoutTiers';

/**
 * Three-band commission ladder (per Hostiva Payout Logic §7.1):
 *   • starter_free  — first N confirmed bookings, 0%
 *   • starter_low   — bookings (N+1) … M, reduced rate (default 6%)
 *   • standard      — every booking after M, full rate (default 8%)
 */
export type TierKey = 'starter_free' | 'starter_low' | 'standard';

export const TIER_LABELS: Record<TierKey, string> = {
  starter_free: 'Starter — Welcome',
  starter_low: 'Starter — Reduced',
  standard: 'Standard',
};

export const TIER_COLORS: Record<TierKey, string> = {
  starter_free: 'bg-emerald-500/10 text-emerald-700 border-emerald-300',
  starter_low: 'bg-sky-500/10 text-sky-700 border-sky-300',
  standard: 'bg-slate-500/10 text-slate-700 border-slate-300',
};

export interface HostMetrics {
  completed_bookings: number;
  avg_rating: number;
  response_rate: number;
  cancellation_rate: number;
}

/** Maps a host's lifetime booking count to the correct band + commission. */
export function determineTier(
  metrics: HostMetrics,
  c: PayoutTiersConfig
): { tier: TierKey; commission_pct: number } {
  const n = metrics.completed_bookings;
  if (n < c.starter_free_bookings) {
    return { tier: 'starter_free', commission_pct: c.starter_free_pct };
  }
  if (n < c.starter_low_bookings) {
    return { tier: 'starter_low', commission_pct: c.starter_low_pct };
  }
  return { tier: 'standard', commission_pct: c.standard_pct };
}

/**
 * Returns booking count remaining in the current tier (for progress bars).
 * Returns null when the host is already on Standard.
 */
export function tierProgress(
  metrics: HostMetrics,
  c: PayoutTiersConfig
): { current: number; bandStart: number; bandEnd: number; remaining: number } | null {
  const n = metrics.completed_bookings;
  if (n < c.starter_free_bookings) {
    return { current: n, bandStart: 0, bandEnd: c.starter_free_bookings, remaining: c.starter_free_bookings - n };
  }
  if (n < c.starter_low_bookings) {
    return {
      current: n,
      bandStart: c.starter_free_bookings,
      bandEnd: c.starter_low_bookings,
      remaining: c.starter_low_bookings - n,
    };
  }
  return null;
}

/** Per-spec §7.3 — only Standard release mode is offered. */
export const RELEASE_MODES = {
  standard: { label: 'Standard', desc: '24 hours after guest check-in', cost: 'Free' },
} as const;

/** Per-spec §7.4 — payout methods, processing times and Hostiva cost. */
export const PAYOUT_METHODS = {
  bank_swift: { label: 'Bank transfer (SWIFT)', time: '2–5 business days', fee: 'Free' },
  bank_local: { label: 'Bank transfer (local rails)', time: 'Same day – 24 hours', fee: 'Free' },
  mpesa: { label: 'M-Pesa', time: 'Within 24 hours', fee: 'Free' },
  mtn_momo: { label: 'MTN MoMo', time: 'Within 24 hours', fee: 'Free' },
  airtel_money: { label: 'Airtel Money', time: 'Within 24 hours', fee: 'Free' },
  wise: { label: 'Wise', time: 'Same day', fee: 'Free' },
  payoneer: { label: 'Payoneer', time: 'Within 24 hours', fee: 'Free' },
  paypal: { label: 'PayPal', time: 'Within 24 hours', fee: '0.5% fee (PayPal-imposed)' },
} as const;

export const HOLD_REASON_LABELS: Record<string, { label: string; desc: string }> = {
  FRAUD_REVIEW: { label: 'Fraud review', desc: 'Booking flagged by our risk engine and pending manual review.' },
  DISPUTE_PENDING: { label: 'Dispute pending', desc: 'Guest opened a dispute. Resolution in progress.' },
  BANK_VERIFICATION: { label: 'Bank verification', desc: 'Your payout account requires verification.' },
  SANCTIONS_CHECK: { label: 'Sanctions check', desc: 'Compliance screening in progress.' },
  CHARGEBACK_REVIEW: { label: 'Chargeback review', desc: 'Card issuer chargeback being contested by Hostiva.' },
};