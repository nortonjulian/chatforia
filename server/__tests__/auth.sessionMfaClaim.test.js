/** @jest-environment node */
import { jest, test, expect } from '@jest/globals';
import jwt from 'jsonwebtoken';

// The session issuer must not contact a real database.
await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: {
    user: {},
  },
}));

const { issueSession } = await import('../routes/auth.js');

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
