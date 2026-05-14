import { describe, it, expect } from 'vitest';

// Single source of truth for "this booking blocks the calendar". The
// PropertyDetail page, the modify-booking dialog, and the
// `get_property_blocked_dates` RPC must all agree on this list, otherwise
// guests see open dates the server then rejects (or worse — a double
// booking sneaks through because two clients raced and only one status
// was being checked).
export const ACTIVE_BLOCKING_STATUSES = [
  'confirmed',
  'in_progress',
  'pending_host_approval',
] as const;

describe('booking conflict statuses', () => {
  it('includes confirmed, in_progress, and pending_host_approval', () => {
    expect(ACTIVE_BLOCKING_STATUSES).toContain('confirmed');
    expect(ACTIVE_BLOCKING_STATUSES).toContain('in_progress');
    expect(ACTIVE_BLOCKING_STATUSES).toContain('pending_host_approval');
  });

  it('does NOT include pending (awaiting payment) — those expire and free up dates', () => {
    expect(ACTIVE_BLOCKING_STATUSES).not.toContain('pending');
  });

  it('does NOT include cancelled / rejected / expired', () => {
    expect(ACTIVE_BLOCKING_STATUSES).not.toContain('cancelled');
    expect(ACTIVE_BLOCKING_STATUSES).not.toContain('rejected');
    expect(ACTIVE_BLOCKING_STATUSES).not.toContain('expired');
  });
});
