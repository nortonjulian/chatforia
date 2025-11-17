import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
} from '@jest/globals';

// Import the middleware under test from the server tree
const { requirePremium } = await import('../../server/middleware/plan.js');

function makeRes() {
  return {
    status: jest.fn(function (code) {
      this._status = code;
      return this;
    }),
    json: jest.fn(function (body) {
      this._body = body;
      return this;
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('requirePremium middleware', () => {
  test('allows ADMIN regardless of plan', () => {
    const req = { user: { id: 1, role: 'ADMIN', plan: 'FREE' } };
    const res = makeRes();
    const next = jest.fn();

    requirePremium(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  test('allows when plan is PRO/PREMIUM/PLUS (case insensitive)', () => {
    const plans = ['pro', 'PREMIUM', 'Plus'];

    for (const plan of plans) {
      const req = { user: { id: 2, role: 'USER', plan } };
      const res = makeRes();
      const next = jest.fn();

      requirePremium(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    }
  });

  test('allows when plan object has isPremium true', () => {
    const req = { user: { id: 3, role: 'USER', plan: { isPremium: true } } };
    const res = makeRes();
    const next = jest.fn();

    requirePremium(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  test('falls back to subscription when plan is missing (string case)', () => {
    const req = { user: { id: 4, role: 'USER', subscription: 'pro' } };
    const res = makeRes();
    const next = jest.fn();

    requirePremium(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  test('falls back to subscription when plan is missing (object case)', () => {
    const req = { user: { id: 5, role: 'USER', subscription: { isPremium: true } } };
    const res = makeRes();
    const next = jest.fn();

    requirePremium(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  test('non-premium user still calls next (current behavior)', () => {
    const req = { user: { id: 6, role: 'USER', plan: 'FREE' } };
    const res = makeRes();
    const next = jest.fn();

    requirePremium(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    // No 402 response is sent by the current implementation
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  test('missing user still calls next (current behavior)', () => {
    const req = {}; // no user
    const res = makeRes();
    const next = jest.fn();

    requirePremium(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
