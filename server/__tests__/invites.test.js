/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import prisma from '../utils/prismaClient.js';
import { createApp } from '../app.js';

const app = createApp();

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

jest.mock('../lib/telco/index.js', () => {
  const sendSms = jest.fn(async ({ to }) => ({
    provider: 'twilio',
    messageSid: `SM_${to.replace(/\D/g, '')}`,
  }));

  return { __esModule: true, sendSms };
});

async function setupAuthedUser() {
  const agent = request.agent(app);

  const unique = Date.now();
  const email = `inv_${unique}@example.com`;
  const username = `inv_${unique}`;
  const password = 'Passw0rd!23';

  const reg = await agent
    .post('/auth/register')
    .send({ email, username, password })
    .expect(201);

  const userId =
    reg.body?.user?.id ||
    reg.body?.id ||
    (
      await prisma.user.findFirst({
        where: { email },
        select: { id: true },
      })
    ).id;

  await prisma.user.updateMany({
    where: { id: userId },
    data: {
      emailVerifiedAt: new Date(),
      phoneNumber: '+15551234567',
    },
  });

  await agent
    .post('/auth/login')
    .send({ identifier: email, password })
    .expect(200);

  const tok = await agent.get('/auth/token').expect(200);
  const bearer = `Bearer ${tok.body.token}`;

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

  test('blocks inviting your own phone', async () => {
    const { agent, bearer } = await setupAuthedUser();

    const res = await agent
      .post('/invites')
      .set('Authorization', bearer)
      .send({ phone: '+1 (555) 123-4567', message: 'yo' })
      .expect(400);

    expect(res.body.error || res.body.message).toMatch(/own number/i);
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
          }),
      );
    }

    const results = await Promise.all(
      attempts.map((p) =>
        p
          .then((r) => r)
          .catch((e) => e?.response || null),
      ),
    );

    const valid = results.filter((r) => r && typeof r.status === 'number');

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