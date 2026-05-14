import { describe, it, expect } from 'vitest';
import {
  calculateCancellationOutcome,
  assertValidCancellationInput,
  CancellationInputError,
  type CancellationInput,
} from '../engine';
import { DEFAULT_POLICY } from '../engine';

const base = {
  nightlyRate: 100,
  totalNights: 5,
  cleaningFee: 50,
  serviceFee: 60,
  processingFee: 26,
  taxes: 30,
  initiatedBy: 'guest' as const,
  bookingCreatedAt: new Date('2026-01-01T10:00:00Z'),
};

describe('cancellation engine', () => {
  it('Tier 1 — grace period: full refund, only processing fee retained', () => {
    const out = calculateCancellationOutcome({
      ...base,
      checkInAt: new Date('2026-01-15T15:00:00Z'),
      cancelledAt: new Date('2026-01-01T15:00:00Z'), // <24h after booking, 14 days out
    } as CancellationInput);
    expect(out.tier).toBe('tier1_grace');
    expect(out.guestRefund).toBe(640); // 500 + 50 + 30 + 60
    expect(out.hostlyKeeps).toBe(26);
    expect(out.hostPayout).toBe(0);
  });

  it('Tier 2 — 7+ days out: full refund', () => {
    const out = calculateCancellationOutcome({
      ...base,
      checkInAt: new Date('2026-01-20T15:00:00Z'),
      cancelledAt: new Date('2026-01-05T15:00:00Z'), // 15 days out, >24h after booking
    } as CancellationInput);
    expect(out.tier).toBe('tier2_early');
    expect(out.guestRefund).toBe(640);
  });

  it('Tier 3 — 5 days out, cash: 65% accommodation refund, service fee NOT refunded', () => {
    const out = calculateCancellationOutcome({
      ...base,
      chosenOption: 'cash',
      checkInAt: new Date('2026-01-20T15:00:00Z'),
      cancelledAt: new Date('2026-01-15T15:00:00Z'),
    } as CancellationInput);
    expect(out.tier).toBe('tier3_standard');
    // 325 (65% of 500) + 50 cleaning + 30 taxes (no service fee refund)
    expect(out.guestRefund).toBe(405);
    expect(out.hostPayout).toBe(150);  // 30% of 500
    expect(out.serviceFeeRefunded).toBe(false);
  });

  it('Tier 4 — 48h out, cash: 40% accommodation refund', () => {
    const out = calculateCancellationOutcome({
      ...base,
      chosenOption: 'cash',
      checkInAt: new Date('2026-01-10T15:00:00Z'),
      cancelledAt: new Date('2026-01-08T15:00:00Z'),
    } as CancellationInput);
    expect(out.tier).toBe('tier4_late');
    expect(out.guestRefund).toBe(280); // 200 + 50 + 30
    expect(out.hostPayout).toBe(300);  // 60% of 500
  });

  it('Tier 5 — same day, not cleaned: refund 4 nights + cleaning + tax', () => {
    const out = calculateCancellationOutcome({
      ...base,
      cleaningPerformed: false,
      checkInAt: new Date('2026-01-10T15:00:00Z'),
      cancelledAt: new Date('2026-01-10T09:00:00Z'),
    } as CancellationInput);
    expect(out.tier).toBe('tier5_same_day');
    // 400 + 50 + (30 * 4/5 = 24) = 474
    expect(out.guestRefund).toBe(474);
    // host: 1 night + service fee = 100 + 60 = 160
    expect(out.hostPayout).toBe(160);
  });

  it('Tier 5 — same day, already cleaned: cleaning forfeited to host', () => {
    const out = calculateCancellationOutcome({
      ...base,
      cleaningPerformed: true,
      checkInAt: new Date('2026-01-10T15:00:00Z'),
      cancelledAt: new Date('2026-01-10T09:00:00Z'),
    } as CancellationInput);
    expect(out.tier).toBe('tier5_same_day');
    // 400 + 24 (no cleaning refund) = 424
    expect(out.guestRefund).toBe(424);
    // host: 100 + 60 + 50 = 210
    expect(out.hostPayout).toBe(210);
  });

  it('Tier 6 — no-show (multi-night, not cleaned): host gets 1 night + service, guest refunded remaining nights + prorated taxes + cleaning', () => {
    const out = calculateCancellationOutcome({
      ...base,
      reason: 'no_show',
      checkInAt: new Date('2026-01-10T15:00:00Z'),
      cancelledAt: new Date('2026-01-11T20:00:00Z'),
    } as CancellationInput);
    expect(out.tier).toBe('tier6_no_show');
    // 4 unused nights: 400 + prorated tax (30*4/5=24) + cleaning 50 = 474
    expect(out.guestRefund).toBe(474);
    // host: 1 night (100) + service (60) = 160 (no cleaning since not performed)
    expect(out.hostPayout).toBe(160);
    expect(out.guestCredit).toBe(0);
  });

  it('Tier 6 — no-show (multi-night, cleaned): host also gets cleaning fee, guest cleaning forfeited', () => {
    const out = calculateCancellationOutcome({
      ...base,
      reason: 'no_show',
      cleaningPerformed: true,
      checkInAt: new Date('2026-01-10T15:00:00Z'),
      cancelledAt: new Date('2026-01-11T20:00:00Z'),
    } as CancellationInput);
    expect(out.tier).toBe('tier6_no_show');
    // 4 unused nights + tax (no cleaning refund) = 400 + 24 = 424
    expect(out.guestRefund).toBe(424);
    // host: 100 + 60 + 50 = 210
    expect(out.hostPayout).toBe(210);
  });

  it('Tier 6 — no-show (single-night booking, not cleaned): only cleaning refunded, host keeps night + service', () => {
    const out = calculateCancellationOutcome({
      ...base,
      totalNights: 1,
      reason: 'no_show',
      checkInAt: new Date('2026-01-10T15:00:00Z'),
      cancelledAt: new Date('2026-01-11T20:00:00Z'),
    } as CancellationInput);
    expect(out.tier).toBe('tier6_no_show');
    // 0 refundable nights, but cleaning fee 50 refunded since not performed
    expect(out.guestRefund).toBe(50);
    // host: 100 (1 night) + 60 service = 160
    expect(out.hostPayout).toBe(160);
  });

  it('Tier 7 — mid-stay after 3 nights of 7: host charged 4, refund 2 nights (3 unused minus 1)', () => {
    const out = calculateCancellationOutcome({
      nightlyRate: 100, totalNights: 7, cleaningFee: 50, serviceFee: 60,
      processingFee: 20, taxes: 0, initiatedBy: 'guest',
      checkInAt: new Date('2026-01-10T15:00:00Z'),
      actualCheckInAt: new Date('2026-01-10T15:00:00Z'),
      cancelledAt: new Date('2026-01-13T20:00:00Z'),
    } as CancellationInput);
    expect(out.tier).toBe('tier7_mid_stay');
    // 3 unused nights − 1 deduction = 2 refundable nights × $100 = 200
    expect(out.guestRefund).toBe(200);
    // Host: 4 nights (3 stayed + 1 buffer) × 100 + cleaning 50 = 450 (service fee retained by Hostiva)
    expect(out.hostPayout).toBe(450);
    expect(out.guestCredit).toBe(0);
    expect(out.serviceFeeRefunded).toBe(false);
  });

  it('Tier 7 — rebook bonus credit removed: guestCredit always 0 even if rebookedNightsAfterCancel set', () => {
    const out = calculateCancellationOutcome({
      nightlyRate: 100, totalNights: 7, cleaningFee: 50, serviceFee: 60,
      processingFee: 20, taxes: 0, initiatedBy: 'guest',
      rebookedNightsAfterCancel: 2,
      checkInAt: new Date('2026-01-10T15:00:00Z'),
      actualCheckInAt: new Date('2026-01-10T15:00:00Z'),
      cancelledAt: new Date('2026-01-13T20:00:00Z'),
    } as CancellationInput);
    expect(out.tier).toBe('tier7_mid_stay');
    expect(out.guestCredit).toBe(0);
    expect(out.breakdown.some(b => b.kind === 'credit')).toBe(false);
  });

  it('Tier 11 — eviction: zero refund, host gets full + claim damages', () => {
    const out = calculateCancellationOutcome({
      ...base,
      reason: 'eviction',
      initiatedBy: 'host',
      checkInAt: new Date('2026-01-10T15:00:00Z'),
      actualCheckInAt: new Date('2026-01-10T15:00:00Z'),
      cancelledAt: new Date('2026-01-12T20:00:00Z'),
    } as CancellationInput);
    expect(out.tier).toBe('tier11_eviction');
    expect(out.guestRefund).toBe(0);
    expect(out.hostPayout).toBe(610); // 500 + 50 + 60
  });

  it('Host cancels >30 days out → Tier 12, $50 credit absorbed by Hostiva', () => {
    const out = calculateCancellationOutcome({
      ...base,
      initiatedBy: 'host',
      checkInAt: new Date('2026-03-01T15:00:00Z'),
      cancelledAt: new Date('2026-01-15T15:00:00Z'),
    } as CancellationInput);
    expect(out.tier).toBe('tier12_host_30plus');
    expect(out.guestRefund).toBe(640);
    expect(out.hostPenalty).toBe(0);
    expect(out.guestCredit).toBe(50);
  });

  it('Host cancels <24h → Tier 15 with $300 fine', () => {
    const out = calculateCancellationOutcome({
      ...base,
      initiatedBy: 'host',
      checkInAt: new Date('2026-01-15T15:00:00Z'),
      cancelledAt: new Date('2026-01-15T05:00:00Z'),
    } as CancellationInput);
    expect(out.tier).toBe('tier15_host_under_24h');
    expect(out.hostPenalty).toBe(300);
  });

  it('Goodwill full refund — service fee is NEVER refunded', () => {
    const out = calculateCancellationOutcome({
      ...base,
      initiatedBy: 'host',
      reason: 'goodwill',
      checkInAt: new Date('2026-01-10T15:00:00Z'),
      cancelledAt: new Date('2026-01-09T15:00:00Z'),
    } as CancellationInput);
    expect(out.tier).toBe('goodwill_full_refund');
    expect(out.guestRefund).toBe(580); // 500 + 50 + 30 (no service fee)
    expect(out.serviceFeeRefunded).toBe(false);
    expect(out.hostlyKeeps).toBe(86); // 60 service + 26 processing
  });
});

