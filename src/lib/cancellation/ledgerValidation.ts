/**
 * Booking ledger validation for cancellation flow.
 *
 * The cancellation engine requires authoritative ledger values
 * (nightly_rate, num_nights, total_price, check_in_date) to compute
 * a correct refund. If any are missing we surface a clear, user-facing
 * error instead of silently recomputing or crashing.
 */

export interface BookingLedgerLike {
  nightly_rate?: number | string | null;
  num_nights?: number | string | null;
  total_price?: number | string | null;
  check_in_date?: string | null;
}

export interface LedgerValidationIssue {
  field: 'nightly_rate' | 'num_nights' | 'total_price' | 'check_in_date';
  label: string;
  message: string;
}

export interface LedgerValidationResult {
  valid: boolean;
  issues: LedgerValidationIssue[];
}

function isPositiveNumber(value: unknown): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

export function validateBookingLedger(booking: BookingLedgerLike | null | undefined): LedgerValidationResult {
  const issues: LedgerValidationIssue[] = [];
  if (!booking) {
    return {
      valid: false,
      issues: [{ field: 'total_price', label: 'Booking', message: 'Booking record is missing.' }],
    };
  }
  if (!isPositiveNumber(booking.nightly_rate)) {
    issues.push({
      field: 'nightly_rate',
      label: 'Nightly rate',
      message: 'Nightly rate is missing or invalid on this booking.',
    });
  }
  if (!isPositiveNumber(booking.num_nights)) {
    issues.push({
      field: 'num_nights',
      label: 'Number of nights',
      message: 'Number of nights is missing or invalid on this booking.',
    });
  }
  if (!isPositiveNumber(booking.total_price)) {
    issues.push({
      field: 'total_price',
      label: 'Total price',
      message: 'Total price (ledger value) is missing on this booking.',
    });
  }
  if (!booking.check_in_date) {
    issues.push({
      field: 'check_in_date',
      label: 'Check-in date',
      message: 'Check-in date is missing on this booking.',
    });
  }
  return { valid: issues.length === 0, issues };
}

/**
 * Validation rules for the admin cancellation policy editor.
 * Each entry maps a CancellationPolicyConfig key → an error message
 * when the configured value is outside its accepted range.
 */
export interface PolicyValidationIssue {
  field: string;
  message: string;
}

const PCT_KEYS = [
  'tier3_cash_refund_pct',
  'tier3_host_comp_pct',
  'tier4_cash_refund_pct',
  'tier4_host_comp_pct',
  'tier8_unused_refund_pct',
  'tier8_stayed_refund_pct',
  'tier9_unused_refund_pct',
  'tier9_stayed_refund_pct',
] as const;

const NON_NEG_KEYS = [
  'host_cancel_fine_30plus',
  'host_cancel_fine_7_30',
  'host_cancel_fine_under_7',
  'host_cancel_fine_under_24h',
  'host_cancel_credit_30plus',
  'host_cancel_credit_7_30',
  'host_cancel_credit_under_7',
  'host_cancel_credit_under_24h',
  'tier7_buffer_nights',
  'tier7_refund_deduction_nights',
] as const;

export function validateCancellationPolicy(policy: Record<string, unknown>): { valid: boolean; issues: PolicyValidationIssue[] } {
  const issues: PolicyValidationIssue[] = [];
  for (const key of PCT_KEYS) {
    const v = Number((policy as Record<string, unknown>)[key]);
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      issues.push({ field: key, message: `${key} must be a percentage between 0 and 100.` });
    }
  }
  for (const key of NON_NEG_KEYS) {
    const v = Number((policy as Record<string, unknown>)[key]);
    if (!Number.isFinite(v) || v < 0) {
      issues.push({ field: key, message: `${key} must be a non-negative number.` });
    }
  }
  return { valid: issues.length === 0, issues };
}