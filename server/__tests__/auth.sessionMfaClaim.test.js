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
