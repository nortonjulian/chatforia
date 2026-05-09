import { jest } from '@jest/globals';

const ORIGINAL_ENV = process.env;

// ---- Mocks ----
const scheduled = [];

const mockTwilioRemove = jest.fn();
const mockNotifyUserOfPendingRelease = jest.fn();

const prismaMock = {
  phoneNumber: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
  numberReservation: {
    deleteMany: jest.fn(),
  },
};

jest.mock('@prisma/client', () => {
  class PrismaClient {
    constructor() {
      return prismaMock;
    }
  }

  return {
    __esModule: true,
    PrismaClient,
  };
});

jest.mock('../../utils/twilioClient.js', () => ({
  __esModule: true,
  default: {
    incomingPhoneNumbers: jest.fn(() => ({
      remove: mockTwilioRemove,
    })),
  },
}));

jest.mock('../../utils/notifications.js', () => ({
  __esModule: true,
  notifyUserOfPendingRelease: mockNotifyUserOfPendingRelease,
}));

const setupCronSpy = async () => {
  const cron = await import('node-cron');

  jest.spyOn(cron.default, 'schedule').mockImplementation((expr, fn) => {
    const task = { stop: jest.fn() };
    scheduled.push({ expr, fn, task });
    return task;
  });
};

const reload = async (env = {}) => {
  jest.resetModules();

  process.env = {
    ...ORIGINAL_ENV,
    ...env,
  };

  scheduled.length = 0;

  prismaMock.phoneNumber.findMany.mockReset();
  prismaMock.phoneNumber.update.mockReset();
  prismaMock.numberReservation.deleteMany.mockReset();

  mockTwilioRemove.mockReset();
  mockNotifyUserOfPendingRelease.mockReset();
  mockNotifyUserOfPendingRelease.mockResolvedValue(undefined);
  mockTwilioRemove.mockResolvedValue(undefined);

  await setupCronSpy();

  return import('../numberLifecycle.js');
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('startNumberLifecycleJob', () => {
  test('schedules cron at 02:15 daily', async () => {
    const mod = await reload();

    mod.startNumberLifecycleJob();

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].expr).toBe('15 2 * * *');
    expect(typeof scheduled[0].fn).toBe('function');
  });

  test('executes lifecycle: inactive -> HOLD, reusable HOLD -> AVAILABLE, releaseAfter -> RELEASED, and cleans reservations', async () => {
    const INACTIVITY_DAYS = 30;
    const HOLD_DAYS = 14;

    const NOW_MS = Date.UTC(2025, 0, 31, 2, 15, 0);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW_MS);

    const mod = await reload({
      NUMBER_INACTIVITY_DAYS: String(INACTIVITY_DAYS),
      NUMBER_HOLD_DAYS: String(HOLD_DAYS),
    });

    mod.startNumberLifecycleJob();

    expect(scheduled[0]).toBeDefined();

    const run = scheduled[0].fn;

    const inactiveRows = [
      {
        id: 1,
        e164: '+15550000001',
        assignedUserId: 123,
        status: 'ASSIGNED',
        keepLocked: false,
        lastOutboundAt: null,
        assignedUser: {
          id: 123,
          plan: 'FREE',
          email: 'user1@test.com',
        },
      },
      {
        id: 2,
        e164: '+15550000002',
        assignedUserId: 456,
        status: 'ASSIGNED',
        keepLocked: false,
        lastOutboundAt: new Date(
          NOW_MS - (INACTIVITY_DAYS + 1) * 24 * 60 * 60 * 1000
        ),
        assignedUser: {
          id: 456,
          plan: 'FREE',
          email: 'user2@test.com',
        },
      },
    ];

    const reusableHoldRows = [
      {
        id: 3,
        e164: '+15550000003',
        status: 'HOLD',
        holdUntil: new Date(NOW_MS - 1000),
        releaseAfter: null,
        provider: 'twilio',
      },
    ];

    const toReleaseRows = [
      {
        id: 4,
        e164: '+15550000004',
        status: 'HOLD',
        releaseAfter: new Date(NOW_MS - 1000),
        provider: 'twilio',
        twilioSid: 'PN_TEST_123',
      },
    ];

    prismaMock.phoneNumber.findMany
      .mockResolvedValueOnce(inactiveRows)
      .mockResolvedValueOnce(reusableHoldRows)
      .mockResolvedValueOnce(toReleaseRows);

    prismaMock.numberReservation.deleteMany.mockResolvedValueOnce({
      count: 5,
    });

    await run();

    const nowDate = new Date(NOW_MS);

    const cutoff = new Date(
      NOW_MS - INACTIVITY_DAYS * 24 * 60 * 60 * 1000
    );

    const holdUntil = new Date(
      NOW_MS + HOLD_DAYS * 24 * 60 * 60 * 1000
    );

    expect(prismaMock.phoneNumber.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        status: 'ASSIGNED',
        keepLocked: false,
        assignedUser: {
          plan: 'FREE',
        },
        OR: [
          { lastOutboundAt: null },
          { lastOutboundAt: { lt: cutoff } },
        ],
      },
      include: {
        assignedUser: {
          select: {
            id: true,
            plan: true,
            email: true,
          },
        },
      },
    });

    expect(prismaMock.phoneNumber.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        status: 'HOLD',
        holdUntil,
        releaseAfter: null,
      },
    });

    expect(prismaMock.phoneNumber.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: {
        status: 'HOLD',
        holdUntil,
        releaseAfter: null,
      },
    });

    expect(mockNotifyUserOfPendingRelease).toHaveBeenCalledWith(123, {
      number: '+15550000001',
      releaseDate: holdUntil,
    });

    expect(mockNotifyUserOfPendingRelease).toHaveBeenCalledWith(456, {
      number: '+15550000002',
      releaseDate: holdUntil,
    });

    expect(prismaMock.phoneNumber.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        status: 'HOLD',
        holdUntil: { lt: nowDate },
        releaseAfter: null,
        provider: 'twilio',
      },
    });

    expect(prismaMock.phoneNumber.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: {
        status: 'AVAILABLE',
        assignedUserId: null,
        assignedAt: null,
        keepLocked: false,
        holdUntil: null,
        releaseAfter: null,
        lastOutboundAt: null,
        isLeasable: true,
        isPurchasable: true,
      },
    });

    expect(prismaMock.phoneNumber.findMany).toHaveBeenNthCalledWith(3, {
      where: {
        status: 'HOLD',
        releaseAfter: { lt: nowDate },
        provider: 'twilio',
      },
    });

    expect(mockTwilioRemove).toHaveBeenCalledTimes(1);

    expect(prismaMock.phoneNumber.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: {
        status: 'RELEASED',
        assignedUserId: null,
        assignedAt: null,
        keepLocked: false,
        holdUntil: null,
        releaseAfter: null,
      },
    });

    expect(prismaMock.numberReservation.deleteMany).toHaveBeenCalledWith({
      where: {
        expiresAt: { lt: nowDate },
      },
    });

    nowSpy.mockRestore();
  });

  test('respects default envs when not provided', async () => {
    const NOW_MS = Date.UTC(2025, 4, 10, 2, 15, 0);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW_MS);

    const mod = await reload({
      NUMBER_INACTIVITY_DAYS: '',
      NUMBER_HOLD_DAYS: '',
    });

    prismaMock.phoneNumber.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    prismaMock.numberReservation.deleteMany.mockResolvedValueOnce({
      count: 0,
    });

    mod.startNumberLifecycleJob();

    expect(scheduled[0]).toBeDefined();

    await scheduled[0].fn();

    const firstCall = prismaMock.phoneNumber.findMany.mock.calls[0][0];

    const cutoff = firstCall.where.OR[1].lastOutboundAt.lt;

    const expectedCutoff = new Date(
      NOW_MS - 30 * 24 * 60 * 60 * 1000
    );

    expect(+cutoff).toBeCloseTo(+expectedCutoff, -2);

    nowSpy.mockRestore();
  });
});