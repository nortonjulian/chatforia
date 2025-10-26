/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import prisma from '../utils/prismaClient.js';
import app from '../app.js';

// ---- Mock rate limiter with tiny limits ----
jest.mock('../middleware/rateLimits.js', () => {
  const rateLimit = require('express-rate-limit');

  const tinyLimiter = rateLimit({
    windowMs: 60_000,
    max: 3,
    keyGenerator: () => 'test-user-1',
    standardHeaders: true,
    legacyHeaders: false,
  });

  return {
    __esModule: true,
    limiterInvites: tinyLimiter,
    invitesSmsLimiter: tinyLimiter,
    invitesEmailLimiter: tinyLimiter,
  };
});

// ---- Mock telco (SMS provider) ----
jest.mock('../lib/telco/index.js', () => {
  const sendSms = jest.fn(async ({ to }) => ({
    provider: 'twilio',
    messageSid: `SM_${to.replace(/\D/g, '')}`,
  }));
  return { __esModule: true, sendSms };
});

// ---- Mock mailer (transporter exists) ----
jest.mock('../services/mailer.js', () => {
  const sendMail = jest.fn(async () => ({ messageId: 'email_1' }));
  return {
    __esModule: true,
    transporter: { sendMail },
  };
});

/**
 * Helper to spin up a brand-new authenticated user for THIS test run.
 * Returns { agent, bearer, email, userId }.
 */
async function setupAuthedUser() {
  const agent = request.agent(app);

  const email = `inv_${Date.now()}@example.com`;
  const username = `inv_${Date.now()}`;
  const password = 'Passw0rd!23';

  // 1. register
  const reg = await agent
    .post('/auth/register')
    .send({ email, username, password })
    .expect(201);

  // 2. grab userId
  const userId =
    reg.body?.user?.id ||
    reg.body?.id ||
    (
      await prisma.user.findFirst({
        where: { email },
        select: { id: true },
      })
    ).id;

  // 3. login (sets cookie on agent)
  await agent
    .post('/auth/login')
    .send({ identifier: email, password })
    .expect(200);

  // 4. exchange cookie for bearer token
  const tok = await agent.get('/auth/token').expect(200);
  const bearer = `Bearer ${tok.body.token}`;

  // 5. ensure phoneNumber is set
  await prisma.user.updateMany({
    where: { id: userId },
    data: { phoneNumber: '+15551234567' },
  });

  return { agent, bearer, email, userId };
}

describe('invites hardening', () => {
  test('rejects invalid phone', async () => {
    const { agent, bearer } = await setupAuthedUser();

    await agent
      .post('/invites')
      .set('Authorization', bearer)
      .send({ phone: 'abc', message: 'hi' })
      .expect(400);
  });

  test('inviting your own phone (current behavior)', async () => {
    const { agent, bearer } = await setupAuthedUser();

    const res = await agent
      .post('/invites')
      .set('Authorization', bearer)
      .send({ phone: '+1 (555) 123-4567', message: 'yo' })
      .expect(200);

    expect(res.body.sent).toBe(true);
  });

  test('bursting /invites does not crash server', async () => {
    const { agent, bearer } = await setupAuthedUser();

    const attempts = [];
    for (let i = 0; i < 10; i++) {
      attempts.push(
        agent
          .post('/invites')
          .set('Authorization', bearer)
          .send({
            phone: '+1555000' + (1000 + i),
            message: 'x',
          })
      );
    }

    const results = await Promise.all(
      attempts.map((p) =>
        p
          .then((r) => r)
          .catch((e) => e?.response || null)
      )
    );

    const valid = results.filter(
      (r) => r && typeof r.status === 'number'
    );

    expect(valid.length > 0).toBe(true);

    const statuses = valid.map((r) => r.status);
    expect(statuses.includes(500)).toBe(false);
  });

  test('email invite basic (202 accepted, transporter present)', async () => {
    const { agent, bearer } = await setupAuthedUser();

    const res = await agent
      .post('/invites/email')
      .set('Authorization', bearer)
      .send({ to: `friend_${Date.now()}@x.com` })
      .expect(202);

    expect(res.body.ok).toBe(true);
    expect(res.body.sent).toBe(1);
    expect(res.body).toHaveProperty('messageId');
  });

  test('self-invite email is blocked', async () => {
    const { agent, bearer, email } = await setupAuthedUser();

    await agent
      .post('/invites/email')
      .set('Authorization', bearer)
      .send({ to: email })
      .expect(400);
  });
});
