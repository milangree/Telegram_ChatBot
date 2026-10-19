// tests/bot-utils.test.js
import { describe, it, expect, vi } from 'vitest';
import {
  secureRandomInt,
  secureShuffle,
  randId,
  parseBoundedInt,
  parseStrictInt,
  parseAdminIds,
  isProtectedAdminUid,
  canUserAppeal,
  isPrivateChatId,
  hasInlineKeyboard,
  hasActionableInlineKeyboard,
  fmtUtc8,
  fmtMsgTime,
  rowsN,
} from '../functions/_shared/bot-utils.js';

describe('bot-utils.js', () => {
  describe('secureRandomInt', () => {
    it('should return 0 for max <= 1', () => {
      expect(secureRandomInt(0)).toBe(0);
      expect(secureRandomInt(1)).toBe(0);
    });

    it('should return value in range [0, max)', () => {
      for (let i = 0; i < 100; i++) {
        const n = secureRandomInt(10);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThan(10);
      }
    });
  });

  describe('secureShuffle', () => {
    it('should shuffle array', () => {
      const arr = [1, 2, 3, 4, 5];
      const shuffled = secureShuffle(arr);
      expect(shuffled).toHaveLength(5);
      expect(shuffled.sort()).toEqual([1, 2, 3, 4, 5]);
    });

    it('should not mutate original array', () => {
      const arr = [1, 2, 3];
      secureShuffle(arr);
      expect(arr).toEqual([1, 2, 3]);
    });
  });

  describe('randId', () => {
    it('should generate 24-character hex string', () => {
      const id = randId();
      expect(id).toHaveLength(24);
      expect(id).toMatch(/^[0-9a-f]+$/);
    });

    it('should generate unique IDs', () => {
      expect(randId()).not.toBe(randId());
    });
  });

  describe('parseBoundedInt', () => {
    it('should parse valid integer', () => {
      expect(parseBoundedInt('10', 0, 0, 100)).toBe(10);
    });

    it('should return fallback for invalid input', () => {
      expect(parseBoundedInt('abc', 5, 0, 100)).toBe(5);
      expect(parseBoundedInt(null, 5, 0, 100)).toBe(5);
    });

    it('should clamp to bounds', () => {
      expect(parseBoundedInt('150', 0, 0, 100)).toBe(100);
      expect(parseBoundedInt('-10', 0, 0, 100)).toBe(0);
    });
  });

  describe('parseStrictInt', () => {
    it('should parse valid integer', () => {
      expect(parseStrictInt('10')).toBe(10);
      expect(parseStrictInt('-5')).toBe(-5);
    });

    it('should return null for invalid input', () => {
      expect(parseStrictInt('abc')).toBeNull();
      expect(parseStrictInt('10.5')).toBeNull();
      expect(parseStrictInt('')).toBeNull();
      expect(parseStrictInt(null)).toBeNull();
    });
  });

  describe('parseAdminIds', () => {
    it('should parse comma-separated IDs', () => {
      expect(parseAdminIds('1,2,3')).toEqual([1, 2, 3]);
    });

    it('should handle empty string', () => {
      expect(parseAdminIds('')).toEqual([]);
      expect(parseAdminIds(null)).toEqual([]);
    });

    it('should filter invalid values', () => {
      expect(parseAdminIds('1,abc,3')).toEqual([1, 3]);
    });
  });

  describe('isProtectedAdminUid', () => {
    it('should return true for admin UID', () => {
      const settings = { ADMIN_IDS: '1,2,3' };
      expect(isProtectedAdminUid(2, settings)).toBe(true);
    });

    it('should return false for non-admin UID', () => {
      const settings = { ADMIN_IDS: '1,2,3' };
      expect(isProtectedAdminUid(999, settings)).toBe(false);
    });
  });

  describe('canUserAppeal', () => {
    it('should return true for blocked user with auto-unblock enabled', () => {
      const user = { is_blocked: true, is_permanent_block: false };
      const settings = { AUTO_UNBLOCK_ENABLED: 'true' };
      expect(canUserAppeal(user, settings)).toBe(true);
    });

    it('should return false for permanently blocked user', () => {
      const user = { is_blocked: true, is_permanent_block: true };
      const settings = { AUTO_UNBLOCK_ENABLED: 'true' };
      expect(canUserAppeal(user, settings)).toBe(false);
    });

    it('should return false when auto-unblock is disabled', () => {
      const user = { is_blocked: true, is_permanent_block: false };
      const settings = { AUTO_UNBLOCK_ENABLED: 'false' };
      expect(canUserAppeal(user, settings)).toBe(false);
    });
  });

  describe('isPrivateChatId', () => {
    it('should return true for positive numbers', () => {
      expect(isPrivateChatId(123)).toBe(true);
      expect(isPrivateChatId('456')).toBe(true);
    });

    it('should return false for negative numbers', () => {
      expect(isPrivateChatId(-1)).toBe(false);
      expect(isPrivateChatId(0)).toBe(false);
    });
  });

  describe('hasInlineKeyboard', () => {
    it('should return true for valid keyboard', () => {
      const kb = [[{ text: 'Button', callback_data: 'action' }]];
      expect(hasInlineKeyboard(kb)).toBe(true);
    });

    it('should return false for empty keyboard', () => {
      expect(hasInlineKeyboard([])).toBe(false);
      expect(hasInlineKeyboard(null)).toBe(false);
    });
  });

  describe('hasActionableInlineKeyboard', () => {
    it('should return true for keyboard with callback_data', () => {
      const kb = [[{ text: 'Button', callback_data: 'action' }]];
      expect(hasActionableInlineKeyboard(kb)).toBe(true);
    });

    it('should return true for keyboard with url', () => {
      const kb = [[{ text: 'Link', url: 'https://example.com' }]];
      expect(hasActionableInlineKeyboard(kb)).toBe(true);
    });

    it('should return false for non-actionable keyboard', () => {
      const kb = [[{ text: 'Button' }]];
      expect(hasActionableInlineKeyboard(kb)).toBe(false);
    });
  });

  describe('fmtUtc8', () => {
    it('should format timestamp to UTC+8', () => {
      const ts = '2024-01-01T00:00:00.000Z';
      const formatted = fmtUtc8(ts);
      expect(formatted).toMatch(/2024-01-01 08:00:00/);
    });

    it('should handle null/undefined', () => {
      expect(fmtUtc8(null)).toBe('');
      expect(fmtUtc8(undefined)).toBe('');
    });
  });

  describe('fmtMsgTime', () => {
    it('should format timestamp', () => {
      const ts = '2024-01-01T00:00:00.000Z';
      const formatted = fmtMsgTime(ts);
      expect(formatted).toMatch(/01-01 08:00:00/);
    });

    it('should handle null/undefined', () => {
      expect(fmtMsgTime(null)).toBe('--');
      expect(fmtMsgTime(undefined)).toBe('--');
    });
  });

  describe('rowsN', () => {
    it('should split items into rows', () => {
      const items = [1, 2, 3, 4, 5, 6];
      const rows = rowsN(items, 2, (x) => x * 2);
      expect(rows).toEqual([[2, 4], [6, 8], [10, 12]]);
    });

    it('should handle empty array', () => {
      expect(rowsN([], 2, (x) => x)).toEqual([]);
    });
  });
});
