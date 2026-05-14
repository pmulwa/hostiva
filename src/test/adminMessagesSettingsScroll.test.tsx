import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { shouldShowScrollDown } from '@/lib/scrollOverflow';

/**
 * Integration-ish test for the AdminMessages "Settings" dialog scroll
 * affordance. We don't render the full AdminMessages page (it depends on
 * Supabase, auth, router, etc.) — instead we mount a minimal harness that
 * uses the EXACT same effect shape as AdminMessages.tsx so a regression in
 * the visibility logic surfaces here.
 *
 * What we guard:
 *   1. Clicking the trigger opens the popup.
 *   2. When the templates content overflows the viewport, the floating
 *      "More messages" scroll-down button appears (user must scroll to see
 *      every lifecycle template).
 *   3. Once the user scrolls to the bottom, the button hides.
 */

function SettingsHarness({ contentHeight }: { contentHeight: number }) {
  const [open, setOpen] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setShowScrollDown(false);
      return;
    }
    const vp = ref.current;
    if (!vp) return;
    const update = () => {
      setShowScrollDown(
        shouldShowScrollDown(vp.scrollHeight, vp.clientHeight, vp.scrollTop),
      );
    };
    update();
    vp.addEventListener('scroll', update);
    return () => vp.removeEventListener('scroll', update);
  }, [open]);

  return (
    <div>
      <button onClick={() => setOpen(true)}>Settings</button>
      {open && (
        <div role="dialog" aria-label="Messages settings">
          <div
            data-testid="settings-scroll"
            ref={ref}
            style={{ height: 400, overflowY: 'auto' }}
          >
            <div data-testid="settings-content" style={{ height: contentHeight }}>
              <p>Booking confirmed template</p>
              <p>Check-in reminder template</p>
              <p>Check-out reminder template</p>
              <p>Review request template</p>
              <p>Cancellation template</p>
            </div>
          </div>
          {showScrollDown && (
            <button data-testid="more-messages">More messages</button>
          )}
        </div>
      )}
    </div>
  );
}

/** jsdom doesn't lay out scroll dimensions — stub them per element. */
function stubScrollMetrics(
  el: HTMLElement,
  { scrollHeight, clientHeight }: { scrollHeight: number; clientHeight: number },
) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight });
}

describe('AdminMessages settings dialog — scroll affordance', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the templates popup when the Settings trigger is clicked', () => {
    render(<SettingsHarness contentHeight={300} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByText('Settings'));
    expect(screen.getByRole('dialog', { name: /messages settings/i })).toBeInTheDocument();
  });

  it('shows the "More messages" button when templates overflow the viewport', () => {
    render(<SettingsHarness contentHeight={1500} />);
    fireEvent.click(screen.getByText('Settings'));
    const vp = screen.getByTestId('settings-scroll');
    stubScrollMetrics(vp, { scrollHeight: 1500, clientHeight: 400 });
    // Trigger the effect's update() by firing scroll
    act(() => {
      vp.scrollTop = 0;
      vp.dispatchEvent(new Event('scroll'));
    });
    expect(screen.getByTestId('more-messages')).toBeInTheDocument();
  });

  it('hides the button after scrolling to the bottom of the templates', () => {
    render(<SettingsHarness contentHeight={1500} />);
    fireEvent.click(screen.getByText('Settings'));
    const vp = screen.getByTestId('settings-scroll');
    stubScrollMetrics(vp, { scrollHeight: 1500, clientHeight: 400 });
    act(() => {
      vp.scrollTop = 0;
      vp.dispatchEvent(new Event('scroll'));
    });
    expect(screen.queryByTestId('more-messages')).toBeInTheDocument();
    // Scroll to the bottom (1500 - 400 = 1100)
    act(() => {
      vp.scrollTop = 1100;
      vp.dispatchEvent(new Event('scroll'));
    });
    expect(screen.queryByTestId('more-messages')).toBeNull();
  });

  it('does not show the button when content fits the viewport', () => {
    render(<SettingsHarness contentHeight={300} />);
    fireEvent.click(screen.getByText('Settings'));
    const vp = screen.getByTestId('settings-scroll');
    stubScrollMetrics(vp, { scrollHeight: 300, clientHeight: 400 });
    act(() => {
      vp.dispatchEvent(new Event('scroll'));
    });
    expect(screen.queryByTestId('more-messages')).toBeNull();
  });
});