// ---------- Tier 3 & Tier 4: credit option fully removed ----------
describe('Tier 3 / Tier 4 — credit option removed', () => {
  const t3Input = (chosenOption?: 'cash' | 'credit'): CancellationInput => ({
    ...base,
    chosenOption,
    checkInAt: new Date('2026-01-20T15:00:00Z'),
    cancelledAt: new Date('2026-01-15T15:00:00Z'), // 5 days out → T3
  } as CancellationInput);

  const t4Input = (chosenOption?: 'cash' | 'credit'): CancellationInput => ({
    ...base,
    chosenOption,
    checkInAt: new Date('2026-01-10T15:00:00Z'),
    cancelledAt: new Date('2026-01-08T15:00:00Z'), // 48h out → T4
  } as CancellationInput);

  it('T3 returns cash only when no option supplied (default)', () => {
    const out = calculateCancellationOutcome(t3Input(undefined));
    expect(out.tier).toBe('tier3_standard');
    expect(out.guestCredit).toBe(0);
    expect(out.guestRefund).toBeGreaterThan(0);
  });

  it('T3 ignores chosenOption=credit and still returns cash', () => {
    const cash = calculateCancellationOutcome(t3Input('cash'));
    const credit = calculateCancellationOutcome(t3Input('credit'));
    expect(credit.guestCredit).toBe(0);
    expect(credit.guestRefund).toBe(cash.guestRefund);
    expect(credit.hostPayout).toBe(cash.hostPayout);
  });

  it('T3 breakdown contains no credit lines', () => {
    const out = calculateCancellationOutcome(t3Input('credit'));
    expect(out.breakdown.some(b => b.kind === 'credit')).toBe(false);
  });

  it('T3 notes never mention credit', () => {
    const out = calculateCancellationOutcome(t3Input('credit'));
    expect(out.notes.join(' ').toLowerCase()).not.toContain('credit');
  });

  it('T4 returns cash only when no option supplied (default)', () => {
    const out = calculateCancellationOutcome(t4Input(undefined));
    expect(out.tier).toBe('tier4_late');
    expect(out.guestCredit).toBe(0);
    expect(out.guestRefund).toBe(280); // 200 (40% of 500) + 50 + 30
  });

  it('T4 ignores chosenOption=credit and still returns cash', () => {
    const cash = calculateCancellationOutcome(t4Input('cash'));
    const credit = calculateCancellationOutcome(t4Input('credit'));
    expect(credit.guestCredit).toBe(0);
    expect(credit.guestRefund).toBe(cash.guestRefund);
  });

  it('T4 breakdown contains no credit lines', () => {
    const out = calculateCancellationOutcome(t4Input('credit'));
    expect(out.breakdown.some(b => b.kind === 'credit')).toBe(false);
  });
});

