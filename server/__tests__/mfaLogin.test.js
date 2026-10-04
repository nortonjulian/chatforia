/** @jest-environment node */
import { jest } from '@jest/globals';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';

process.env.JWT_SECRET = 'mfa-unit-secret';
let user, records;
const tx = {
  $queryRaw: jest.fn(async () => [{ id: 7 }]),
  user: { findUnique: jest.fn(async () => user) },
  verificationToken: {
    create: jest.fn(async ({ data }) => { const row = { id: records.length + 1, usedAt: null, ...data }; records.push(row); return row; }),
    findFirst: jest.fn(async ({ where }) => records.find((r) => r.userId === where.userId && r.tokenHash === where.tokenHash && !r.usedAt && r.expiresAt > new Date()) ?? null),
    update: jest.fn(async ({ where, data }) => Object.assign(records.find((r) => r.id === where.id), data)),
    updateMany: jest.fn(async ({ where, data }) => {
      const row = records.find((r) => r.id === where.id && !r.usedAt && r.expiresAt > new Date());
      if (!row) return { count: 0 };
      Object.assign(row, data); return { count: 1 };
    }),
  },
  twoFactorRecoveryCode: { findFirst: jest.fn(async () => null), updateMany: jest.fn(async () => ({ count: 1 })) },
};
await jest.unstable_mockModule(fileURLToPath(new URL('../utils/prismaClient.js', import.meta.url)), () => ({ default: { $transaction: (fn) => fn(tx) } }));
await jest.unstable_mockModule(fileURLToPath(new URL('../utils/secretBox.js', import.meta.url)), () => ({ open: (value) => value }));
const { createMfaChallenge, completeMfaChallenge, recoveryCodeHash } = await import('../services/mfaLogin.js');
const { startWebMfa, renderMfaPage, pendingCookieName } = await import('../services/webMfa.js');
const code = () => speakeasy.totp({ secret: user.totpSecretEnc, encoding: 'base32' });
beforeEach(() => {
  process.env.NODE_ENV = 'test';
  jest.clearAllMocks(); records = [];
  user = { id: 7, tokenVersion: 2, twoFactorEnabled: true, totpSecretEnc: 'JBSWY3DPEHPK3PXP', isBanned: false, deletedAt: null };
  tx.twoFactorRecoveryCode.findFirst.mockResolvedValue(null);
});

test('valid TOTP completes a challenge exactly once', async () => {
  const token = await createMfaChallenge(user, 'https://chatforia.com/auth/complete');
  const result = await completeMfaChallenge(token, code());
  expect(result.ok).toBe(true);
  expect(result.nextUrl).toBe('https://chatforia.com/auth/complete');
  expect((await completeMfaChallenge(token, code())).status).toBe(401);
});

test.each(['isBanned', 'deletedAt', 'tokenVersion', 'totpSecretEnc', 'twoFactorEnabled'])('changed %s invalidates a challenge', async (field) => {
  const token = await createMfaChallenge(user);
  user[field] = { isBanned: true, deletedAt: new Date(), tokenVersion: 3, totpSecretEnc: 'changed', twoFactorEnabled: false }[field];
  expect((await completeMfaChallenge(token, '123456')).status).toBe(401);
});

test('five failures exhaust the challenge', async () => {
  const token = await createMfaChallenge(user);
  for (let i = 0; i < 4; i++) expect((await completeMfaChallenge(token, 'wrong')).status).toBe(400);
  expect((await completeMfaChallenge(token, 'wrong')).status).toBe(429);
  expect((await completeMfaChallenge(token, code())).status).toBe(401);
});

test('malformed and expired JWTs fail before database lookup', async () => {
  const token = await createMfaChallenge(user);
  const claims = jwt.decode(token);
  const expired = jwt.sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 1 }, process.env.JWT_SECRET);
  jest.clearAllMocks();
  expect((await completeMfaChallenge('invalid', '123456')).status).toBe(401);
  expect((await completeMfaChallenge(expired, '123456')).status).toBe(401);
  expect(tx.user.findUnique).not.toHaveBeenCalled();
});

test('backup codes match canonical and exact legacy hashes', async () => {
  expect(recoveryCodeHash('ABCD-EFGH-IJKL')).toBe(recoveryCodeHash('abcdefghijkl'));
  tx.twoFactorRecoveryCode.findFirst.mockResolvedValue({ id: 3 });
  const token = await createMfaChallenge(user);
  expect((await completeMfaChallenge(token, 'ABCD-EFGH-IJKL')).ok).toBe(true);
  const hashes = tx.twoFactorRecoveryCode.findFirst.mock.calls[0][0].where.codeHash.in;
  expect(hashes).toHaveLength(2);
  expect(tx.twoFactorRecoveryCode.updateMany).toHaveBeenCalledWith({
    where: { id: 3, userId: 7, usedAt: null }, data: { usedAt: expect.any(Date) },
  });
});

test('a lost backup-code claim cannot complete MFA', async () => {
  tx.twoFactorRecoveryCode.findFirst.mockResolvedValue({ id: 3 });
  tx.twoFactorRecoveryCode.updateMany.mockResolvedValueOnce({ count: 0 });
  const token = await createMfaChallenge(user);
  expect((await completeMfaChallenge(token, 'ABCD-EFGH-IJKL')).ok).toBe(false);
});

test('web OAuth stores a host-only pending cookie and redirects without a token URL', async () => {
  process.env.NODE_ENV = 'production';
  const req = { secure: true }, res = { set: jest.fn(), cookie: jest.fn(), redirect: jest.fn() };
  await startWebMfa(req, res, user, 'https://chatforia.com/auth/complete');
  expect(res.cookie).toHaveBeenCalledWith('__Host-cf_mfa_pending', expect.any(String), {
    path: '/', secure: true, httpOnly: true, sameSite: 'none', maxAge: 300000,
  });
  expect(res.redirect).toHaveBeenCalledWith('/auth/2fa/challenge');
  expect(pendingCookieName(req)).toBe('__Host-cf_mfa_pending');
});

test('verification page escapes content and loads a CSP-compatible external script', () => {
  const page = renderMfaPage('\"><script>alert(1)</script>');
  expect(page).not.toContain('<script>alert(1)</script>');
  expect(page).toContain('src="/auth/2fa/challenge.js"');
});
