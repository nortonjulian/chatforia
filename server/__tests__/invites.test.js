/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';

// ---- Mocks must be defined before importing app.js ----

// mock telco driver so we don’t call providers
// jest.mock('../lib/telco/index.js', () => {
//   const sendSmsWithFallback = jest.fn(async ({ to }) => ({
//     provider: 'telnyx',
//     messageId: `m_${to}`,
//   }));
//   return {
//     __esModule: true,
//     sendSmsWithFallback, // named export (matches router import)
//   };
// });

jest.mock('../lib/telco/index.js', () => {
  const sendSms = jest.fn(async ({ to }) => ({
    provider: 'twilio',
    messageSid: `SM_${to.replace(/\D/g, '')}`,
  }));
  return { __esModule: true, sendSms };
});

// mock transporter
jest.mock('../services/mailer.js', () => {
  const sendMail = jest.fn(async () => ({ messageId: 'email_1' }));
  return {
    __esModule: true,
    transporter: { sendMail }, // named export (matches router import)
  };
});

import request from 'supertest';
import app from '../app.js';

describe('invites hardening', () => {
  const agent = request.agent(app);

  const email = `inv_${Date.now()}@example.com`;
  const username = `inv_${Date.now()}`;
  const password = 'Passw0rd!23';

  let bearer; // Authorization header value

  beforeAll(async () => {
    // Register & login (register returns 201 in this app)
    await agent.post('/auth/register').send({ email, username, password }).expect(201);
    await agent.post('/auth/login').send({ identifier: email, password }).expect(200);

    // Get a short-lived token (auth uses cookie set by login)
    const tok = await agent.get('/auth/token').expect(200);
    expect(tok.body).toHaveProperty('token');
    bearer = `Bearer ${tok.body.token}`;
  });

  function authedPost(url) {
    return agent.post(url).set('Authorization', bearer);
  }

  test('rejects invalid phone', async () => {
    await authedPost('/invites').send({ phone: 'abc', message: 'hi' }).expect(400);
  });

  // test('sends sms invite and logs', async () => {
  //   const res = await authedPost('/invites')
  //     .send({ phone: '+15551234567', message: 'try this' })
  //     .expect(200);
  //   expect(res.body.sent).toBe(true);
  //   expect(res.body.provider).toBe('telnyx');
  // });

  test('rate limit kicks in (per-user)', async () => {
    const promises = [];
    for (let i = 0; i < 25; i++) {
      promises.push(
        authedPost('/invites').send({ phone: '+1555000' + (1000 + i), message: 'x' })
      );
    }
    const results = await Promise.all(
      promises.map((p) => p.then((r) => r).catch((e) => e.response))
    );
    const codes = results.map((r) => r?.status);
    expect(codes.some((c) => c === 429)).toBe(true);
  });

  test('email invite basic', async () => {
    const res = await authedPost('/invites/email')
      .send({ to: `friend_${Date.now()}@x.com` })
      .expect(202);
    expect(res.body.ok).toBe(true);
  });

  test('self-invite email blocked', async () => {
    await authedPost('/invites/email').send({ to: email }).expect(400);
  });
});
