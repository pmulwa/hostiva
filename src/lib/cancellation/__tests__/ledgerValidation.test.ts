import { describe, it, expect } from 'vitest';
import { validateBookingLedger, validateCancellationPolicy } from '../ledgerValidation';
import { DEFAULT_CANCELLATION_POLICY } from '@/hooks/useCancellationPolicy';

describe('validateBookingLedger', () => {
  const valid = {
    nightly_rate: 100,
    num_nights: 5,
    total_price: 640,
    check_in_date: '2026-01-20',
  };

  it('passes a fully populated booking', () => {
    const r = validateBookingLedger(valid);
    expect(r.valid).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('rejects null booking', () => {
    const r = validateBookingLedger(null);
    expect(r.valid).toBe(false);
    expect(r.issues.length).toBeGreaterThan(0);
  });

  it.each([
    ['nightly_rate', { ...valid, nightly_rate: null }],
    ['nightly_rate', { ...valid, nightly_rate: 0 }],
    ['num_nights', { ...valid, num_nights: null }],
    ['num_nights', { ...valid, num_nights: -1 }],
    ['total_price', { ...valid, total_price: null }],
    ['total_price', { ...valid, total_price: 'abc' as any }],
    ['check_in_date', { ...valid, check_in_date: null }],
    ['check_in_date', { ...valid, check_in_date: '' }],
  ])('flags missing/invalid %s', (field, booking) => {
    const r = validateBookingLedger(booking as any);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.field === field)).toBe(true);
  });

  it('reports multiple issues at once', () => {
    const r = validateBookingLedger({ nightly_rate: 0, num_nights: 0, total_price: 0, check_in_date: '' });
    expect(r.issues.length).toBe(4);
  });
});

describe('validateCancellationPolicy', () => {
  it('accepts the default policy', () => {
    const r = validateCancellationPolicy(DEFAULT_CANCELLATION_POLICY as unknown as Record<string, unknown>);
    expect(r.valid).toBe(true);
  });

  it('rejects out-of-range percentages', () => {
    const bad = { ...DEFAULT_CANCELLATION_POLICY, tier3_cash_refund_pct: 150 };
    const r = validateCancellationPolicy(bad as unknown as Record<string, unknown>);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.field === 'tier3_cash_refund_pct')).toBe(true);
  });

  it('rejects negative percentages', () => {
    const bad = { ...DEFAULT_CANCELLATION_POLICY, tier4_cash_refund_pct: -10 };
    const r = validateCancellationPolicy(bad as unknown as Record<string, unknown>);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.field === 'tier4_cash_refund_pct')).toBe(true);
  });

  it('rejects negative host fines', () => {
    const bad = { ...DEFAULT_CANCELLATION_POLICY, host_cancel_fine_under_24h: -5 };
    const r = validateCancellationPolicy(bad as unknown as Record<string, unknown>);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.field === 'host_cancel_fine_under_24h')).toBe(true);
  });
});