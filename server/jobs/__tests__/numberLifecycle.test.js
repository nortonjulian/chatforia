import { jest } from '@jest/globals';

const ORIGINAL_ENV = process.env;

// ---- Mocks ----
const scheduled = [];

// prisma mock for this job
const prismaMock = {
  phoneNumber: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
  numberReservation: {
    deleteMany: jest.fn(),
  },
};

// The job (indirectly) uses PrismaClient from @prisma/client via ../utils/prismaClient.js.
// Mock PrismaClient so any new PrismaClient() returns our prismaMock.
jest.mock('@prisma/client', () => {
  class PrismaClient {
    constructor() {
      return prismaMock;
    }
  }
  return { __esModule: true, PrismaClient };
});

// Helper: set up a spy on node-cron.schedule that records scheduled jobs
const setupCronSpy = async () => {
  const cron = await import('node-cron');
  jest
    .spyOn(cron.default, 'schedule')
    .mockImplementation((expr, fn) => {
      const task = { stop: jest.fn() };
      scheduled.push({ expr, fn, task });
      return task;
    });
};

// ---- Helpers ----
const reload = async (env = {}) => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };

  // reset tracked state
  scheduled.length = 0;
  prismaMock.phoneNumber.findMany.mockReset();
  prismaMock.phoneNumber.update.mockReset();
  prismaMock.numberReservation.deleteMany.mockReset();

  // spy on cron *before* importing the job module
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

    // We intercepted calls via scheduled[]
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].expr).toBe('15 2 * * *');
    expect(typeof scheduled[0].fn).toBe('function');
  });

  test('executes lifecycle: inactive -> HOLD, HOLD past due -> RELEASING, and cleans reservations', async () => {
    // Use explicit env values for easy math
    const INACTIVITY_DAYS = 30;
    const HOLD_DAYS = 14;

    // Fixed "now"
    const NOW_MS = Date.UTC(2025, 0, 31, 2, 15, 0); // Jan 31, 2025 02:15:00 UTC
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW_MS);

    const mod = await reload({
      NUMBER_INACTIVITY_DAYS: String(INACTIVITY_DAYS),
      NUMBER_HOLD_DAYS: String(HOLD_DAYS),
    });

    mod.startNumberLifecycleJob();

    // There should be one scheduled job
    expect(scheduled[0]).toBeDefined();
    const run = scheduled[0].fn;

    // Arrange DB results:
    // Step 1: inactive assigned numbers (two examples)
    const inactiveRows = [
      { id: 1, status: 'ASSIGNED', keepLocked: false, lastOutboundAt: null },
      {
        id: 2,
        status: 'ASSIGNED',
        keepLocked: false,
        lastOutboundAt: new Date(
          NOW_MS - (INACTIVITY_DAYS + 1) * 24 * 60 * 60 * 1000
        ),
      },
    ];
    // Step 2: numbers to release
    const toReleaseRows = [
      { id: 3, status: 'HOLD', releaseAfter: new Date(NOW_MS - 1000) },
    ];

    // phoneNumber.findMany is called twice: [inactive], then [toRelease]
    prismaMock.phoneNumber.findMany
      .mockResolvedValueOnce(inactiveRows)
      .mockResolvedValueOnce(toReleaseRows);

    // Execute the cron callback
    await run();

    // --- Assertions ---

    // Step 1 query: inactive ASSIGNED with keepLocked false and lastOutboundAt null or < cutoff
    const cutoff = new Date(
      NOW_MS - INACTIVITY_DAYS * 24 * 60 * 60 * 1000
    );
    expect(prismaMock.phoneNumber.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        status: 'ASSIGNED',
        keepLocked: false,
        OR: [
          { lastOutboundAt: null },
          { lastOutboundAt: { lt: cutoff } },
        ],
      },
    });

    // Each inactive number should be moved to HOLD with correct holdUntil/releaseAfter
    const holdUntil = new Date(
      NOW_MS + HOLD_DAYS * 24 * 60 * 60 * 1000
    );
    expect(prismaMock.phoneNumber.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        status: 'HOLD',
        holdUntil,
        releaseAfter: holdUntil,
      },
    });
    expect(prismaMock.phoneNumber.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: {
        status: 'HOLD',
        holdUntil,
        releaseAfter: holdUntil,
      },
    });

    // Step 2 query: HOLD with releaseAfter < now
    const nowDate = new Date(NOW_MS);
    expect(prismaMock.phoneNumber.findMany).toHaveBeenNthCalledWith(2, {
      where: { status: 'HOLD', releaseAfter: { lt: nowDate } },
    });

    // Numbers to release: move to RELEASING and clear assignment/hold fields
    expect(prismaMock.phoneNumber.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: {
        status: 'RELEASING',
        assignedUserId: null,
        assignedAt: null,
        keepLocked: false,
        holdUntil: null,
        releaseAfter: null,
      },
    });

    // Step 3: delete expired reservations (expiresAt < now)
    expect(prismaMock.numberReservation.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: nowDate } },
    });

    nowSpy.mockRestore();
  });

  test('respects default envs when not provided', async () => {
    // Defaults: inactivityDays=30, holdDays=14
    const NOW_MS = Date.UTC(2025, 4, 10, 2, 15, 0);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW_MS);

    const mod = await reload({
      NUMBER_INACTIVITY_DAYS: '',
      NUMBER_HOLD_DAYS: '',
    });

    mod.startNumberLifecycleJob();

    expect(scheduled[0]).toBeDefined();
    await scheduled[0].fn();

    // First findMany uses default cutoff = NOW - 30 days
    const firstCall = prismaMock.phoneNumber.findMany.mock.calls[0][0];
    const cutoff = firstCall.where.OR[1].lastOutboundAt.lt;
    const expectedCutoff = new Date(
      NOW_MS - 30 * 24 * 60 * 60 * 1000
    );

    expect(+cutoff).toBeCloseTo(+expectedCutoff, -2); // within a few ms

    nowSpy.mockRestore();
  });
});
