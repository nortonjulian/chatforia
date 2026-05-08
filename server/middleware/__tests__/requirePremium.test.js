import { jest } from '@jest/globals';

const ORIGINAL_ENV = { ...process.env };

let findUniqueMock;

const setupPrismaMock = () => {
  jest.unstable_mockModule('../utils/prismaClient.js', () => {
    findUniqueMock = jest.fn();

    return {
      __esModule: true,
      default: {
        user: {
          findUnique: findUniqueMock,
        },
      },
    };
  });
};

setupPrismaMock();

const reloadWithEnv = async (env = {}) => {
  jest.resetModules();

  process.env = {
    ...ORIGINAL_ENV,
    ...env,
  };

  setupPrismaMock();

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

    const { req, res, next } = makeReqResNext({
      req: { user: { id: 1 } },
    });

    await requirePremium(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(res._json).toBeNull();
  });

  test('401 when req.user.id is missing', async () => {
    const { requirePremium } = await reloadWithEnv({
      NODE_ENV: 'development',
    });

    const { req, res, next } = makeReqResNext();

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
      select: {
        id: true,
        role: true,
        plan: true,
        subscriptionStatus: true,
        subscriptionEndsAt: true,
      },
    });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res._json).toEqual({ error: 'Unauthorized' });
  });

  test('next() and sets req.userPlan when role=ADMIN bypasses subscription checks', async () => {
    const { requirePremium } = await reloadWithEnv({
      NODE_ENV: 'development',
    });

    findUniqueMock.mockResolvedValue({
      id: 7,
      role: 'ADMIN',
      plan: 'FREE',
      subscriptionStatus: null,
      subscriptionEndsAt: null,
    });

    const { req, res, next } = makeReqResNext({
      req: { user: { id: 7 } },
    });

    await requirePremium(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userPlan).toBe('FREE');
    expect(res._json).toBeNull();
  });

  test('next(), sets req.userPlan, and sets req.userEntitlements when plan=PREMIUM and subscription is ACTIVE', async () => {
    const { requirePremium } = await reloadWithEnv({
      NODE_ENV: 'development',
    });

    const subscriptionEndsAt = new Date(Date.now() + 1000 * 60 * 60 * 24);

    findUniqueMock.mockResolvedValue({
      id: 9,
      role: 'USER',
      plan: 'PREMIUM',
      subscriptionStatus: 'ACTIVE',
      subscriptionEndsAt,
    });

    const { req, res, next } = makeReqResNext({
      req: { user: { id: 9 } },
    });

    await requirePremium(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userPlan).toBe('PREMIUM');

    expect(req.userEntitlements).toEqual({
      plan: 'PREMIUM',
      subscriptionStatus: 'ACTIVE',
      subscriptionEndsAt,
    });

    expect(res._json).toBeNull();
  });

  test('next() when plan=PREMIUM and subscription is TRIALING', async () => {
    const { requirePremium } = await reloadWithEnv({
      NODE_ENV: 'development',
    });

    findUniqueMock.mockResolvedValue({
      id: 10,
      role: 'USER',
      plan: 'PREMIUM',
      subscriptionStatus: 'TRIALING',
      subscriptionEndsAt: null,
    });

    const { req, res, next } = makeReqResNext({
      req: { user: { id: 10 } },
    });

    await requirePremium(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userPlan).toBe('PREMIUM');
    expect(res._json).toBeNull();
  });

  test('402 when subscription is inactive', async () => {
    const { requirePremium } = await reloadWithEnv({
      NODE_ENV: 'development',
    });

    findUniqueMock.mockResolvedValue({
      id: 11,
      role: 'USER',
      plan: 'PREMIUM',
      subscriptionStatus: 'CANCELED',
      subscriptionEndsAt: null,
    });

    const { req, res, next } = makeReqResNext({
      req: { user: { id: 11 } },
    });

    await requirePremium(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(402);
    expect(res._json).toEqual({
      error: 'Payment Required',
      code: 'SUBSCRIPTION_INACTIVE',
      message: 'Your subscription is not active.',
    });
  });

  test('402 when subscription is expired', async () => {
    const { requirePremium } = await reloadWithEnv({
      NODE_ENV: 'development',
    });

    findUniqueMock.mockResolvedValue({
      id: 12,
      role: 'USER',
      plan: 'PREMIUM',
      subscriptionStatus: 'ACTIVE',
      subscriptionEndsAt: new Date(Date.now() - 1000 * 60),
    });

    const { req, res, next } = makeReqResNext({
      req: { user: { id: 12 } },
    });

    await requirePremium(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(402);
    expect(res._json).toEqual({
      error: 'Payment Required',
      code: 'SUBSCRIPTION_INACTIVE',
      message: 'Your subscription is not active.',
    });
  });

  test('402 when subscription is active but plan is not PREMIUM', async () => {
    const { requirePremium } = await reloadWithEnv({
      NODE_ENV: 'development',
    });

    findUniqueMock.mockResolvedValue({
      id: 13,
      role: 'USER',
      plan: 'FREE',
      subscriptionStatus: 'ACTIVE',
      subscriptionEndsAt: null,
    });

    const { req, res, next } = makeReqResNext({
      req: { user: { id: 13 } },
    });

    await requirePremium(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(402);
    expect(res._json).toEqual({
      error: 'Payment Required',
      code: 'PLAN_REQUIRED',
      message: 'This feature requires one of: PREMIUM',
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