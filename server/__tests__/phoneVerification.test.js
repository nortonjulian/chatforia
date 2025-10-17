/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';

// ---- Mock telco driver BEFORE importing app ----
const sendSmsMock = jest.fn(async ({ to, text, clientRef }) => ({
  provider: 'twilio',
  messageSid: `SM_${(to || '').replace(/\D/g, '')}_${Date.now()}`,
  _debug: { to, text, clientRef },
}));
jest.mock('../lib/telco/index.js', () => {
  return { __esModule: true, sendSms: (...args) => sendSmsMock(...args) };
});

import request from 'supertest';
import crypto from 'crypto';
import prisma from '../utils/prismaClient.js';
import app from '../app.js';

const hash = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const PHONE = '+15551234567';

describe('phone verification flow (Twilio-only)', () => {
  const agent = request.agent(app);

  const email = `pv_${Date.now()}@example.com`;
  const username = `pv_${Date.now()}`;
  const password = 'Passw0rd!23';

  let bearer;
  let userId;

  beforeAll(async () => {
    // Create user + login to set cookie session
    await agent.post('/auth/register').send({ email, username, password }).expect(201);
    const login = await agent.post('/auth/login').send({ identifier: email, password }).expect(200);

    // Grab bearer for endpoints using Authorization
    const tok = await agent.get('/auth/token').expect(200);
    bearer = `Bearer ${tok.body.token}`;

    // Resolve user id for seeding tokens
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    userId = u?.id;
    expect(Number.isInteger(userId)).toBe(true);
  });

  afterAll(async () => {
    // Best-effort cleanup
    await prisma.verificationToken.deleteMany({ where: { userId } }).catch(() => {});
  });

  const authedPost = (url) => agent.post(url).set('Authorization', bearer);

  test('start: rejects invalid phone', async () => {
    await authedPost('/auth/phone/start')
      .send({ phoneNumber: 'not-a-phone' })
      .expect(400);
  });

  test('start: sends verification SMS via Twilio (mocked)', async () => {
    sendSmsMock.mockClear();

    const res = await authedPost('/auth/phone/start')
      .send({ phoneNumber: PHONE })
      .expect(200);

    expect(res.body).toEqual({ ok: true });
    expect(sendSmsMock).toHaveBeenCalledTimes(1);

    // Ensure user phone is stored normalized
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { phoneNumber: true },
    });
    expect(user?.phoneNumber).toBe(PHONE);

    // A fresh token should exist
    const tok = await prisma.verificationToken.findFirst({
      where: { userId, type: 'PHONE', usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(tok).toBeTruthy();
    expect(tok?.tokenHash).toBeTruthy();
  });

  test('verify: bad code is rejected', async () => {
    // Ensure there is at least one fresh token (start endpoint already created one)
    const t = await prisma.verificationToken.findFirst({
      where: { userId, type: 'PHONE', usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(t).toBeTruthy();

    // Wrong code
    await authedPost('/auth/phone/verify')
      .send({ code: '000000' })
      .expect(400);
  });

  test('verify: correct code succeeds (seed known token)', async () => {
    const code = '123456';
    const tokenHash = hash(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Remove any prior unused tokens and seed a known one
    await prisma.verificationToken.deleteMany({ where: { userId, type: 'PHONE', usedAt: null } });
    await prisma.verificationToken.create({
      data: { userId, type: 'PHONE', tokenHash, expiresAt },
    });

    const res = await authedPost('/auth/phone/verify').send({ code }).expect(200);
    expect(res.body).toEqual({ ok: true });

    // Token should now be marked used and user marked verified
    const used = await prisma.verificationToken.findFirst({
      where: { userId, type: 'PHONE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(used?.usedAt).toBeTruthy();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { phoneVerifiedAt: true, phoneVerifiedIp: true },
    });
    expect(user?.phoneVerifiedAt).toBeTruthy();
    // IP may be undefined in test env, but the field should exist
    expect('phoneVerifiedIp' in user).toBe(true);
  });
});
