/** @jest-environment node */
import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { createAppleTokenVerifier } from '../services/appleTokenVerifier.js';

const trusted = generateKeyPairSync('rsa', { modulusLength: 2048 });
const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = {
  ...trusted.publicKey.export({ format: 'jwk' }),
  kid: 'trusted', alg: 'RS256', use: 'sig',
};
const now = 1800000000;
const audience = 'com.chatforia.Chatforia';
const base = {
  sub: 'apple-user', iss: 'https://appleid.apple.com',
  aud: audience, exp: now + 300,
};
function sign(claims = base, key = trusted.privateKey, kid = 'trusted') {
  return jwt.sign(claims, key, { algorithm: 'RS256', keyid: kid, noTimestamp: true });
}
function verifier() {
  const fetchKeys = jest.fn(async () => [jwk]);
  return {
    fetchKeys,
    verify: createAppleTokenVerifier({ fetchKeys, now: () => now * 1000 }),
  };
}

 describe('Apple identity token verification', () => {
  test('accepts a trusted signature and caches keys', async () => {
    const { verify, fetchKeys } = verifier();
    await expect(verify(sign(), { audience })).resolves.toMatchObject({ sub: base.sub });
    await verify(sign(), { audience });
    expect(fetchKeys).toHaveBeenCalledTimes(1);
  });

  test('rejects a forged signature even when claims look valid', async () => {
    await expect(verifier().verify(sign(base, attacker.privateKey), { audience }))
      .rejects.toMatchObject({ code: 'invalid_apple_token' });
  });

  test.each([
    ['wrong issuer', { ...base, iss: 'https://attacker.example' }],
    ['wrong audience', { ...base, aud: 'another-app' }],
    ['expired', { ...base, exp: now - 1 }],
    ['expiration boundary', { ...base, exp: now }],
    ['missing expiration', { sub: base.sub, iss: base.iss, aud: base.aud }],
    ['missing subject', { iss: base.iss, aud: base.aud, exp: base.exp }],
    ['not yet valid', { ...base, nbf: now + 60 }],
  ])('rejects %s', async (_name, claims) => {
    await expect(verifier().verify(sign(claims), { audience }))
      .rejects.toMatchObject({ code: 'invalid_apple_token' });
  });

  test('rejects unsigned tokens without fetching keys', async () => {
    const { verify, fetchKeys } = verifier();
    const token = jwt.sign(base, null, { algorithm: 'none' });
    await expect(verify(token, { audience }))
      .rejects.toMatchObject({ code: 'invalid_apple_token' });
    expect(fetchKeys).not.toHaveBeenCalled();
  });

  test('rejects unknown keys and does not repeatedly refresh', async () => {
    const { verify, fetchKeys } = verifier();
    for (let i = 0; i < 2; i += 1) {
      await expect(verify(sign(base, trusted.privateKey, 'unknown'), { audience }))
        .rejects.toMatchObject({ code: 'invalid_apple_token' });
    }
    expect(fetchKeys).toHaveBeenCalledTimes(1);
  });

  test('requires a configured audience', async () => {
    const { verify, fetchKeys } = verifier();
    await expect(verify(sign(), { audience: [] })).rejects.toThrow('not configured');
    expect(fetchKeys).not.toHaveBeenCalled();
  });

  test('accepts raw or hashed matching native nonce', async () => {
    const nonce = 'native-login-nonce';
    for (const claim of [nonce, createHash('sha256').update(nonce).digest('hex')]) {
      await expect(verifier().verify(sign({ ...base, nonce: claim }), { audience, nonce }))
        .resolves.toMatchObject({ sub: base.sub });
    }
  });

  test.each(['wrong-nonce', undefined])('rejects a mismatched or missing token nonce', async (claim) => {
    await expect(verifier().verify(sign({ ...base, nonce: claim }), {
      audience, nonce: 'expected-nonce',
    })).rejects.toMatchObject({ code: 'invalid_apple_token' });
  });

  test('supports signing key rotation after the refresh cooldown', async () => {
    let clock = now * 1000;
    const rotated = { ...attacker.publicKey.export({ format: 'jwk' }),
      kid: 'rotated', alg: 'RS256', use: 'sig' };
    const fetchKeys = jest.fn().mockResolvedValueOnce([jwk]).mockResolvedValueOnce([rotated]);
    const verify = createAppleTokenVerifier({ fetchKeys, now: () => clock });
    await verify(sign(), { audience });
    clock += 31000;
    await expect(verify(sign(base, attacker.privateKey, 'rotated'), { audience }))
      .resolves.toMatchObject({ sub: base.sub });
    expect(fetchKeys).toHaveBeenCalledTimes(2);
  });
});
