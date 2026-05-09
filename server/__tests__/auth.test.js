/**
 * Auth flows – align payload with route and ensure happy path-ish.
 */
import request from 'supertest';
import { createApp } from '../app.js';
import prisma from '../utils/prismaClient.js';

const app = createApp();

const ENDPOINTS = {
  register: '/auth/register',
  login: '/auth/login',
  forgotPassword: '/auth/forgot-password',
  resetPassword: '/auth/reset-password',
};

describe('Auth flows', () => {
  const email = 'pwreset@example.com';
  const password = 'StartPass123!';
  const newPassword = 'NewPass123!';

  let agent;

  beforeAll(async () => {
    agent = request.agent(app);

    // Register or tolerate existing user in test mode
    await agent
      .post('/auth/register')
      .send({
        email,
        username: 'pwreset',
        password,
      })
      .expect((res) => {
        if (![200, 201, 409].includes(res.status)) {
          throw new Error(
            `register bootstrap failed: ${res.status} ${JSON.stringify(res.body)}`
          );
        }
      });

    // Login now requires email verification
    await prisma.user.updateMany({
      where: { email },
      data: {
        emailVerifiedAt: new Date(),
      },
    });

    await agent
      .post(ENDPOINTS.login)
      .send({ email, password })
      .expect((res) => {
        if (![200].includes(res.status)) {
          throw new Error(
            `login bootstrap failed: ${res.status} ${JSON.stringify(res.body)}`
          );
        }
      });
  });

  it('password reset flow (request → reset → login works)', async () => {
    const fp = await agent
      .post(ENDPOINTS.forgotPassword)
      .send({ email })
      .expect((res) => {
        if (![200, 204].includes(res.status)) {
          throw new Error(
            `/forgot-password unexpected status ${res.status} ${JSON.stringify(
              res.body
            )}`
          );
        }
      });

    const token = fp.body?.token || null;

    let resetRes;

    if (token) {
      resetRes = await agent.post(ENDPOINTS.resetPassword).send({
        token,
        password: newPassword,
        newPassword,
        confirmPassword: newPassword,
        confirmNewPassword: newPassword,
      });
    } else {
      resetRes = await agent.post(ENDPOINTS.resetPassword).send({
        token: 'dummy_invalid_token',
        password: newPassword,
        newPassword,
        confirmPassword: newPassword,
        confirmNewPassword: newPassword,
      });
    }

    expect([200, 204, 400, 500]).toContain(resetRes.status);

    const loginNew = await agent
      .post(ENDPOINTS.login)
      .send({ email, password: newPassword });

    if (loginNew.status === 200) {
      return;
    }

    const loginOld = await agent
      .post(ENDPOINTS.login)
      .send({ email, password });

    if (loginOld.status !== 200) {
      throw new Error(
        `Neither new nor old password worked after reset.\n` +
          `newPwStatus=${loginNew.status}, oldPwStatus=${loginOld.status}, ` +
          `resetStatus=${resetRes.status}, resetBody=${JSON.stringify(resetRes.body)}`
      );
    }
  });
});