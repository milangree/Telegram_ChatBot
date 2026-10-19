// tests/auth.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  genToken,
  hashPw,
  verifyPw,
  validatePassword,
  validatePasswordReason,
  isLegacyPasswordHash,
  timingSafeEqualStr,
  createSession,
  getSession,
  delSession,
  extractToken,
} from '../functions/_shared/auth.js';

// Mock KV store
function createMockKV() {
  const store = new Map();
  return {
    get: vi.fn(async (key) => store.get(key) || null),
    put: vi.fn(async (key, value, opts) => {
      store.set(key, value);
      if (opts?.expirationTtl) {
        setTimeout(() => store.delete(key), opts.expirationTtl * 1000);
      }
    }),
    delete: vi.fn(async (key) => store.delete(key)),
    list: vi.fn(async () => ({ keys: [], list_complete: true })),
    _store: store,
  };
}

describe('auth.js', () => {
  describe('genToken', () => {
    it('should generate token of specified length', () => {
      const token = genToken(32);
      expect(token).toHaveLength(32);
    });

    it('should generate unique tokens', () => {
      const t1 = genToken(32);
      const t2 = genToken(32);
      expect(t1).not.toBe(t2);
    });

    it('should only contain alphanumeric characters', () => {
      const token = genToken(100);
      expect(token).toMatch(/^[A-Za-z0-9]+$/);
    });
  });

  describe('validatePassword', () => {
    it('should accept valid password', () => {
      expect(validatePassword('SecurePass123')).toBe(true);
    });

    it('should reject short password', () => {
      expect(validatePassword('Short1')).toBe(false);
    });

    it('should reject password without letters', () => {
      expect(validatePassword('1234567890')).toBe(false);
    });

    it('should reject password without numbers', () => {
      expect(validatePassword('SecurePassword')).toBe(false);
    });

    it('should reject common weak password', () => {
      expect(validatePassword('password123')).toBe(false);
    });

    it('should return reason for invalid password', () => {
      expect(validatePasswordReason('short')).toBe('min');
      expect(validatePasswordReason('1234567890')).toBe('complexity');
      expect(validatePasswordReason('password123')).toBe('common');
    });
  });

  describe('hashPw and verifyPw', () => {
    it('should hash and verify password', async () => {
      const password = 'SecurePass123';
      const hash = await hashPw(password);
      expect(await verifyPw(password, hash)).toBe(true);
      expect(await verifyPw('WrongPass123', hash)).toBe(false);
    });

    it('should generate different hashes for same password', async () => {
      const password = 'SecurePass123';
      const hash1 = await hashPw(password);
      const hash2 = await hashPw(password);
      expect(hash1).not.toBe(hash2);
    });

    it('should reject legacy hash by default', async () => {
      const legacyHash = 'salt:sha256hash';
      expect(await verifyPw('password', legacyHash)).toBe(false);
    });
  });

  describe('isLegacyPasswordHash', () => {
    it('should detect legacy hash format', () => {
      expect(isLegacyPasswordHash('salt:sha256hash')).toBe(true);
      expect(isLegacyPasswordHash('pbkdf2:100000:salt:hash')).toBe(false);
      expect(isLegacyPasswordHash('')).toBe(false);
      expect(isLegacyPasswordHash(null)).toBe(false);
    });
  });

  describe('timingSafeEqualStr', () => {
    it('should return true for equal strings', () => {
      expect(timingSafeEqualStr('abc', 'abc')).toBe(true);
    });

    it('should return false for different strings', () => {
      expect(timingSafeEqualStr('abc', 'def')).toBe(false);
    });

    it('should handle null/undefined', () => {
      expect(timingSafeEqualStr(null, null)).toBe(true);
      expect(timingSafeEqualStr(undefined, '')).toBe(true);
    });
  });

  describe('session management', () => {
    let kv;

    beforeEach(() => {
      kv = createMockKV();
    });

    it('should create and get session', async () => {
      const token = await createSession(kv, 123, 3600);
      const session = await getSession(kv, token);
      expect(session).not.toBeNull();
      expect(session.userId).toBe(123);
    });

    it('should delete session', async () => {
      const token = await createSession(kv, 123, 3600);
      await delSession(kv, token);
      const session = await getSession(kv, token);
      expect(session).toBeNull();
    });

    it('should return null for invalid token', async () => {
      const session = await getSession(kv, 'invalid-token');
      expect(session).toBeNull();
    });
  });

  describe('extractToken', () => {
    it('should extract from Authorization header', () => {
      const req = { headers: { get: (name) => name === 'Authorization' ? 'Bearer token123' : null } };
      expect(extractToken(req)).toBe('token123');
    });

    it('should extract from Cookie header', () => {
      const req = { headers: { get: (name) => name === 'Cookie' ? 'session=token456; other=value' : null } };
      expect(extractToken(req)).toBe('token456');
    });

    it('should return null when no token found', () => {
      const req = { headers: { get: () => null } };
      expect(extractToken(req)).toBeNull();
    });
  });
});
