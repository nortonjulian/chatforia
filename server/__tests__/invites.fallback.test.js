/**
 * @jest-environment node
 *
 * This suite lives in its own file so it runs in its own Jest worker.
 * We can safely reset modules and mock a fresh app without poisoning other tests.
 */

import { jest } from '@jest/globals';
import request from 'supertest';
import prisma from '../utils/prismaClient.js';

describe('invites email fallback without transporter', () => {
  let agent;
  let bearer;

  const email = `no_tx_${Date.now()}@example.com`;
  const username = `no_tx_${Date.now()}`;
  const password = 'Passw0rd!23';

  beforeAll(async () => {
    // Start with a clean module registry inside THIS worker
    jest.resetModules();

    // Mock mailer with NO transporter (forces fallback 202 path)
    jest.doMock('../services/mailer.js', () => {
      return {
        __esModule: true,
        transporter: null,
      };
    });

    // Mock limiter with a distinct keyGenerator so rate limits don't collide
    jest.doMock('../middleware/rateLimits.js', () => {
      const rateLimit = require('express-rate-limit');
      const tinyLimiter = rateLimit({
        windowMs: 60_000,
        max: 3,
        keyGenerator: () => 'test-user-fallback',
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

    // Mock telco again
    jest.doMock('../lib/telco/index.js', () => {
      const sendSms = jest.fn(async ({ to }) => ({
        provider: 'twilio',
        messageSid: `SM_${to.replace(/\D/g, '')}`,
      }));
      return { __esModule: true, sendSms };
    });

    // Now import a *fresh* app that will see those mocks.
    const freshAppMod = await import('../app.js');
    const freshApp = freshAppMod.default || freshAppMod;

    agent = request.agent(freshApp);

    // Create/login a new user inside THIS mocked world
    await agent
      .post('/auth/register')
      .send({ email, username, password })
      .expect(201);

    await agent
      .post('/auth/login')
      .send({ identifier: email, password })
      .expect(200);

    const tok = await agent.get('/auth/token').expect(200);
    bearer = `Bearer ${tok.body.token}`;
  });

  afterAll(async () => {
    // DO NOT disconnect Prisma here. Global teardown in jest.setup.js handles it.
    // If we did disconnect here, we'd kill Prisma for other tests in this worker.
  });

  test('email invite still returns 202 even if transporter missing in test env', async () => {
    const res = await agent
      .post('/invites/email')
      .set('Authorization', bearer)
      .send({ to: `buddy_${Date.now()}@example.com` })
      .expect(202);

    expect(res.body.ok).toBe(true);
    expect(res.body.sent).toBe(1);
    expect(res.body).toHaveProperty('messageId');
  });
});
