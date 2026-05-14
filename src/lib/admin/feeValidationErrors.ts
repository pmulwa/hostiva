/**
 * Maps server-side validation error messages from `validate_platform_controls`
 * and `validate_platform_settings` triggers to the matching client-side field.
 *
 * Each Postgres error message is prefixed with a stable code in square brackets
 * (e.g. `[PT_FREE_PCT] Welcome commission must be …`). This module extracts
 * that code so the Admin Controls UI can highlight the correct input with
 * inline red text instead of just a generic toast.
 */

/** Field IDs that the Commission by Package + Fee structure UI knows how to highlight. */
export type FeeFieldId =
  | 'starter_free_pct'
  | 'starter_low_pct'
  | 'standard_pct'
  | 'starter_free_bookings'
  | 'starter_low_bookings'
  | 'service_fee_percent'
  | 'host_commission_percent'
  | 'service_tax_percent'
  | 'host_tax_percent';

/** Maps the server-side error code embedded in the message to a UI field id. */
const CODE_TO_FIELD: Record<string, FeeFieldId> = {
  PT_FREE_PCT: 'starter_free_pct',
  PT_LOW_PCT: 'starter_low_pct',
  PT_STD_PCT: 'standard_pct',
  PT_FREE_BK: 'starter_free_bookings',
  PT_LOW_BK: 'starter_low_bookings',
  PS_SVC_PCT: 'service_fee_percent',
  PS_HOST_PCT: 'host_commission_percent',
  PS_SVC_TAX: 'service_tax_percent',
  PS_HOST_TAX: 'host_tax_percent',
};

export interface ParsedFeeError {
  /** Field id to highlight, or null if the message could not be mapped. */
  field: FeeFieldId | null;
  /** Human-readable message stripped of the `[CODE]` prefix. */
  message: string;
}

/**
 * Parse a Supabase/Postgres error returned by the platform_controls or
 * platform_settings validation triggers. Falls back to the raw message when
 * the prefix is not recognised so callers can still surface it in a toast.
 */
export function parseFeeValidationError(err: { message?: string | null } | null | undefined): ParsedFeeError {
  const raw = (err?.message ?? '').trim();
  if (!raw) return { field: null, message: 'Unknown error' };

  const match = raw.match(/^\[([A-Z_]+)\]\s*(.*)$/);
  if (match) {
    const [, code, rest] = match;
    return { field: CODE_TO_FIELD[code] ?? null, message: rest || raw };
  }
  return { field: null, message: raw };
}

/**
 * Convenience: turn a server error into a `Record<field, message>` patch that
 * can be merged into the existing client-side `tierErrors` / `feeErrors` state
 * so inline red-text feedback matches what the database rejected.
 */
export function feeErrorPatch(err: { message?: string | null } | null | undefined): Partial<Record<FeeFieldId, string>> {
  const { field, message } = parseFeeValidationError(err);
  if (!field) return {};
  return { [field]: message };
}