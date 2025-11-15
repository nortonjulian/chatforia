/**
 * @jest-environment node
 */
import { newRawToken, hashToken, verifyHash } from '../tokens.js';

describe('tokens utils', () => {
  test('newRawToken returns hex string of expected length', () => {
    const t1 = newRawToken();        // default 32 bytes -> 64 hex chars
    const t2 = newRawToken(16);      // 16 bytes -> 32 hex chars

    expect(typeof t1).toBe('string');
    expect(typeof t2).toBe('string');

    expect(t1).toHaveLength(64);
    expect(t2).toHaveLength(32);

    // basic hex check
    expect(/^[0-9a-f]+$/i.test(t1)).toBe(true);
    expect(/^[0-9a-f]+$/i.test(t2)).toBe(true);

    // should be random (not equal most of the time)
    expect(t1).not.toBe(t2);
  });

  test('hashToken produces deterministic SHA-256 hex', async () => {
    const token = 'example-token';
    const h1 = await hashToken(token);
    const h2 = await hashToken(token);

    expect(h1).toHaveLength(64); // sha256 hex
    expect(/^[0-9a-f]+$/i.test(h1)).toBe(true);
    expect(h1).toBe(h2);         // deterministic
  });

  test('verifyHash returns true for matching token/hash and false otherwise', async () => {
    const token = 'secret123';
    const hash = await hashToken(token);

    // positive case
    await expect(verifyHash(token, hash)).resolves.toBe(true);

    // wrong token
    await expect(verifyHash('wrong-secret', hash)).resolves.toBe(false);

    // mismatched length should early-return false
    await expect(verifyHash(token, hash + '00')).resolves.toBe(false);
  });
});
