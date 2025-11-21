import { jest } from '@jest/globals';

// --- Mock prisma client --- //
const prismaMock = {
  mobileDataPackPurchase: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

// Mock prisma module
jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  default: prismaMock,
}));

// --- Mock global setInterval so we don't actually schedule timers --- //
const originalSetInterval = global.setInterval;
const setIntervalMock = jest.fn();
global.setInterval = setIntervalMock;

// Import module under test *after* mocks are in place
const { startTealUsageWorker } = await import('../tealSync.js');

describe('tealSync worker', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();

    process.env = { ...originalEnv };
    delete process.env.ENABLE_TEAL_SYNC;
    delete process.env.TEAL_SYNC_INTERVAL_MS;

    prismaMock.mobileDataPackPurchase.findMany.mockReset();
    prismaMock.mobileDataPackPurchase.update.mockReset();
    setIntervalMock.mockReset();
  });

  afterAll(() => {
    process.env = originalEnv;
    global.setInterval = originalSetInterval;
  });

  it('does nothing and logs disabled when ENABLE_TEAL_SYNC is not "true"', () => {
    process.env.ENABLE_TEAL_SYNC = 'false';

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    startTealUsageWorker();

    expect(logSpy).toHaveBeenCalledWith(
      '[tealSync] Worker disabled (ENABLE_TEAL_SYNC != "true")'
    );

    expect(prismaMock.mobileDataPackPurchase.findMany).not.toHaveBeenCalled();
    expect(prismaMock.mobileDataPackPurchase.update).not.toHaveBeenCalled();
    expect(setIntervalMock).not.toHaveBeenCalled();

    logSpy.mockRestore();
  });

  it('starts worker, performs an initial sync, and schedules periodic syncs when enabled', async () => {
    process.env.ENABLE_TEAL_SYNC = 'true';
    process.env.TEAL_SYNC_INTERVAL_MS = '300000'; // 5 minutes

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const now = new Date();
    const future = new Date(now.getTime() + 60 * 60 * 1000).toISOString(); // +1h

    // One active pack
    prismaMock.mobileDataPackPurchase.findMany.mockResolvedValue([
      {
        id: 1,
        totalDataMb: 1000,
        remainingDataMb: 600,
        expiresAt: future,
      },
    ]);

    prismaMock.mobileDataPackPurchase.update.mockResolvedValue({
      id: 1,
      remainingDataMb: 600,
    });

    startTealUsageWorker();

    // Give the async initial sync a chance to run
    await new Promise((resolve) => setImmediate(resolve));

    // Initial sync should have queried active packs
    expect(prismaMock.mobileDataPackPurchase.findMany).toHaveBeenCalledTimes(1);
    const args = prismaMock.mobileDataPackPurchase.findMany.mock.calls[0][0];
    expect(args.where).toHaveProperty('expiresAt');
    expect(args.where.expiresAt.gt).toBeInstanceOf(Date);

    // Should update remainingDataMb (here it ends up same as before with fake usage)
    expect(prismaMock.mobileDataPackPurchase.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { remainingDataMb: 600 },
    });

    // Worker should be enabled with given interval
    expect(setIntervalMock).toHaveBeenCalledTimes(1);
    const [intervalFn, intervalMs] = setIntervalMock.mock.calls[0];
    expect(typeof intervalFn).toBe('function');
    expect(intervalMs).toBe(300000);

    // Basic log checks
    expect(logSpy).toHaveBeenCalledWith(
      '[tealSync] Worker enabled. Interval = 300s.'
    );
    expect(logSpy).toHaveBeenCalledWith('[tealSync] Starting usage sync…');
    expect(logSpy).toHaveBeenCalledWith('[tealSync] Usage sync complete.');

    logSpy.mockRestore();
  });

  it('continues syncing other packs when one update errors, logging the error', async () => {
    process.env.ENABLE_TEAL_SYNC = 'true';

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const now = new Date();
    const future = new Date(now.getTime() + 60 * 60 * 1000).toISOString();

    prismaMock.mobileDataPackPurchase.findMany.mockResolvedValue([
      {
        id: 10,
        totalDataMb: 1000,
        remainingDataMb: 500,
        expiresAt: future,
      },
      {
        id: 11,
        totalDataMb: 2000,
        remainingDataMb: 1500,
        expiresAt: future,
      },
    ]);

    prismaMock.mobileDataPackPurchase.update
      .mockRejectedValueOnce(new Error('First update failed'))
      .mockResolvedValueOnce({
        id: 11,
        remainingDataMb: 1500,
      });

    startTealUsageWorker();

    await new Promise((resolve) => setImmediate(resolve));

    // Both packs should have been attempted
    expect(prismaMock.mobileDataPackPurchase.update).toHaveBeenCalledTimes(2);

    // Error log for first pack
    expect(errorSpy).toHaveBeenCalledWith(
      '[tealSync] Error syncing pack',
      10,
      expect.any(Error)
    );

    // Second pack still updated successfully
    expect(prismaMock.mobileDataPackPurchase.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { remainingDataMb: 1500 },
    });

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
