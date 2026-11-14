import { normalizeRequestedExpireSeconds } from '../messageExpirySeconds.js';

describe('message expiry request normalization', () => {
  test('leaves an omitted timer to the account default and preserves explicit Off', () => {
    expect(normalizeRequestedExpireSeconds(undefined)).toBeUndefined();
    expect(normalizeRequestedExpireSeconds(null)).toBeUndefined();
    expect(normalizeRequestedExpireSeconds(0)).toBe(0);
    expect(normalizeRequestedExpireSeconds('0')).toBe(0);
  });

  test('keeps a supported timer and clamps the request before plan enforcement', () => {
    expect(normalizeRequestedExpireSeconds(2)).toBe(5);
    expect(normalizeRequestedExpireSeconds(10)).toBe(10);
    expect(normalizeRequestedExpireSeconds(14 * 86400)).toBe(14 * 86400);
    expect(normalizeRequestedExpireSeconds(30 * 86400)).toBe(30 * 86400);
    expect(normalizeRequestedExpireSeconds(31 * 86400)).toBe(30 * 86400);
  });
});
