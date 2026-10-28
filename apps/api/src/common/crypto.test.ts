import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, hashCardToken, safeEqualHex, signRequest } from './crypto';

const key = Buffer.alloc(32, 7).toString('base64');

describe('crypto', () => {
  it('signs deterministically and changes with any input', () => {
    const base = signRequest('s', '1700000000', 'post', '/v1/discounts/inquire', '{"a":1}');
    expect(base).toBe(signRequest('s', '1700000000', 'POST', '/v1/discounts/inquire', '{"a":1}'));
    expect(base).not.toBe(
      signRequest('s', '1700000000', 'POST', '/v1/discounts/inquire', '{"a":2}'),
    );
    expect(base).not.toBe(
      signRequest('s', '1700000001', 'POST', '/v1/discounts/inquire', '{"a":1}'),
    );
  });

  it('compares hex in constant time and rejects malformed input', () => {
    expect(safeEqualHex('abcd', 'abcd')).toBe(true);
    expect(safeEqualHex('abcd', 'abce')).toBe(false);
    expect(safeEqualHex('', '')).toBe(false);
    expect(safeEqualHex('abcd', 'zz')).toBe(false);
  });

  it('round-trips encrypted secrets', () => {
    const enc = encryptSecret(key, 'top-secret');
    expect(enc.startsWith('v1.')).toBe(true);
    expect(decryptSecret(key, enc)).toBe('top-secret');
    expect(() => decryptSecret(Buffer.alloc(32, 8).toString('base64'), enc)).toThrow();
  });

  it('hashes card tokens with the pepper', () => {
    expect(hashCardToken('p1', 'tok')).not.toBe(hashCardToken('p2', 'tok'));
    expect(hashCardToken('p1', 'tok')).toHaveLength(64);
  });
});
