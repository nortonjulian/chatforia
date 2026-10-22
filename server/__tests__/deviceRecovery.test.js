import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcrypt';
import speakeasy from 'speakeasy';

const prisma = {
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  user: { findUnique: jest.fn() },
  device: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn() },
};
// Unit-test MFA verification using a fixed secret; no production APP_ENC_KEY needed.
const testMfaSecret = 'JBSWY3DPEHPK3PXP';
await jest.unstable_mockModule('../utils/secretBox.js', () => ({
  open: () => testMfaSecret,
}));
// Each case tests recovery semantics, not the HTTP rate-limit window.
await jest.unstable_mockModule('express-rate-limit', () => ({
  default: () => (_req, _res, next) => next(),
}));
await jest.unstable_mockModule('../utils/prismaClient.js', () => ({ default: prisma }));
await jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 68 }; next(); },
}));
const { default: router } = await import('../routes/devices.js');
const app = express();
app.use('/devices', router);
app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));

const oldDeviceId = '78d6df31-a3c5-4406-9387-824cb90a8f81';
const newDeviceId = '36e4e752-fc7d-4cd4-aad5-dfa7629d24ce';
const publicKey = Buffer.alloc(32, 5).toString('base64');
const payload = { oldDeviceId, newDeviceId, publicKey, password: 'Password123!' };
const passHash = await bcrypt.hash('Password123!', 4);

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((fn) => fn(prisma));
  prisma.$queryRaw.mockResolvedValue([{ id: 68 }]);
  prisma.user.findUnique.mockImplementation(async ({ select }) =>
    select.passwordHash
      ? { passwordHash: passHash, twoFactorEnabled: false, totpSecretEnc: null,
          isBanned: false, deletedAt: null }
      : { plan: 'FREE', isBanned: false, deletedAt: null }
  );
  prisma.device.findUnique.mockImplementation(async ({ where }) =>
    where.userId_deviceId.deviceId === oldDeviceId
      ? { revokedAt: new Date('2026-10-21T23:55:40Z') }
      : null
  );
  prisma.device.findMany.mockResolvedValue([]);
  prisma.device.create.mockImplementation(async ({ data }) => ({ id: 'new-id', ...data }));
});

test('requires password reauthentication and preserves revoked identity', async () => {
  const result = await request(app).post('/devices/recovery')
    .send({ ...payload, password: 'Incorrect!' });
  expect(result.status).toBe(401);
  expect(prisma.device.create).not.toHaveBeenCalled();
});

test('enrolls a new identity, leaving revoked record untouched', async () => {
  const result = await request(app).post('/devices/recovery').send(payload);
  expect(result.status).toBe(200);
  expect(result.body.ok).toBe(true);
  expect(prisma.device.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ deviceId: newDeviceId, userId: 68,
      pairingStatus: 'approved' }),
  }));
  expect(prisma.device).not.toHaveProperty('updateMany');
});

test('requires MFA when enabled', async () => {
  prisma.user.findUnique.mockImplementation(async ({ select }) =>
    select.passwordHash
      ? { passwordHash: passHash, twoFactorEnabled: true, totpSecretEnc: 'redacted',
          isBanned: false, deletedAt: null }
      : { plan: 'FREE', isBanned: false, deletedAt: null }
  );
  const result = await request(app).post('/devices/recovery').send(payload);
  expect(result.status).toBe(403);
  expect(result.body.code).toBe('MFA_REQUIRED');
  expect(prisma.device.create).not.toHaveBeenCalled();
});

test('never bypasses the Free device limit', async () => {
  prisma.device.findMany.mockResolvedValue([
    { deviceId: 'one' }, { deviceId: 'two' },
  ]);
  const result = await request(app).post('/devices/recovery').send(payload);
  expect(result.status).toBe(409);
  expect(result.body.code).toBe('DEVICE_REPLACEMENT_REQUIRED');
  expect(prisma.device.create).not.toHaveBeenCalled();
});

test('rejects attempts to reuse the revoked device identity', async () => {
  const result = await request(app).post('/devices/recovery')
    .send({ ...payload, newDeviceId: oldDeviceId });
  expect(result.status).toBe(400);
  expect(prisma.device.create).not.toHaveBeenCalled();
});


test('accepts a valid authenticator code for a protected account', async () => {
  prisma.user.findUnique.mockImplementation(async ({ select }) =>
    select.passwordHash
      ? { passwordHash: passHash, twoFactorEnabled: true, totpSecretEnc: 'test-encrypted-mfa',
          isBanned: false, deletedAt: null }
      : { plan: 'FREE', isBanned: false, deletedAt: null }
  );

  const mfaCode = speakeasy.totp({
    secret: testMfaSecret,
    encoding: 'base32',
  });
  const response = await request(app).post('/devices/recovery')
    .send({ ...payload, mfaCode });
  expect(response.status).toBe(200);
  expect(response.body.ok).toBe(true);
  expect(prisma.device.create).toHaveBeenCalledTimes(1);
});

test('rejects an incorrect six-digit authenticator code', async () => {
  prisma.user.findUnique.mockImplementation(async ({ select }) =>
    select.passwordHash
      ? { passwordHash: passHash, twoFactorEnabled: true, totpSecretEnc: 'test-encrypted-mfa',
          isBanned: false, deletedAt: null }
      : { plan: 'FREE', isBanned: false, deletedAt: null }
  );
  // Choose a six-digit value that is not valid in the server's +/-1-step window.
  const now = Math.floor(Date.now() / 1000);
  const valid = new Set([-30, 0, 30].map(delta => speakeasy.totp({
    secret: testMfaSecret, encoding: 'base32', time: now + delta,
  })));
  const invalid = ['000000', '111111', '222222', '333333'].find(code => !valid.has(code));
  expect(invalid).toBeDefined();
  const response = await request(app).post('/devices/recovery')
    .send({ ...payload, mfaCode: invalid });
  expect(response.status).toBe(401);
  expect(response.body.code).toBe('INVALID_RECOVERY_CREDENTIALS');
  expect(prisma.device.create).not.toHaveBeenCalled();
});

test('retries an interrupted recovery idempotently without a second device', async () => {
  prisma.device.findUnique.mockImplementation(async ({ where }) => {
    const id = where.userId_deviceId.deviceId;
    if (id === oldDeviceId) return { revokedAt: new Date('2026-10-21T23:55:40Z') };
    if (id === newDeviceId) return {
      id: 'already-enrolled', deviceId: newDeviceId, publicKey, revokedAt: null,
    };
    return null;
  });
  const response = await request(app).post('/devices/recovery').send(payload);
  expect(response.status).toBe(200);
  expect(response.body.device.deviceId).toBe(newDeviceId);
  expect(prisma.device.create).not.toHaveBeenCalled();
});

test('does not overwrite an existing conflicting replacement identity', async () => {
  prisma.device.findUnique.mockImplementation(async ({ where }) => {
    const id = where.userId_deviceId.deviceId;
    if (id === oldDeviceId) return { revokedAt: new Date('2026-10-21T23:55:40Z') };
    if (id === newDeviceId) return {
      id: 'unexpected-device', deviceId: newDeviceId, publicKey: 'some-other-key', revokedAt: null,
    };
    return null;
  });
  const response = await request(app).post('/devices/recovery').send(payload);
  expect(response.status).toBe(409);
  expect(response.body.code).toBe('RECOVERY_IDENTITY_CONFLICT');
  expect(prisma.device.create).not.toHaveBeenCalled();
});
