import { jest } from '@jest/globals';

// ---- Mocks ----
const ORIGINAL_ENV = { ...process.env };

const prismaMock = {
  user: { findUnique: jest.fn() },
  device: { count: jest.fn() },
};

// Mock premiumConfig with clearly distinct values for easy assertions
const premiumConfigMock = {
  FREE_EXPIRE_MAX_DAYS: 1,      // 1 day   → 86,400s
  PREMIUM_EXPIRE_MAX_DAYS: 30,  // 30 days → 2,592,000s
  FREE_DEVICE_LIMIT: 2,
  PREMIUM_DEVICE_LIMIT: 5,
};

const setupMocks = () => {
  // IMPORTANT: use the same specifiers as limits.js
  // limits.js: import prisma from '../utils/prismaClient.js';
  jest.unstable_mockModule('../utils/prismaClient.js', () => ({
    __esModule: true,
    default: prismaMock,
  }));

  // limits.js: import { premiumConfig } from '../config/premiumConfig.js';
  jest.unstable_mockModule('../config/premiumConfig.js', () => ({
    __esModule: true,
    premiumConfig: premiumConfigMock,
  }));
};

// Register mocks before any imports
setupMocks();

// Fresh import helper so each test sees a clean module instance
const reloadModule = async () => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };

  prismaMock.user.findUnique.mockReset();
  prismaMock.device.count.mockReset();

  // Re-apply mocks after resetModules, before importing the module under test
  setupMocks();

  return import('../limits.js');
};

const makeReqResNext = (overrides = {}) => {
  const req = {
    user: undefined,
    body: {},
    ...overrides.req,
  };
  const res = overrides.res || {};
  const next = jest.fn();
  return { req, res, next };
};

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.user.findUnique.mockReset();
  prismaMock.device.count.mockReset();
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('enforceExpireLimit()', () => {
  test('passes through when no req.user', async () => {
    const { enforceExpireLimit } = await reloadModule();
    const mw = enforceExpireLimit();

    const { req, res, next } = makeReqResNext({
      req: { user: undefined, body: { expireSeconds: 999 } },
    });

    await mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    // No DB lookup
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  test('clamps expireSeconds for FREE plan (max 1 day)', async () => {
    const { enforceExpireLimit } = await reloadModule();
    const mw = enforceExpireLimit();

    prismaMock.user.findUnique.mockResolvedValue({ plan: 'FREE' });

    const { req, res, next } = makeReqResNext({
      req: { user: { id: 10 }, body: { expireSeconds: 200000 } }, // > 1 day
    });

    await mw(req, res, next);

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 10 },
      select: { plan: true },
    });
    // 1 day = 86400
    expect(req.body.expireSeconds).toBe(86400);
    expect(next).toHaveBeenCalled();
  });

  test('clamps expireSeconds for PREMIUM plan (max 30 days) and floors negatives to 0', async () => {
    const { enforceExpireLimit } = await reloadModule();
    const mw = enforceExpireLimit();

    prismaMock.user.findUnique.mockResolvedValue({ plan: 'PREMIUM' });

    // Case A: way over 30 days
    const a = makeReqResNext({
      req: { user: { id: 22 }, body: { expireSeconds: 99999999 } },
    });
    await mw(a.req, a.res, a.next);
    expect(a.req.body.expireSeconds).toBe(30 * 24 * 60 * 60); // 2,592,000
    expect(a.next).toHaveBeenCalled();

    // Case B: negative input -> 0
    const b = makeReqResNext({
      req: { user: { id: 22 }, body: { expireSeconds: -50 } },
    });
    await mw(b.req, b.res, b.next);
    expect(b.req.body.expireSeconds).toBe(0);
    expect(b.next).toHaveBeenCalled();
  });

  test('keeps value when within limits', async () => {
    const { enforceExpireLimit } = await reloadModule();
    const mw = enforceExpireLimit();

    prismaMock.user.findUnique.mockResolvedValue({ plan: 'FREE' });

    const { req, res, next } = makeReqResNext({
      req: { user: { id: 5 }, body: { expireSeconds: 3600 } }, // within 1 day
    });

    await mw(req, res, next);

    expect(req.body.expireSeconds).toBe(3600);
    expect(next).toHaveBeenCalled();
  });

  test('does not touch body when expireSeconds is undefined', async () => {
    const { enforceExpireLimit } = await reloadModule();
    const mw = enforceExpireLimit();

    prismaMock.user.findUnique.mockResolvedValue({ plan: 'FREE' });

    const body = { unrelated: 'x' };
    const { req, res, next } = makeReqResNext({
      req: { user: { id: 3 }, body },
    });

    await mw(req, res, next);

    expect(req.body).toEqual({ unrelated: 'x' });
    expect(next).toHaveBeenCalled();
  });

  test('swallows prisma errors and still calls next()', async () => {
    const { enforceExpireLimit } = await reloadModule();
    const mw = enforceExpireLimit();

    prismaMock.user.findUnique.mockRejectedValue(new Error('db down'));

    const { req, res, next } = makeReqResNext({
      req: { user: { id: 99 }, body: { expireSeconds: 500 } },
    });

    await mw(req, res, next);

    // Not crashing, next still called; value may remain unmodified
    expect(next).toHaveBeenCalled();
  });
});

describe('assertDeviceLimit()', () => {
  test('FREE user under limit → resolves', async () => {
    const { assertDeviceLimit } = await reloadModule();

    prismaMock.user.findUnique.mockResolvedValue({ plan: 'FREE' });
    prismaMock.device.count.mockResolvedValue(1); // FREE limit = 2

    await expect(assertDeviceLimit(101)).resolves.toBeUndefined();

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 101 },
      select: { plan: true },
    });
    expect(prismaMock.device.count).toHaveBeenCalledWith({
      where: { userId: 101 },
    });
  });

  test('FREE user at limit → throws 402 PREMIUM_REQUIRED (DEVICE_LIMIT)', async () => {
    const { assertDeviceLimit } = await reloadModule();

    prismaMock.user.findUnique.mockResolvedValue({ plan: 'FREE' });
    prismaMock.device.count.mockResolvedValue(2); // at FREE limit

    await expect(assertDeviceLimit(202)).rejects.toMatchObject({
      message: 'Device limit reached',
      status: 402,
      code: 'PREMIUM_REQUIRED',
      detail: 'DEVICE_LIMIT',
    });
  });

  test('FREE user over limit → throws', async () => {
    const { assertDeviceLimit } = await reloadModule();

    prismaMock.user.findUnique.mockResolvedValue({ plan: 'FREE' });
    prismaMock.device.count.mockResolvedValue(3); // over limit

    await expect(assertDeviceLimit(203)).rejects.toMatchObject({
      status: 402,
      code: 'PREMIUM_REQUIRED',
      detail: 'DEVICE_LIMIT',
    });
  });

  test('PREMIUM user under/at limit → resolves/throws correctly', async () => {
    const { assertDeviceLimit } = await reloadModule();

    prismaMock.user.findUnique.mockResolvedValue({ plan: 'PREMIUM' });

    // under limit
    prismaMock.device.count.mockResolvedValueOnce(4); // limit = 5
    await expect(assertDeviceLimit(301)).resolves.toBeUndefined();

    // at limit (count >= max → should throw)
    prismaMock.device.count.mockResolvedValueOnce(5);
    await expect(assertDeviceLimit(301)).rejects.toMatchObject({
      status: 402,
      code: 'PREMIUM_REQUIRED',
      detail: 'DEVICE_LIMIT',
    });
  });
});
