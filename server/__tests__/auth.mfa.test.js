/** @jest-environment node */
import { jest } from '@jest/globals';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import speakeasy from 'speakeasy';
// Test only the MFA state/transactions here; encryption has its own utility tests.
await jest.unstable_mockModule(fileURLToPath(new URL('../utils/secretBox.js', import.meta.url)), () => ({
  seal: (s) => `test:${s}`, open: (s) => s.slice(5),
}));
const { default: prisma } = await import('../utils/prismaClient.js');
const { resetDb } = await import('./helpers/testServer.js');
const { createMfaChallenge, completeMfaChallenge, recoveryCodeHash } = await import('../services/mfaLogin.js');
let user;
const secret = 'JBSWY3DPEHPK3PXP';
beforeEach(async () => {
  await resetDb();
  const username = `mfa_${crypto.randomBytes(6).toString('hex')}`;
  user = await prisma.user.create({ data: {
    username, usernameNorm: username, passwordHash: 'oauth',
    twoFactorEnabled: true, totpSecretEnc: `test:${secret}`,
  } });
});
const code = () => speakeasy.totp({ secret, encoding: 'base32' });

test('concurrent completion of one TOTP challenge has one winner', async () => {
  const token = await createMfaChallenge(user);
  const results = await Promise.all([completeMfaChallenge(token, code()), completeMfaChallenge(token, code())]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
});

test('two challenges cannot both spend one backup code', async () => {
  const backup = 'ABCD-EFGH-IJKL-MNOP';
  await prisma.twoFactorRecoveryCode.create({ data: { userId: user.id, codeHash: recoveryCodeHash(backup) } });
  const tokens = await Promise.all([createMfaChallenge(user), createMfaChallenge(user)]);
  const results = await Promise.all(tokens.map((token) => completeMfaChallenge(token, backup)));
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: user.id, usedAt: null } })).toBe(0);
});

test('password/session revocation invalidates outstanding MFA challenges', async () => {
  const token = await createMfaChallenge(user);
  await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });
  expect((await completeMfaChallenge(token, code())).status).toBe(401);
});

test('five bad attempts make even a valid code unusable', async () => {
  const token = await createMfaChallenge(user);
  for (let i = 0; i < 4; i++) expect((await completeMfaChallenge(token, 'wrong')).status).toBe(400);
  expect((await completeMfaChallenge(token, 'wrong')).status).toBe(429);
  expect((await completeMfaChallenge(token, code())).status).toBe(401);
});
