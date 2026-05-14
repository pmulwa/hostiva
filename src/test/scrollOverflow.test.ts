import { describe, it, expect } from 'vitest';
import { shouldShowScrollDown } from '@/lib/scrollOverflow';

describe('shouldShowScrollDown', () => {
  it('hides when content fits the viewport', () => {
    expect(shouldShowScrollDown(400, 600, 0)).toBe(false);
  });

  it('shows when there is hidden content below the fold', () => {
    expect(shouldShowScrollDown(1200, 600, 0)).toBe(true);
  });

  it('shows while scrolling through the middle', () => {
    expect(shouldShowScrollDown(1200, 600, 200)).toBe(true);
  });

  it('hides once the viewer reaches the bottom', () => {
    // scrollTop = scrollHeight - clientHeight  →  remaining is 0
    expect(shouldShowScrollDown(1200, 600, 600)).toBe(false);
  });

  it('hides within the slack threshold of the bottom', () => {
    expect(shouldShowScrollDown(1200, 600, 590)).toBe(false);
  });

  it('respects a custom slack', () => {
    expect(shouldShowScrollDown(1000, 600, 350, 100)).toBe(false);
    expect(shouldShowScrollDown(1000, 600, 200, 100)).toBe(true);
  });
});