// ---------- Tier 5 — exhaustive combinations ----------
describe('Tier 5 — same-day cancellation combinations', () => {
  const sameDay = (overrides: Partial<CancellationInput>): CancellationInput => ({
    nightlyRate: 100,
    totalNights: 5,
    cleaningFee: 50,
    serviceFee: 60,
    processingFee: 26,
    taxes: 30,
    initiatedBy: 'guest',
    bookingCreatedAt: new Date('2026-01-01T10:00:00Z'),
    checkInAt: new Date('2026-01-10T15:00:00Z'),
    cancelledAt: new Date('2026-01-10T09:00:00Z'),
    ...overrides,
  } as CancellationInput);

  it('not cleaned, with taxes + service fee → refund accom + cleaning + prorated taxes', () => {
    const out = calculateCancellationOutcome(sameDay({ cleaningPerformed: false }));
    expect(out.tier).toBe('tier5_same_day');
    // 4 nights × 100 = 400, +50 cleaning, +24 prorated tax (30 × 4/5) = 474
    expect(out.guestRefund).toBe(474);
    expect(out.cleaningFeeRefunded).toBe(true);
    // host: 1 night + service fee = 100 + 60 = 160 (no cleaning, not performed)
    expect(out.hostPayout).toBe(160);
    expect(out.serviceFeeRefunded).toBe(false);
  });

  it('cleaned, with taxes + service fee → cleaning forfeited to host', () => {
    const out = calculateCancellationOutcome(sameDay({ cleaningPerformed: true }));
    expect(out.guestRefund).toBe(424); // 400 + 24 (no cleaning refund)
    expect(out.cleaningFeeRefunded).toBe(false);
    // host: 1 night + service fee + cleaning = 100 + 60 + 50 = 210
    expect(out.hostPayout).toBe(210);
  });

  it('not cleaned, no taxes, no service fee', () => {
    const out = calculateCancellationOutcome(
      sameDay({ cleaningPerformed: false, taxes: 0, serviceFee: 0 }),
    );
    expect(out.guestRefund).toBe(450); // 400 + 50 + 0
    expect(out.hostPayout).toBe(100);  // 1 night + 0 service
  });

  it('cleaned, no taxes, no service fee', () => {
    const out = calculateCancellationOutcome(
      sameDay({ cleaningPerformed: true, taxes: 0, serviceFee: 0 }),
    );
    expect(out.guestRefund).toBe(400); // accommodation only
    expect(out.hostPayout).toBe(150);  // 1 night + cleaning (no service)
  });

  it('not cleaned, no cleaning fee at all → host gets nightly + service only', () => {
    const out = calculateCancellationOutcome(
      sameDay({ cleaningPerformed: false, cleaningFee: 0 }),
    );
    expect(out.guestRefund).toBe(424); // 400 + 0 cleaning + 24 tax
    expect(out.hostPayout).toBe(160);  // 100 + 60
  });

  it('cleaned, no cleaning fee → host still receives 0 for cleaning', () => {
    const out = calculateCancellationOutcome(
      sameDay({ cleaningPerformed: true, cleaningFee: 0 }),
    );
    expect(out.guestRefund).toBe(424);
    expect(out.hostPayout).toBe(160);
  });

  it('1-night booking, not cleaned → 0 refundable nights, only cleaning + 0 tax refunded', () => {
    const out = calculateCancellationOutcome(
      sameDay({ totalNights: 1, cleaningPerformed: false }),
    );
    // refundedNights = 0, refundAccom = 0, prorated taxes = 0, cleaning = 50
    expect(out.guestRefund).toBe(50);
    expect(out.hostPayout).toBe(160); // 1 night + service
  });

  it('credit field is always 0 in Tier 5', () => {
    const a = calculateCancellationOutcome(sameDay({ cleaningPerformed: true }));
    const b = calculateCancellationOutcome(sameDay({ cleaningPerformed: false }));
    expect(a.guestCredit).toBe(0);
    expect(b.guestCredit).toBe(0);
  });

  it('processing fee is always retained, never refunded', () => {
    const out = calculateCancellationOutcome(sameDay({ cleaningPerformed: false }));
    expect(out.processingFeeRefunded).toBe(false);
    expect(out.hostlyKeeps).toBe(26);
  });
});

