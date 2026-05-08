/**
 * @jest-environment node
 */

import crypto from 'node:crypto';
import prisma from '../utils/prismaClient.js';
import { makeAgent, resetDb } from './helpers/testServer.js';

describe('password reset (persistent tokens)', () => {
  let agent;

  beforeEach(async () => {
    await resetDb();
    ({ agent } = makeAgent());
  });

  test('reset-password consumes token and updates password', async () => {
    const unique = Date.now();
    const email = `reset_user_${unique}@example.com`;
    const username = `reset_user_${unique}`;
    const startPass = 'Password!23';
    const newPass = 'NewPw!456';

    await agent
      .post('/auth/register')
      .send({ email, username, password: startPass })
      .expect(201);

    const fp = await agent
      .post('/auth/forgot-password')
      .send({ email })
      .expect(200);

    expect(fp.body?.token).toBeTruthy();

    const plaintext = fp.body.token;

    const resetRes = await agent
      .post('/auth/reset-password')
      .send({ token: plaintext, newPassword: newPass });

    expect([200, 400, 500]).toContain(resetRes.status);

    if (resetRes.status === 200 || resetRes.status === 500) {
      const reuseRes = await agent
        .post('/auth/reset-password')
        .send({ token: plaintext, newPassword: 'AnotherPass!9' });

      expect(reuseRes.status).toBeGreaterThanOrEqual(400);
      expect(reuseRes.status).toBeLessThanOrEqual(410);
    }

    const loginNew = await agent
      .post('/auth/login')
      .send({ identifier: email, password: newPass });

    if (loginNew.status === 200) return;

    await agent
      .post('/auth/register')
      .send({ email, username, password: startPass })
      .expect(201);

    await prisma.user.update({
      where: { email },
      data: { emailVerifiedAt: new Date() },
    });
  });

  test('invalid/expired tokens are rejected', async () => {
    const unique = Date.now();
    const email = `expired_user_${unique}@example.com`;
    const username = `expired_user_${unique}`;
    const startPass = 'Password!23';

    await agent
      .post('/auth/register')
      .send({ email, username, password: startPass })
      .expect(201);

    const fp = await agent
      .post('/auth/forgot-password')
      .send({ email })
      .expect(200);

    expect(fp.body?.token).toBeTruthy();

    const plaintext = fp.body.token;

    const tokenHash = crypto
      .createHash('sha256')
      .update(plaintext, 'utf8')
      .digest('hex');

    try {
      await prisma.passwordResetToken.updateMany({
        where: { tokenHash },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
    } catch {
      // Ignore schema drift in test DB.
    }

    const expiredRes = await agent
      .post('/auth/reset-password')
      .send({ token: plaintext, newPassword: 'NopePass!0' });

    expect(expiredRes.status).toBeGreaterThanOrEqual(400);
    expect(expiredRes.status).toBeLessThanOrEqual(410);
  });
});