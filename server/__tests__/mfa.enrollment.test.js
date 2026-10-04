/** @jest-environment node */
import { jest } from '@jest/globals';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import speakeasy from 'speakeasy';

let user, pending, recoveryHashes;
const issueSession = jest.fn(() => 'renewed-session');
const tx = {
  $queryRaw: async () => [{ id: user.id }],
  user: {
    findUnique: async () => ({ ...user }),
    update: async ({ data }) => {
      const version = user.tokenVersion;
      Object.assign(user, data);
      if (data.tokenVersion?.increment) user.tokenVersion = version + data.tokenVersion.increment;
      return { ...user };
    },
  },
  verificationToken: {
    updateMany: async () => { if (pending) pending.usedAt = new Date(); return { count: 1 }; },
    create: async ({ data }) => { pending = { id: 1, usedAt: null, ...data }; return pending; },
    findFirst: async () => pending && !pending.usedAt && pending.expiresAt > new Date() ? pending : null,
    update: async ({ data }) => Object.assign(pending, data),
  },
  twoFactorRecoveryCode: {
    deleteMany: async () => { recoveryHashes = []; },
    createMany: async ({ data }) => { recoveryHashes = data; },
  },
};
await jest.unstable_mockModule(fileURLToPath(new URL('../utils/prismaClient.js', import.meta.url)), () => ({ default: { $transaction: (fn) => fn(tx) } }));
await jest.unstable_mockModule(fileURLToPath(new URL('../utils/secretBox.js', import.meta.url)), () => ({ seal: (s) => `sealed:${s}`, open: (s) => s.slice(7) }));
await jest.unstable_mockModule(fileURLToPath(new URL('../routes/auth.js', import.meta.url)), () => ({ issueSession }));
const { router } = await import('../routes/auth/mfaTotp.js');
const { recoveryCodeHash } = await import('../services/mfaLogin.js');
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { ...user }; next(); });
app.use('/auth/2fa', router);
beforeEach(() => {
  jest.clearAllMocks(); pending = null; recoveryHashes = [];
  user = { id: 7, username: 'mfa-user', twoFactorEnabled: false, totpSecretEnc: null, tokenVersion: 2 };
});
async function setup() { return (await request(app).post('/auth/2fa/setup').expect(200)).body.tmpSecret; }
const code = (secret) => speakeasy.totp({ secret, encoding: 'base32' });

test('setup works at the intended single /2fa path', async () => {
  expect(await setup()).toMatch(/^[A-Z2-7]+$/);
  await request(app).post('/auth/2fa/2fa/setup').expect(404);
});

test('enable refuses a secret that was not issued to this account', async () => {
  await setup();
  const arbitrary = 'JBSWY3DPEHPK3PXP';
  await request(app).post('/auth/2fa/enable').send({ tmpSecret: arbitrary, code: code(arbitrary) }).expect(400);
  expect(user.twoFactorEnabled).toBe(false);
  expect(issueSession).not.toHaveBeenCalled();
});

test('enrollment stores usable hashes, revokes old sessions and renews the verified session', async () => {
  const secret = await setup();
  const response = await request(app).post('/auth/2fa/enable').send({ tmpSecret: secret, code: code(secret) }).expect(200);
  expect(response.body.backupCodes).toHaveLength(10);
  expect(recoveryHashes.map((r) => r.codeHash)).toEqual(response.body.backupCodes.map(recoveryCodeHash));
  expect(user.tokenVersion).toBe(3);
  expect(issueSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ twoFactorEnabled: true, tokenVersion: 3 }), { mfaVerified: true });
  expect(pending.usedAt).not.toBeNull();
});

test('enabled MFA cannot be replaced through setup', async () => {
  user.twoFactorEnabled = true; user.totpSecretEnc = 'original';
  await request(app).post('/auth/2fa/setup').expect(409);
  expect(user.totpSecretEnc).toBe('original');
});

test('expired pending enrollment cannot be enabled', async () => {
  const secret = await setup(); pending.expiresAt = new Date(0);
  await request(app).post('/auth/2fa/enable').send({ tmpSecret: secret, code: code(secret) }).expect(400);
});

test('disable requires the enrolled code and revokes old sessions', async () => {
  const secret = await setup();
  await request(app).post('/auth/2fa/enable').send({ tmpSecret: secret, code: code(secret) }).expect(200);
  await request(app).post('/auth/2fa/disable').send({ code: 'wrong' }).expect(400);
  expect(user.twoFactorEnabled).toBe(true);
  await request(app).post('/auth/2fa/disable').send({ code: code(secret) }).expect(200);
  expect(user.twoFactorEnabled).toBe(false);
  expect(user.tokenVersion).toBe(4);
  expect(recoveryHashes).toHaveLength(0);
});
