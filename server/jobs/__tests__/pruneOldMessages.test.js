// ---- mocks ----
jest.mock('../db.js', () => ({
  __esModule: true,
  prisma: {
    message: {
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock('../config/retention.js', () => {
  // Example: FREE = 30 days, PLUS = 180 days, PREMIUM = unlimited (no limit)
  const MESSAGE_RETENTION_DAYS = {
    FREE: 30,
    PLUS: 180,
    PREMIUM: null, // falsy => should be skipped
  };

  return {
    __esModule: true,
    MESSAGE_RETENTION_DAYS,
  };
});

describe('pruneOldMessages', () => {
  const fixedNow = new Date('2025-01-01T00:00:00.000Z');

  beforeAll(() => {
    // Freeze time so new Date() inside pruneOldMessages is deterministic
    jest.useFakeTimers();
    jest.setSystemTime(fixedNow);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    const { prisma } = require('../db.js');
    prisma.message.deleteMany.mockReset();
  });

  test('deletes messages older than each plan’s retention and skips unlimited plans', async () => {
    const { prisma } = require('../db.js');
    const { pruneOldMessages } = require('./pruneOldMessages.js');

    // We don't really care about the return, but keep it resolved
    prisma.message.deleteMany.mockResolvedValue({ count: 0 });

    await pruneOldMessages();

    // We have FREE and PLUS with limits; PREMIUM is unlimited (null)
    // => should only run deleteMany twice
    expect(prisma.message.deleteMany).toHaveBeenCalledTimes(2);

    const calls = prisma.message.deleteMany.mock.calls;

    // Helper: find the call by plan
    const getCallForPlan = (plan) =>
      calls.find((call) => call[0]?.where?.user?.plan === plan);

    const freeCall = getCallForPlan('FREE');
    const plusCall = getCallForPlan('PLUS');

    expect(freeCall).toBeDefined();
    expect(plusCall).toBeDefined();

    // Check computed cutoffs
    const FREE_DAYS = 30;
    const PLUS_DAYS = 180;
    const baseMs = fixedNow.getTime();

    const expectedFreeCutoffMs =
      baseMs - FREE_DAYS * 24 * 60 * 60 * 1000;
    const expectedPlusCutoffMs =
      baseMs - PLUS_DAYS * 24 * 60 * 60 * 1000;

    const freeCutoff = freeCall[0].where.createdAt.lt;
    const plusCutoff = plusCall[0].where.createdAt.lt;

    expect(freeCutoff).toBeInstanceOf(Date);
    expect(plusCutoff).toBeInstanceOf(Date);

    expect(freeCutoff.getTime()).toBe(expectedFreeCutoffMs);
    expect(plusCutoff.getTime()).toBe(expectedPlusCutoffMs);

    // Sanity: verify where clause structure
    expect(freeCall[0]).toEqual({
      where: {
        createdAt: { lt: freeCutoff },
        user: { plan: 'FREE' },
      },
    });

    expect(plusCall[0]).toEqual({
      where: {
        createdAt: { lt: plusCutoff },
        user: { plan: 'PLUS' },
      },
    });
  });
});
