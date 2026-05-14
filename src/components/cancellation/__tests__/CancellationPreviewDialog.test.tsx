import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CancellationPreviewDialog } from '../CancellationPreviewDialog';
import { calculateCancellationOutcome, type CancellationInput } from '@/lib/cancellation/engine';

// Base booking — 5 nights × $100 + $50 cleaning + $60 service + $30 taxes + $26 processing
// Total paid = 640 (per engine test fixture)
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

function tier3Input(): CancellationInput {
  // 5 days before check-in → Tier 3
  return {
    ...base,
    checkInAt: new Date('2026-01-20T15:00:00Z'),
    cancelledAt: new Date('2026-01-15T15:00:00Z'),
  } as CancellationInput;
}

function tier4Input(): CancellationInput {
  // 36h before check-in → Tier 4
  return {
    ...base,
    checkInAt: new Date('2026-01-20T15:00:00Z'),
    cancelledAt: new Date('2026-01-19T03:00:00Z'),
  } as CancellationInput;
}

function getCashRefundAmount(): string {
  // Find the "Cash refund to your card" row and return its sibling money value
  const label = screen.getByText(/cash refund to your card/i);
  const row = label.parentElement!;
  const amount = within(row).getByText(/^\$/);
  return amount.textContent ?? '';
}

describe('CancellationPreviewDialog — true refund matches engine (cash only)', () => {
  it('Tier 3: shows engine-computed cash refund and zero credit', () => {
    const input = tier3Input();
    const expected = calculateCancellationOutcome({ ...input, chosenOption: 'cash' });

    render(
      <CancellationPreviewDialog
        open
        onOpenChange={() => {}}
        input={input}
        currency="USD"
        onConfirm={vi.fn()}
        originalTotalPaid={640}
      />
    );

    // Tier label visible
    expect(screen.getByText(/standard/i)).toBeInTheDocument();
    // Engine outcome must be cash-only
    expect(expected.guestCredit).toBe(0);
    expect(expected.guestRefund).toBeGreaterThan(0);
    // No "Rebooking credit" row should be rendered
    expect(screen.queryByText(/rebooking credit/i)).not.toBeInTheDocument();
    // Displayed cash refund matches engine output (formatted as money)
    const displayed = getCashRefundAmount().replace(/[^0-9.]/g, '');
    expect(Number(displayed)).toBeCloseTo(expected.guestRefund, 2);
  });

  it('Tier 4: shows engine-computed cash refund and zero credit', () => {
    const input = tier4Input();
    const expected = calculateCancellationOutcome({ ...input, chosenOption: 'cash' });

    render(
      <CancellationPreviewDialog
        open
        onOpenChange={() => {}}
        input={input}
        currency="USD"
        onConfirm={vi.fn()}
        originalTotalPaid={640}
      />
    );

    expect(screen.getByText(/late/i)).toBeInTheDocument();
    expect(expected.guestCredit).toBe(0);
    expect(screen.queryByText(/rebooking credit/i)).not.toBeInTheDocument();

    const displayed = getCashRefundAmount().replace(/[^0-9.]/g, '');
    expect(Number(displayed)).toBeCloseTo(expected.guestRefund, 2);
  });

  it('Tier 3: "Total value returned to you" equals cash refund (no hidden credit)', () => {
    const input = tier3Input();
    const expected = calculateCancellationOutcome({ ...input, chosenOption: 'cash' });

    render(
      <CancellationPreviewDialog
        open
        onOpenChange={() => {}}
        input={input}
        currency="USD"
        onConfirm={vi.fn()}
        originalTotalPaid={640}
      />
    );

    const totalRow = screen.getByText(/total value returned to you/i).parentElement!;
    const totalDisplayed = within(totalRow).getByText(/^\$/).textContent ?? '';
    const totalValue = Number(totalDisplayed.replace(/[^0-9.]/g, ''));
    expect(totalValue).toBeCloseTo(expected.guestRefund, 2);
  });

  it('non-refundable portion = totalPaid − cash refund', () => {
    const input = tier4Input();
    const expected = calculateCancellationOutcome({ ...input, chosenOption: 'cash' });
    const totalPaid = 640;

    render(
      <CancellationPreviewDialog
        open
        onOpenChange={() => {}}
        input={input}
        currency="USD"
        onConfirm={vi.fn()}
        originalTotalPaid={totalPaid}
      />
    );

    const row = screen.getByText(/non-refundable portion/i).parentElement!;
    const displayed = Number((within(row).getByText(/^\$/).textContent ?? '').replace(/[^0-9.]/g, ''));
    expect(displayed).toBeCloseTo(totalPaid - expected.guestRefund, 2);
  });
});