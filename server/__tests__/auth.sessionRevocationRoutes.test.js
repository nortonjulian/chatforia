import crypto from 'node:crypto';

import { jest, test, expect } from '@jest/globals';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

const revoke = jest.fn().mockResolvedValue(undefined);
const disconnect = jest.fn();
await jest.unstable_mockModule('../services/pushAuthorityService.js', () => ({
  revokePushAuthorityForSession: revoke,
}));
await jest.unstable_mockModule('../services/socketBus.js', () => ({
  disconnectSessionSockets: disconnect,
}));
await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true, default: { user: {} },
}));

const { default: router } = await import('../routes/auth.js');
const app = express();
app.use('/auth', router);

test('full-session logout revokes durable authority and disconnects only its socket room', async () => {
  const token = jwt.sign({ id: 42, typ: 'session', tokenVersion: 1 },
    process.env.JWT_SECRET || 'test_secret', { expiresIn: '1h' });
  const fingerprint = crypto.createHash('sha256').update(token).digest('hex');
  await request(app).post('/auth/logout').set('Authorization', `Bearer ${token}`).expect(200);
  expect(revoke).toHaveBeenCalledWith(expect.objectContaining({ fingerprint }));
  expect(disconnect).toHaveBeenCalledWith(fingerprint);
  await request(app).post('/auth/logout').set('Authorization', `Bearer ${token}`).expect(200);
  expect(disconnect).toHaveBeenCalledTimes(2);
});

test('short credentials cannot claim successful parent-session logout', async () => {
  revoke.mockClear();
  disconnect.mockClear();
  const short = jwt.sign({ id: 42, typ: 'short', tokenVersion: 1,
    parentSessionFingerprint: 'a'.repeat(64), parentSessionExpiresAt: Date.now() + 3600000 },
  process.env.JWT_SECRET || 'test_secret', { expiresIn: '10m' });
  await request(app).post('/auth/logout').set('Authorization', `Bearer ${short}`).expect(401);
  expect(revoke).not.toHaveBeenCalled();
  expect(disconnect).not.toHaveBeenCalled();
});
