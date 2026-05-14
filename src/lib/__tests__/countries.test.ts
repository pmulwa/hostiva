import { describe, it, expect } from 'vitest';
import {
  applyDialCode,
  enforceDialCodePrefix,
  hasDialCodePrefix,
  getLocalNumber,
  findCountryByCode,
} from '@/lib/countries';

describe('countries — dial code helpers', () => {
  describe('applyDialCode', () => {
    it('prefixes Kenya (+254) onto an empty number with trailing space', () => {
      expect(applyDialCode('', '254')).toBe('+254 ');
    });

    it('prefixes Kenya (+254) onto a bare local number', () => {
      expect(applyDialCode('712345678', '254')).toBe('+254 712345678');
    });

    it('replaces an existing dial code (India → Kenya) and keeps the local part', () => {
      expect(applyDialCode('+91 9876543210', '254')).toBe('+254 9876543210');
    });

    it('handles dash separators between dial and local number', () => {
      expect(applyDialCode('+1-5551234', '44')).toBe('+44 5551234');
    });
  });

  describe('hasDialCodePrefix', () => {
    it('detects valid dial-code prefixes', () => {
      expect(hasDialCodePrefix('+254 712345678')).toBe(true);
      expect(hasDialCodePrefix('+91 9876543210')).toBe(true);
      expect(hasDialCodePrefix('+1-5551234')).toBe(true);
    });

    it('rejects bare local numbers and empty input', () => {
      expect(hasDialCodePrefix('712345678')).toBe(false);
      expect(hasDialCodePrefix('')).toBe(false);
      expect(hasDialCodePrefix(null)).toBe(false);
      expect(hasDialCodePrefix(undefined)).toBe(false);
    });
  });

  describe('enforceDialCodePrefix', () => {
    it('keeps the prefix intact when only the local part is edited', () => {
      expect(enforceDialCodePrefix('+254 712345678', '254')).toBe('+254 712345678');
    });

    it('restores the prefix if the user wiped it', () => {
      expect(enforceDialCodePrefix('712345678', '254')).toBe('+254 712345678');
    });

    it('swaps a stale prefix for the active country dial code', () => {
      expect(enforceDialCodePrefix('+91 712345678', '254')).toBe('+254 712345678');
    });

    it('returns "+<dial> " when the field is cleared', () => {
      expect(enforceDialCodePrefix('', '254')).toBe('+254 ');
    });
  });

  describe('getLocalNumber', () => {
    it('strips the prefix and returns just the local digits', () => {
      expect(getLocalNumber('+254 712345678')).toBe('712345678');
      expect(getLocalNumber('+91-9876543210')).toBe('9876543210');
      expect(getLocalNumber('')).toBe('');
    });
  });

  describe('findCountryByCode', () => {
    it('finds India and Kenya by ISO code', () => {
      expect(findCountryByCode('IN')?.dial).toBe('91');
      expect(findCountryByCode('KE')?.dial).toBe('254');
    });
  });
});