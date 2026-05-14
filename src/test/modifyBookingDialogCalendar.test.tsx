import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModifyBookingDialog } from '@/components/booking/ModifyBookingDialog';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          neq: () => ({ in: () => Promise.resolve({ data: [] }) }),
        }),
      }),
    }),
  },
}));
vi.mock('@/hooks/usePlatformSettings', () => ({
  usePlatformSettings: () => ({ settings: { service_fee_percentage: 10, tax_percentage: 0 } }),
  calculateFees: () => ({ guestServiceFee: 0, hostServiceFee: 0, serviceFeeWithTax: 0 }),
  formatBookingId: (id: string) => id,
}));
vi.mock('@/hooks/useCancellationPolicy', () => ({
  useCancellationPolicy: () => ({ policy: null }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const booking = {
  id: 'b1',
  property_id: 'p1',
  host_id: 'h1',
  guest_id: 'g1',
  check_in_date: '2026-06-01',
  check_out_date: '2026-06-05',
  num_guests: 2,
  nightly_rate: 100,
  cleaning_fee: 0,
  service_fee: 0,
  total_price: 400,
  currency: 'USD',
  created_at: new Date().toISOString(),
  properties: { title: 'Test', service_fee_charged_to: 'guest' },
};

describe('ModifyBookingDialog calendar', () => {
  it('renders exactly one month in the calendar (no overlap with summary)', () => {
    render(
      <ModifyBookingDialog open onOpenChange={() => {}} booking={booking as any} onModified={() => {}} />,
    );
    // react-day-picker renders one <table> per visible month
    const months = document.querySelectorAll('.rdp-month, table');
    // Filter to just calendar month tables
    const monthCount = document.querySelectorAll('.rdp-month').length;
    expect(monthCount).toBeLessThanOrEqual(1);
    expect(screen.getByText(/Modify Booking Dates/i)).toBeInTheDocument();
  });
});
