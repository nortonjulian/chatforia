import { jest } from '@jest/globals';

import {
  createRequireStaffPermission,
} from '../requireStaffPermission.js';

function makeRequest(options = {}) {
  const req = {
    user: options.user,
    auth: options.auth,
  };

  const res = {
    statusCode: 200,
    body: null,
    status: jest.fn(function (code) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function (body) {
      this.body = body;
      return this;
    }),
  };

  return { req, res, next: jest.fn() };
}

const validUser = {
  id: 66,
  role: 'USER',
  twoFactorEnabled: true,
};

const verifiedAuth = { mfaVerified: true };

describe('staff permission authorization', () => {
  test('rejects unknown permission at configuration time', () => {
    expect(() =>
      createRequireStaffPermission('founder.transfer', jest.fn())
    ).toThrow(/Unknown staff permission/);
  });

  test('rejects unauthenticated requests', async () => {
    const lookup = jest.fn();
    const middleware = createRequireStaffPermission(
      'users.read',
      lookup
    );

    const { req, res, next } = makeRequest();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(lookup).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test.each([
    [{ ...validUser, twoFactorEnabled: false }, verifiedAuth],
    [validUser, { mfaVerified: false }],
    [validUser, {}],
  ])('rejects missing MFA requirements', async (user, auth) => {
    const lookup = jest.fn();
    const middleware = createRequireStaffPermission(
      'users.read',
      lookup
    );

    const { req, res, next } = makeRequest({
      user,
      auth,
    });

    await middleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(lookup).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects missing assignment lookup', async () => {
    const middleware = createRequireStaffPermission('users.read');

    const { req, res, next } = makeRequest({
      user: validUser,
      auth: verifiedAuth,
    });

    await middleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects inactive staff assignments', async () => {
    const lookup = jest.fn().mockResolvedValue({
      profile: 'CTO',
      active: false,
    });

    const middleware = createRequireStaffPermission(
      'users.read',
      lookup
    );

    const { req, res, next } = makeRequest({
      user: validUser,
      auth: verifiedAuth,
    });

    await middleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects unknown staff profiles', async () => {
    const lookup = jest.fn().mockResolvedValue({
      profile: 'FOUNDER',
      active: true,
    });

    const middleware = createRequireStaffPermission(
      'users.read',
      lookup
    );

    const { req, res, next } = makeRequest({
      user: validUser,
      auth: verifiedAuth,
    });

    await middleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects permissions absent from assigned profile', async () => {
    const lookup = jest.fn().mockResolvedValue({
      profile: 'SENIOR_ENGINEER',
      active: true,
    });

    const middleware = createRequireStaffPermission(
      'users.manage',
      lookup
    );

    const { req, res, next } = makeRequest({
      user: validUser,
      auth: verifiedAuth,
    });

    await middleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('fails closed when assignment lookup fails', async () => {
    const lookup = jest.fn().mockRejectedValue(
      new Error('Database unavailable')
    );

    const middleware = createRequireStaffPermission(
      'users.read',
      lookup
    );

    const { req, res, next } = makeRequest({
      user: validUser,
      auth: verifiedAuth,
    });

    await middleware(req, res, next);

    expect(res.statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });

  test('allows verified staff with an authorized assignment', async () => {
    const lookup = jest.fn().mockResolvedValue({
      profile: 'CTO',
      active: true,
    });

    const middleware = createRequireStaffPermission(
      'staff.assign',
      lookup
    );

    const { req, res, next } = makeRequest({
      user: validUser,
      auth: verifiedAuth,
    });

    await middleware(req, res, next);

    expect(lookup).toHaveBeenCalledWith(66);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.staff).toEqual({
      profile: 'CTO',
      permission: 'staff.assign',
    });
  });
});
