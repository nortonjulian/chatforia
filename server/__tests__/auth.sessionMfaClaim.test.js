/** @jest-environment node */
import { jest, test, expect } from '@jest/globals';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

// The session issuer must not contact a real database.
await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: {
    user: {},
  },
}));

const { issueSession, default: authRouter } = await import('../routes/auth.js');

const account = {
  id: 42,
  username: 'synthetic-user',
  email: 'synthetic@example.test',
  role: 'USER',
  plan: 'FREE',
  tokenVersion: 3,
  twoFactorEnabled: false,
};

const response = () => ({
  cookie: jest.fn(),
});

test('ordinary sessions explicitly lack MFA verification', () => {
  const res = response();

  const token = issueSession(res, account);
  const claims = jwt.verify(
    token,
    process.env.JWT_SECRET || 'test_secret'
  );

  expect(claims.typ).toBe('session');
  expect(claims.tokenVersion).toBe(3);
  expect(claims.mfaVerified).toBe(false);
  expect(res.cookie).toHaveBeenCalledTimes(1);
});

test('completed MFA produces a verified session', () => {
  const res = response();

  const token = issueSession(
    res,
    { ...account, twoFactorEnabled: true },
    { mfaVerified: true }
  );

  const claims = jwt.verify(
    token,
    process.env.JWT_SECRET || 'test_secret'
  );

  expect(claims.mfaVerified).toBe(true);
  expect(res.cookie).toHaveBeenCalledTimes(1);
});

test('MFA-enabled accounts cannot bypass verification', () => {
  const res = response();

  expect(() =>
    issueSession(
      res,
      { ...account, twoFactorEnabled: true }
    )
  ).toThrow('MFA must complete before session issuance');

  expect(res.cookie).not.toHaveBeenCalled();
});

test.each([true, false])('short API tokens preserve authenticated MFA proof (%s)', async mfaVerified => {
  const app = express();
  app.use((req, _res, next) => {
    req.user = account;
    req.auth = { mfaVerified, tokenVersion: 3 };
    next();
  });
  app.use('/auth', authRouter);
  const response = await request(app).get('/auth/token').expect(200);
  const claims = jwt.verify(response.body.token, process.env.JWT_SECRET || 'test_secret');
  expect(claims.typ).toBe('short');
  expect(claims.mfaVerified).toBe(mfaVerified);
  expect(claims.tokenVersion).toBe(3);
});

test.each(['development', 'production'])(
  'logout expires the configured session cookie with its issuing scope (%s)',
  async (mode) => {
    const previous = {
      NODE_ENV: process.env.NODE_ENV,
      JWT_COOKIE_NAME: process.env.JWT_COOKIE_NAME,
      COOKIE_DOMAIN: process.env.COOKIE_DOMAIN,
    };
    try {
      process.env.NODE_ENV = mode;
      process.env.JWT_COOKIE_NAME = 'synthetic_custom_session';
      process.env.COOKIE_DOMAIN = '.example.test';
      const app = express();
      app.use('/auth', authRouter);
      for (const method of ['post', 'get']) {
        const result = await request(app)[method]('/auth/logout');
        const cookie = result.headers['set-cookie'].find((value) =>
          value.startsWith('synthetic_custom_session=')
        );
        expect(cookie).toContain('Path=/');
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('Expires=Thu, 01 Jan 1970');
        if (mode === 'production') {
          expect(cookie).toContain('Secure');
          expect(cookie).toContain('Domain=.example.test');
          expect(cookie).toContain('SameSite=None');
        } else {
          expect(cookie).not.toContain('Secure');
          expect(cookie).not.toContain('Domain=');
          expect(cookie).toContain('SameSite=Lax');
        }
      }
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }
);
