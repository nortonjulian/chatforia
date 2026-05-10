/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret';
process.env.SMS_PROVIDER = 'mock';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
};

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: mockPrisma,
}));

await jest.unstable_mockModule('../middleware/rateLimits.js', () => {
  const pass = (_req, _res, next) => next();

  return {
    __esModule: true,
    limiterInvites: pass,
    invitesSmsLimiter: pass,
    invitesEmailLimiter: pass,
  };
});

await jest.unstable_mockModule('../lib/telco/index.js', () => {
  const sendSms = jest.fn(async ({ to }) => ({
    provider: 'twilio',
    messageSid: `SM_${String(to).replace(/\D/g, '')}`,
  }));

  return {
    __esModule: true,
    sendSms,
  };
});

await jest.unstable_mockModule('../utils/sendMail.js', () => {
  const sendMail = jest.fn(async () => ({
    messageId: `email_${Date.now()}`,
  }));

  return {
    __esModule: true,
    sendMail,
    isEmailAvailable: jest.fn(() => true),
  };
});

const { default: invitesRouter } = await import('../routes/invites.js');

function createTestApp() {
  const app = express();

  app.use('/invites', invitesRouter);

  app.use((err, _req, res, _next) => {
    const status = err?.output?.statusCode || err?.statusCode || 500;
    const message = err?.message || 'Internal Server Error';

    return res.status(status).json({
      error: message,
      message,
    });
  });

  return app;
}

const app = createTestApp();

function makeBearer(overrides = {}) {
  const payload = {
    id: 1,
    username: 'testuser',
    email: 'me@example.com',
    phoneNumber: '+15551234567',
    role: 'USER',
    plan: 'FREE',
    ...overrides,
  };

  return `Bearer ${jwt.sign(payload, process.env.JWT_SECRET)}`;
}

describe('invites hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'me@example.com',
      username: 'testuser',
      phoneNumber: '+15551234567',
    });

    mockPrisma.user.findFirst.mockResolvedValue(null);
  });

  test('rejects invalid phone', async () => {
    const bearer = makeBearer();

    await request(app)
      .post('/invites')
      .set('Authorization', bearer)
      .send({ phone: 'abc', message: 'hi' })
      .expect(400);
  });

  test('blocks inviting your own phone', async () => {
    const bearer = makeBearer();

    const res = await request(app)
      .post('/invites')
      .set('Authorization', bearer)
      .send({ phone: '+15551234567', message: 'yo' })
      .expect(400);

    expect(res.body.error || res.body.message).toMatch(/own number/i);
  });

  test('bursting /invites does not crash server', async () => {
    const bearer = makeBearer();

    const attempts = [];

    for (let i = 0; i < 10; i += 1) {
      attempts.push(
        request(app)
          .post('/invites')
          .set('Authorization', bearer)
          .send({
            phone: `+1555000${1000 + i}`,
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
    const bearer = makeBearer();

    mockPrisma.user.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/invites/email')
      .set('Authorization', bearer)
      .send({ to: `friend_${Date.now()}@x.com` })
      .expect(202);

    expect(res.body.ok).toBe(true);
    expect(res.body.sent).toBe(1);
    expect(res.body).toHaveProperty('messageId');
  });

  test('self-invite email is blocked', async () => {
    const bearer = makeBearer();

    await request(app)
      .post('/invites/email')
      .set('Authorization', bearer)
      .send({ to: 'me@example.com' })
      .expect(400);
  });
});