// ---------- Input validation ----------
describe('assertValidCancellationInput — ledger guardrails', () => {
  const valid: CancellationInput = {
    ...base,
    checkInAt: new Date('2026-01-20T15:00:00Z'),
  } as CancellationInput;

  it('accepts a fully populated input', () => {
    expect(() => assertValidCancellationInput(valid)).not.toThrow();
  });

  it('rejects missing nightlyRate', () => {
    expect(() => assertValidCancellationInput({ ...valid, nightlyRate: 0 }))
      .toThrow(CancellationInputError);
  });

  it('rejects missing totalNights', () => {
    expect(() => assertValidCancellationInput({ ...valid, totalNights: 0 }))
      .toThrow(CancellationInputError);
  });

  it('rejects missing checkInAt', () => {
    expect(() => assertValidCancellationInput({ ...valid, checkInAt: '' as any }))
      .toThrow(CancellationInputError);
  });

  it('rejects negative serviceFee', () => {
    expect(() => assertValidCancellationInput({ ...valid, serviceFee: -5 }))
      .toThrow(CancellationInputError);
  });

  it('rejects unparseable actualCheckInAt', () => {
    expect(() => assertValidCancellationInput({ ...valid, actualCheckInAt: 'not-a-date' }))
      .toThrow(CancellationInputError);
  });

  it('calculateCancellationOutcome surfaces validation errors', () => {
    expect(() => calculateCancellationOutcome({ ...valid, nightlyRate: 0 }))
      .toThrow(CancellationInputError);
  });
});

