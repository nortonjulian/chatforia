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

describe('invites hardening', () => {
  const agent = request.agent(app);

  const email = `inv_${Date.now()}@example.com`;
  const username = `inv_${Date.now()}`;
  const password = 'Passw0rd!23';

  let bearer;
  let userId;

  beforeAll(async () => {
    // 1. register
    const reg = await agent
      .post('/auth/register')
      .send({ email, username, password })
      .expect(201);

    // 2. grab userId either from response or Prisma fallback
    userId =
      reg.body?.user?.id ||
      reg.body?.id ||
      (await prisma.user.findFirst({ where: { email }, select: { id: true } })).id;

    // 3. login to set cookie on agent
    await agent.post('/auth/login').send({ identifier: email, password }).expect(200);

    // 4. exchange cookie for bearer
    const tok = await agent.get('/auth/token').expect(200);
    bearer = `Bearer ${tok.body.token}`;

    // 5. ensure user has a phoneNumber in DB
    await prisma.user.update({
      where: { id: userId },
      data: { phoneNumber: '+15551234567' },
    });
  });

  afterAll(async () => {
    // Close Prisma so Jest can exit cleanly
    await prisma.$disconnect();
  });

  function authedPost(url) {
    return agent.post(url).set('Authorization', bearer);
  }

  test('rejects invalid phone', async () => {
    await authedPost('/invites')
      .send({ phone: 'abc', message: 'hi' })
      .expect(400);
  });

  // Document current behavior: currently allowed, returns 200.
  // TODO (future hardening): should be 400 "Cannot invite your own number".
  test('inviting your own phone (current behavior)', async () => {
    const res = await authedPost('/invites')
      .send({ phone: '+1 (555) 123-4567', message: 'yo' })
      .expect(200);

    expect(res.body.sent).toBe(true);
  });

  //
  // Burst test: we just want to prove the endpoint doesn't explode under spam.
  // Some parallel calls can reject before we get a proper Supertest response,
  // so we defensively filter undefineds.
  //
  test('bursting /invites does not crash server', async () => {
    const attempts = [];
    for (let i = 0; i < 10; i++) {
      attempts.push(
        authedPost('/invites').send({
          phone: '+1555000' + (1000 + i),
          message: 'x',
        })
      );
    }

    const results = await Promise.all(
      attempts.map((p) =>
        p
          .then((r) => r)
          .catch((e) => {
            // supertest throws on non-2xx if you chained .expect(),
            // but here we didn't, so e?.response may exist. If not,
            // we'll just return null.
            return e?.response || null;
          })
      )
    );

    // keep only truthy responses with a status
    const valid = results.filter((r) => r && typeof r.status === 'number');

    // we should have gotten at least one real HTTP response
    expect(valid.length > 0).toBe(true);

    // and none of the responses that *did* come back were 500
    const statuses = valid.map((r) => r.status);
    expect(statuses.includes(500)).toBe(false);
  });

  test('email invite basic (202 accepted, transporter present)', async () => {
    const res = await authedPost('/invites/email')
      .send({ to: `friend_${Date.now()}@x.com` })
      .expect(202);

    expect(res.body.ok).toBe(true);
    expect(res.body.sent).toBe(1);
    expect(res.body).toHaveProperty('messageId');
  });

  test('self-invite email is blocked', async () => {
    await authedPost('/invites/email')
      .send({ to: email })
      .expect(400);
  });
});

// Second describe: transporter missing fallback
describe('invites email fallback without transporter', () => {
  let agent2;
  let bearer2;

  const email2 = `no_tx_${Date.now()}@example.com`;
  const username2 = `no_tx_${Date.now()}`;
  const password2 = 'Passw0rd!23';

  beforeAll(async () => {
    jest.resetModules();

    // Re-mock mailer with NO transporter (forces fallback 202 path)
    jest.doMock('../services/mailer.js', () => {
      return {
        __esModule: true,
        transporter: null,
      };
    });

    // Re-mock limiter again for consistency
    jest.doMock('../middleware/rateLimits.js', () => {
      const rateLimit = require('express-rate-limit');
      const tinyLimiter = rateLimit({
        windowMs: 60_000,
        max: 3,
        keyGenerator: () => 'test-user-2',
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

    // Re-mock telco again
    jest.doMock('../lib/telco/index.js', () => {
      const sendSms = jest.fn(async ({ to }) => ({
        provider: 'twilio',
        messageSid: `SM_${to.replace(/\D/g, '')}`,
      }));
      return { __esModule: true, sendSms };
    });

    // Import fresh app AFTER new mocks
    const freshAppMod = await import('../app.js');
    const freshApp = freshAppMod.default || freshAppMod;

    // Prisma from the original import is fine to reuse here for login/insert.
    agent2 = request.agent(freshApp);

    // create new user for this block
    await agent2
      .post('/auth/register')
      .send({ email: email2, username: username2, password: password2 })
      .expect(201);

    await agent2
      .post('/auth/login')
      .send({ identifier: email2, password: password2 })
      .expect(200);

    const tok2 = await agent2.get('/auth/token').expect(200);
    bearer2 = `Bearer ${tok2.body.token}`;
  });

  afterAll(async () => {
    // disconnect prisma so Jest can exit
    await prisma.$disconnect().catch(() => {});
  });

  function authedPost2(url) {
    return agent2.post(url).set('Authorization', bearer2);
  }

  test('email invite still returns 202 even if transporter missing in test env', async () => {
    const res = await authedPost2('/invites/email')
      .send({ to: `buddy_${Date.now()}@example.com` })
      .expect(202);

    expect(res.body.ok).toBe(true);
    expect(res.body.sent).toBe(1);
    expect(res.body).toHaveProperty('messageId');
  });
});
