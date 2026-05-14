import { describe, it, expect } from 'vitest';
import {
  renderTemplate,
  effectiveTemplate,
  DEFAULT_TEMPLATES,
  ALL_AUTO_META,
} from '@/lib/autoMessageTemplates';

/**
 * Each automated message has a built-in template the cron and edge functions
 * substitute into. These tests guarantee that:
 *   • Every catalog entry exposes a template.
 *   • {code}, {title}, {maps} substitute correctly when present.
 *   • Unknown placeholders are left untouched (visible to admins).
 *   • Admin overrides in platform_settings.auto_message_templates win over
 *     defaults; empty/whitespace overrides fall back to the default.
 */

const SAMPLE = {
  code: 'HTL-B5A11B48',
  title: 'Cozy Stay',
  maps: 'https://www.google.com/maps?q=1.23,4.56',
  check_in: '2026-05-10',
  check_out: '2026-05-15',
  guests: '1 guest',
  initiator: 'host',
};

describe('renderTemplate', () => {
  it('substitutes {code}, {title}, and {maps} placeholders', () => {
    const out = renderTemplate(
      'Booking {code}. Stay at {title}. Map: {maps}',
      SAMPLE,
    );
    expect(out).toBe(
      'Booking HTL-B5A11B48. Stay at Cozy Stay. Map: https://www.google.com/maps?q=1.23,4.56',
    );
  });

  it('leaves unknown placeholders untouched', () => {
    const out = renderTemplate('Hi {code} — {unknown}', SAMPLE);
    expect(out).toBe('Hi HTL-B5A11B48 — {unknown}');
  });

  it('leaves placeholder in place when value is null/empty', () => {
    const out = renderTemplate('Code {code}, title {title}', { code: 'X', title: '' });
    expect(out).toBe('Code X, title {title}');
  });

  it('replaces all occurrences of the same placeholder', () => {
    const out = renderTemplate('{code}/{code}', SAMPLE);
    expect(out).toBe('HTL-B5A11B48/HTL-B5A11B48');
  });

  it('renders ISO check-in / check-out dates verbatim', () => {
    const out = renderTemplate(
      'Stay: {check_in} → {check_out}',
      SAMPLE,
    );
    expect(out).toBe('Stay: 2026-05-10 → 2026-05-15');
  });

  it('renders numeric placeholder values as strings', () => {
    const out = renderTemplate('{guests} confirmed', { guests: 3 });
    expect(out).toBe('3 confirmed');
  });

  it('renders all placeholders together with no leftovers', () => {
    const out = renderTemplate(
      '{code} | {title} | {check_in} | {check_out} | {guests} | {maps} | {initiator}',
      SAMPLE,
    );
    expect(out).not.toMatch(/\{[a-z_]+\}/);
    expect(out).toContain('HTL-B5A11B48');
    expect(out).toContain('Cozy Stay');
    expect(out).toContain('2026-05-10');
    expect(out).toContain('2026-05-15');
    expect(out).toContain('1 guest');
    expect(out).toContain('host');
  });
});

describe('default templates', () => {
  it('every catalog entry has a non-empty default template', () => {
    for (const m of ALL_AUTO_META) {
      expect(DEFAULT_TEMPLATES[m.key]).toBeTruthy();
      expect(DEFAULT_TEMPLATES[m.key].length).toBeGreaterThan(10);
    }
  });

  it('pre_24h default uses {code}, {title} and {maps}', () => {
    const tpl = DEFAULT_TEMPLATES.pre_24h;
    expect(tpl).toContain('{code}');
    expect(tpl).toContain('{title}');
    expect(tpl).toContain('{maps}');
    const rendered = renderTemplate(tpl, SAMPLE);
    expect(rendered).toContain('HTL-B5A11B48');
    expect(rendered).toContain('Cozy Stay');
    expect(rendered).toContain('https://www.google.com/maps?q=1.23,4.56');
    // No leftover placeholders for the keys we provided.
    expect(rendered).not.toMatch(/\{code\}|\{title\}|\{maps\}/);
  });

  it('booking_confirmed default renders the canonical guest → host text', () => {
    const out = renderTemplate(DEFAULT_TEMPLATES.booking_confirmed, SAMPLE);
    expect(out).toContain('🎉 Booking HTL-B5A11B48 has been confirmed');
    expect(out).toContain('Cozy Stay');
    expect(out).toContain('2026-05-10');
    expect(out).toContain('2026-05-15');
    expect(out).toContain('1 guest');
  });

  it('booking_cancelled default renders the {initiator} placeholder', () => {
    const out = renderTemplate(DEFAULT_TEMPLATES.booking_cancelled, SAMPLE);
    expect(out).toContain('cancelled by the host');
    expect(out).toContain('HTL-B5A11B48');
  });

  it('post_review_guest default contains /bookings link copy', () => {
    const out = renderTemplate(DEFAULT_TEMPLATES.post_review_guest, SAMPLE);
    expect(out).toContain('/bookings');
    expect(out).toContain('Cozy Stay');
  });
});

describe('effectiveTemplate', () => {
  it('returns the override when provided', () => {
    const tpl = effectiveTemplate('pre_24h', { pre_24h: 'Custom {code}' });
    expect(tpl).toBe('Custom {code}');
  });

  it('falls back to default when override is missing', () => {
    const tpl = effectiveTemplate('pre_24h', null);
    expect(tpl).toBe(DEFAULT_TEMPLATES.pre_24h);
  });

  it('falls back to default when override is empty/whitespace', () => {
    expect(effectiveTemplate('pre_24h', { pre_24h: '' })).toBe(DEFAULT_TEMPLATES.pre_24h);
    expect(effectiveTemplate('pre_24h', { pre_24h: '   ' })).toBe(DEFAULT_TEMPLATES.pre_24h);
  });

  it('end-to-end: admin overrides booking_cancelled, render uses it', () => {
    const overrides = {
      booking_cancelled: 'CANCELLED {code} by {initiator} ({check_in}→{check_out})',
    };
    const out = renderTemplate(
      effectiveTemplate('booking_cancelled', overrides),
      SAMPLE,
    );
    expect(out).toBe('CANCELLED HTL-B5A11B48 by host (2026-05-10→2026-05-15)');
  });
});