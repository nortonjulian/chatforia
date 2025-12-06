jest.mock('node-cron', () => ({
  __esModule: true,
  default: {
    schedule: jest.fn(),
  },
}));

jest.mock('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: {
    message: {
      deleteMany: jest.fn(),
    },
  },
}));

const cron = require('node-cron').default;
const prisma = require('../utils/prismaClient.js').default;

describe('startMessageRetentionJob', () => {
  const ORIGINAL_ENV = process.env;
  let dateNowSpy;
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    jest.resetModules(); // so env + mocks are re-read by the module
    process.env = { ...ORIGINAL_ENV };

    // freeze time: 2025-01-01T03:10:00.000Z
    const fixedNow = new Date('2025-01-01T03:10:00.000Z').getTime();
    dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

    // quiet console + allow assertions
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // reset mocks for cron + prisma
    cron.schedule.mockReset();
    prisma.message.deleteMany.mockReset();
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.env = ORIGINAL_ENV;
  });

  function loadJobModuleWithEnv({ freeDays = 30, paidDays = 180 } = {}) {
    process.env.MESSAGE_RETENTION_FREE_DAYS = String(freeDays);
    process.env.MESSAGE_RETENTION_PAID_DAYS = String(paidDays);

    // re-require so FREE_RETENTION_DAYS / PAID_RETENTION_DAYS get recomputed
    // eslint-disable-next-line global-require
    const { startMessageRetentionJob } = require('./messageRetention.js');
    return { startMessageRetentionJob };
  }

  test('schedules daily job and deletes FREE and paid messages with correct filters', async () => {
    const FREE_DAYS = 10;
    const PAID_DAYS = 20;
    const { startMessageRetentionJob } = loadJobModuleWithEnv({
      freeDays: FREE_DAYS,
      paidDays: PAID_DAYS,
    });

    // arrange cron.schedule to capture the job function
    let scheduledFn;
    cron.schedule.mockImplementation((expr, fn) => {
      scheduledFn = fn;
      return { stop: jest.fn() };
    });

    prisma.message.deleteMany
      .mockResolvedValueOnce({ count: 5 }) // FREE
      .mockResolvedValueOnce({ count: 7 }); // PLUS/PREMIUM

    // act: start job (registers cron schedule)
    startMessageRetentionJob();

    // assert schedule expression and callback
    expect(cron.schedule).toHaveBeenCalledTimes(1);
    expect(cron.schedule).toHaveBeenCalledWith('10 3 * * *', expect.any(Function));
    expect(typeof scheduledFn).toBe('function');

    // run the scheduled job "manually"
    await scheduledFn();

    // compute expected cutoffs based on fixed Date.now and env days
    const nowMs = Date.now();
    const expectedFreeCutoff = new Date(
      nowMs - FREE_DAYS * 24 * 60 * 60 * 1000,
    );
    const expectedPaidCutoff = new Date(
      nowMs - PAID_DAYS * 24 * 60 * 60 * 1000,
    );

    // assertions for prisma calls
    expect(prisma.message.deleteMany).toHaveBeenCalledTimes(2);

    const freeCall = prisma.message.deleteMany.mock.calls[0][0];
    const paidCall = prisma.message.deleteMany.mock.calls[1][0];

    expect(freeCall).toEqual({
      where: {
        createdAt: { lt: expectedFreeCutoff },
        sender: { plan: 'FREE' },
      },
    });

    expect(paidCall).toEqual({
      where: {
        createdAt: { lt: expectedPaidCutoff },
        sender: { plan: { in: ['PLUS', 'PREMIUM'] } },
      },
    });

    // optional: verify logging happens at least once
    expect(logSpy).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('logs an error if deleteMany throws', async () => {
    const { startMessageRetentionJob } = loadJobModuleWithEnv({
      freeDays: 30,
      paidDays: 180,
    });

    let scheduledFn;
    cron.schedule.mockImplementation((expr, fn) => {
      scheduledFn = fn;
      return { stop: jest.fn() };
    });

    prisma.message.deleteMany.mockRejectedValueOnce(
      new Error('DB is down'),
    );

    startMessageRetentionJob();

    await scheduledFn();

    expect(errorSpy).toHaveBeenCalledWith(
      '[MessageRetention] Error while pruning messages:',
      expect.any(Error),
    );

    // Should still log completion
    expect(logSpy).toHaveBeenCalledWith('[MessageRetention] Job complete\n');
  });
});