// ---------- Tier 7 admin-configurable deductions ----------
describe('Tier 7 — admin-adjustable buffer + deduction recalculate refund', () => {
  const t7Input = (): CancellationInput => ({
    nightlyRate: 100, totalNights: 7, cleaningFee: 50, serviceFee: 60,
    processingFee: 20, taxes: 0, initiatedBy: 'guest',
    checkInAt: new Date('2026-01-10T15:00:00Z'),
    actualCheckInAt: new Date('2026-01-10T15:00:00Z'),
    cancelledAt: new Date('2026-01-13T20:00:00Z'),
  } as CancellationInput);

  it('buffer=2, deduction=0 → host charged 5 nights, guest refunded 2 nights', () => {
    const policy = { ...DEFAULT_POLICY, tier7_buffer_nights: 2, tier7_refund_deduction_nights: 0 };
    const out = calculateCancellationOutcome(t7Input(), policy);
    // chargeable = stayed(3) + buffer(2) = 5; remainingUnused = 2; refundable = 2 - 0 = 2
    expect(out.guestRefund).toBe(200);
    // host: 5 × 100 + 50 cleaning = 550
    expect(out.hostPayout).toBe(550);
  });

  it('buffer=0, deduction=0 → host charged exactly nights stayed, full unused refunded', () => {
    const policy = { ...DEFAULT_POLICY, tier7_buffer_nights: 0, tier7_refund_deduction_nights: 0 };
    const out = calculateCancellationOutcome(t7Input(), policy);
    // chargeable = 3, remainingUnused = 4, refundable = 4
    expect(out.guestRefund).toBe(400);
    // host: 3 × 100 + 50 = 350
    expect(out.hostPayout).toBe(350);
  });

  it('deduction=3 → guest forfeits 3 extra unused nights, refund clamped at zero', () => {
    const policy = { ...DEFAULT_POLICY, tier7_buffer_nights: 1, tier7_refund_deduction_nights: 3 };
    const out = calculateCancellationOutcome(t7Input(), policy);
    // chargeable = 4, remainingUnused = 3, refundable = max(0, 3 - 3) = 0
    expect(out.guestRefund).toBe(0);
    expect(out.hostPayout).toBe(450); // 400 + 50
  });

  it('service fee is always retained (non-refundable) for Tier 7', () => {
    const out = calculateCancellationOutcome(t7Input());
    expect(out.serviceFeeRefunded).toBe(false);
    // hostlyKeeps = service fee (60) + processing (20) = 80
    expect(out.hostlyKeeps).toBe(80);
  });
});
