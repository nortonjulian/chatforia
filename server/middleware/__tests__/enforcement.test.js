import { jest } from '@jest/globals';

const reload = async () => {
  jest.resetModules();
  return import('../enforcement.js');
};

const makeReqResNext = (overrides = {}) => {
  const req = { user: undefined, ...overrides.req };
  const res = {
    statusCode: 200,
    _json: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this._json = obj; return this; },
  };
  const next = jest.fn();
  return { req, res, next };
};

describe('enforcement middlewares', () => {
  test('requireEmailVerified: 403 when missing, next() when present', async () => {
    const { requireEmailVerified } = await reload();

    // Missing
    {
      const { req, res, next } = makeReqResNext({ req: { user: { id: 1 } } });
      requireEmailVerified(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
      expect(res._json).toEqual({ ok: false, reason: 'email_verification_required' });
    }

    // Present
    {
      const { req, res, next } = makeReqResNext({
        req: { user: { id: 1, emailVerifiedAt: new Date().toISOString() } },
      });
      requireEmailVerified(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    }
  });

  test('requirePhoneVerified: 403 when missing, next() when present', async () => {
    const { requirePhoneVerified } = await reload();

    // Missing
    {
      const { req, res, next } = makeReqResNext({ req: { user: { id: 2 } } });
      requirePhoneVerified(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
      expect(res._json).toEqual({ ok: false, reason: 'phone_verification_required' });
    }

    // Present
    {
      const { req, res, next } = makeReqResNext({
        req: { user: { id: 2, phoneVerifiedAt: Date.now() } },
      });
      requirePhoneVerified(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    }
  });

  describe('requireStaff2FA', () => {
    test('403 when STAFF (ADMIN/MOD/STAFF) without 2FA', async () => {
      const { requireStaff2FA } = await reload();

      for (const role of ['ADMIN', 'MOD', 'STAFF']) {
        const { req, res, next } = makeReqResNext({
          req: { user: { id: 3, role, twoFactorEnabled: false } },
        });
        requireStaff2FA(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res._json).toEqual({ ok: false, reason: '2fa_required' });
      }
    });

    test('next() when STAFF has 2FA enabled', async () => {
      const { requireStaff2FA } = await reload();

      const { req, res, next } = makeReqResNext({
        req: { id: 4, user: { role: 'ADMIN', twoFactorEnabled: true } },
      });
      requireStaff2FA(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    test('next() when non-staff regardless of 2FA', async () => {
      const { requireStaff2FA } = await reload();

      const { req, res, next } = makeReqResNext({
        req: { user: { id: 5, role: 'USER', twoFactorEnabled: false } },
      });
      requireStaff2FA(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('requirePremium (paywall)', () => {
    test('402 when plan is not PREMIUM (handles missing/undefined)', async () => {
      const { requirePremium } = await reload();

      // No plan -> default FREE path
      {
        const { req, res, next } = makeReqResNext({ req: { user: { id: 6 } } });
        requirePremium(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(402);
        expect(res._json).toEqual({ ok: false, reason: 'premium_required' });
      }

      // Explicit FREE
      {
        const { req, res, next } = makeReqResNext({ req: { user: { id: 6, plan: 'FREE' } } });
        requirePremium(req, res, next);
        expect(res.statusCode).toBe(402);
      }
    });

    test('next() when plan is PREMIUM (case-insensitive)', async () => {
      const { requirePremium } = await reload();

      // exact
      {
        const { req, res, next } = makeReqResNext({
          req: { user: { id: 7, plan: 'PREMIUM' } },
        });
        requirePremium(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
      }

      // lower-case variant should still pass
      {
        const { req, res, next } = makeReqResNext({
          req: { user: { id: 8, plan: 'premium' } },
        });
        requirePremium(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
      }
    });
  });
});
