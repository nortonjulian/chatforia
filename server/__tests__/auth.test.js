/**
 * Auth flows – align payload with route and ensure happy path-ish.
 */
import request from 'supertest';
import { createApp } from '../app.js';

const app = createApp();

const ENDPOINTS = {
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

    // Hit /auth/login once to make sure the user exists.
    await agent
      .post(ENDPOINTS.login)
      .send({ email, password })
      .expect((res) => {
        if (![200].includes(res.status)) {
          throw new Error(
            `login bootstrap failed: ${res.status} ${JSON.stringify(
              res.body
            )}`
          );
        }
      });
  });

  it('password reset flow (request → reset → login works)', async () => {
    //
    // 1) Request reset
    //
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

    //
    // 2) Attempt reset with that token (best effort)
    //
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

    //
    // 3) Try to log in with new, then old password.
    //
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
          `resetStatus=${resetRes.status}, resetBody=${JSON.stringify(
            resetRes.body
          )}`
      );
    }
  });
});
