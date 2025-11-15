import { jest } from '@jest/globals';

const ORIGINAL_ENV = { ...process.env };

// ---- Mock @prisma/client ----
// We expose findUniqueMock so tests can control DB results.
let findUniqueMock;

const setupPrismaMock = () => {
  jest.unstable_mockModule('@prisma/client', () => {
    findUniqueMock = jest.fn();

    class PrismaClient {
      constructor() {
        this.user = { findUnique: findUniqueMock };
      }
    }

    // Code under test does:
    //   import pkg from '@prisma/client';
    //   const { PrismaClient } = pkg;
    return {
      __esModule: true,
      default: { PrismaClient },
    };
  });
};

// Register the mock before any imports
setupPrismaMock();

// Helper to reload the middleware with a fresh env
const reloadWithEnv = async (env = {}) => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };

  // Re-register the Prisma mock after resetModules
  setupPrismaMock();

  // Import the module under test (dynamic import required with unstable_mockModule)
  const mod = await import('../requirePremium.js');
  return mod;
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

const makeReqResNext = (overrides = {}) => {
  const req = { user: undefined, ...overrides.req };
  const res = {
    statusCode: 200,
    _json: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this._json = obj;
      return this;
    },
  };
  const next = jest.fn();
  return { req, res, next };
};

describe('requirePremium middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    if (findUniqueMock) {
      findUniqueMock.mockReset();
    }
  });

  test('bypasses entirely when NODE_ENV=test', async () => {
    const { requirePremium } = await reloadWithEnv({ NODE_ENV: 'test' });

    const { req, res, next } = makeReqResNext({ req: { user: { id: 1 } } });

    await requirePremium(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(res._json).toBeNull();
  });

  test('401 when req.user.id is missing', async () => {
    const { requirePremium } = await reloadWithEnv({
      NODE_ENV: 'development',
    });

    const { req, res, next } = makeReqResNext(); // no user

    await requirePremium(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res._json).toEqual({ error: 'Unauthorized' });
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  test('401 when user not found in DB', async () => {
    const { requirePremium } = await reloadWithEnv({
      NODE_ENV: 'development',
    });
    findUniqueMock.mockResolvedValue(null);

    const { req, res, next } = makeReqResNext({
      req: { user: { id: 123 } },
    });

    await requirePremium(req, res, next);

    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { id: 123 },
      select: { plan: true, role: true },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res._json).toEqual({ error: 'Unauthorized' });
  });

  test('next() and sets req.userPlan when role=ADMIN (bypass)', async () => {
    const { requirePremium } = await reloadWithEnv({
      NODE_ENV: 'development',
    });
    findUniqueMock.mockResolvedValue({ role: 'ADMIN', plan: 'FREE' });

    const { req, res, next } = makeReqResNext({
      req: { user: { id: 7 } },
    });

    await requirePremium(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userPlan).toBe('FREE'); // plan propagated even for ADMIN bypass
    expect(res._json).toBeNull();
  });

  test('next() and sets req.userPlan when plan=PREMIUM', async () => {
    const { requirePremium } = await reloadWithEnv({
      NODE_ENV: 'development',
    });
    findUniqueMock.mockResolvedValue({ role: 'USER', plan: 'PREMIUM' });

    const { req, res, next } = makeReqResNext({
      req: { user: { id: 9 } },
    });

    await requirePremium(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userPlan).toBe('PREMIUM');
    expect(res._json).toBeNull();
  });

  test('402 Payment Required when not premium and not admin', async () => {
    const { requirePremium } = await reloadWithEnv({
      NODE_ENV: 'development',
    });
    findUniqueMock.mockResolvedValue({ role: 'USER', plan: 'FREE' });

    const { req, res, next } = makeReqResNext({
      req: { user: { id: 11 } },
    });

    await requirePremium(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(402);
    expect(res._json).toEqual({
      error: 'Payment Required',
      code: 'PREMIUM_REQUIRED',
      message: 'This feature requires a Premium plan.',
    });
  });

  test('500 when prisma throws', async () => {
    const { requirePremium } = await reloadWithEnv({
      NODE_ENV: 'development',
    });

    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    findUniqueMock.mockRejectedValue(new Error('DB down'));

    const { req, res, next } = makeReqResNext({
      req: { user: { id: 99 } },
    });

    await requirePremium(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(500);
    expect(res._json).toEqual({ error: 'Server error' });
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
