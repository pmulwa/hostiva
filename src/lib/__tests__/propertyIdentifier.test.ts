import { describe, it, expect } from 'vitest';
import { buildPropertyIdentifierMap } from '../propertyIdentifier';

describe('buildPropertyIdentifierMap', () => {
  it('assigns sequential L_NNN ids per host in listing order', () => {
    const map = buildPropertyIdentifierMap([
      { id: 'b', host_id: 'h1', created_at: '2025-02-01T00:00:00Z' },
      { id: 'a', host_id: 'h1', created_at: '2025-01-01T00:00:00Z' },
      { id: 'c', host_id: 'h1', created_at: '2025-03-01T00:00:00Z' },
    ]);
    expect(map.get('a')).toBe('L_001');
    expect(map.get('b')).toBe('L_002');
    expect(map.get('c')).toBe('L_003');
  });

  it('numbers each host independently', () => {
    const map = buildPropertyIdentifierMap([
      { id: 'h1-first', host_id: 'h1', created_at: '2025-01-01T00:00:00Z' },
      { id: 'h2-first', host_id: 'h2', created_at: '2025-01-05T00:00:00Z' },
      { id: 'h1-second', host_id: 'h1', created_at: '2025-02-01T00:00:00Z' },
    ]);
    expect(map.get('h1-first')).toBe('L_001');
    expect(map.get('h1-second')).toBe('L_002');
    expect(map.get('h2-first')).toBe('L_001');
  });

  it('zero-pads to three digits', () => {
    const props = Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`,
      host_id: 'h1',
      created_at: new Date(2025, 0, i + 1).toISOString(),
    }));
    const map = buildPropertyIdentifierMap(props);
    expect(map.get('p0')).toBe('L_001');
    expect(map.get('p9')).toBe('L_010');
    expect(map.get('p11')).toBe('L_012');
  });
});