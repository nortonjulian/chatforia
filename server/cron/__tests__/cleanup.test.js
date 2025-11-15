import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// --- Mocks & shared state ---
const scheduled = []; // [{ expr, fn, task }]
const scheduleMock = jest.fn((expr, fn) => {
  const task = { stop: jest.fn() };
  scheduled.push({ expr, fn, task });
  return task;
});

// Prisma client mock
const prismaMock = {
  provisionLink: { deleteMany: jest.fn() },
  passwordResetToken: { deleteMany: jest.fn() },
  message: { deleteMany: jest.fn() },
  status: { deleteMany: jest.fn() },
};

const reloadModule = async () => {
  jest.resetModules();

  // reset node-cron scheduling mocks
  scheduleMock.mockClear();
  scheduled.length = 0;

  // reset prisma deleteMany mocks
  Object.values(prismaMock).forEach((m) => m.deleteMany.mockReset());

  // ESM-friendly mocks
  await jest.unstable_mockModule('node-cron', () => ({
    __esModule: true,
    default: {
      schedule: (...args) => scheduleMock(...args),
    },
  }));

  // cleanup.js imports: import prisma from '../utils/prismaClient.js';
  await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
    __esModule: true,
    default: prismaMock,
  }));

  // Import module under test after mocks are in place
  return import('../cleanup.js');
};

const anyDateLT = () =>
  expect.objectContaining({
    lt: expect.any(Date),
  });

describe('cron/cleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('startCleanupJobs schedules hourly job at "5 * * * *"', async () => {
    const mod = await reloadModule();
    mod.startCleanupJobs();

    expect(scheduleMock).toHaveBeenCalledTimes(1);
    expect(scheduled[0].expr).toBe('5 * * * *');
    expect(typeof scheduled[0].fn).toBe('function');
  });

  test('scheduled job deletes expired/used rows across tables & logs counts', async () => {
    const mod = await reloadModule();

    // Set delete counts for all four sections
    prismaMock.provisionLink.deleteMany.mockResolvedValue({ count: 2 });
    prismaMock.passwordResetToken.deleteMany.mockResolvedValue({ count: 3 });
    prismaMock.message.deleteMany.mockResolvedValue({ count: 4 });
    prismaMock.status.deleteMany.mockResolvedValue({ count: 5 });

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    mod.startCleanupJobs();
    // Manually invoke the scheduled callback
    await scheduled[0].fn();

    // ProvisionLinks: OR of expiresAt<now OR usedAt != null
    expect(prismaMock.provisionLink.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { expiresAt: anyDateLT() },
          { usedAt: { not: null } },
        ],
      },
    });

    // PasswordResetTokens: expiresAt<now
    expect(prismaMock.passwordResetToken.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: anyDateLT() },
    });

    // Messages: expiresAt<now
    expect(prismaMock.message.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: anyDateLT() },
    });

    // Statuses: expiresAt<now
    expect(prismaMock.status.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: anyDateLT() },
    });

    // Logs for non-zero counts
    expect(logSpy).toHaveBeenCalledWith('🧹 Deleted 2 expired/used ProvisionLinks');
    expect(logSpy).toHaveBeenCalledWith('🧹 Deleted 3 expired PasswordResetTokens');
    expect(logSpy).toHaveBeenCalledWith('🧹 Deleted 4 expired Messages');
    expect(logSpy).toHaveBeenCalledWith('🧹 Deleted 5 expired Statuses');

    // No warnings/errors on happy path
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  test('scheduled job continues when individual deleteMany throws (warns per section)', async () => {
    const mod = await reloadModule();

    // Make first section throw; others succeed with zero counts (no log lines)
    prismaMock.provisionLink.deleteMany.mockRejectedValue(new Error('boom'));
    prismaMock.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.message.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.status.deleteMany.mockResolvedValue({ count: 0 });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    mod.startCleanupJobs();
    await scheduled[0].fn();

    expect(warnSpy).toHaveBeenCalledWith('[CLEANUP] provisionLink:', 'boom');

    // Other sections still attempted
    expect(prismaMock.passwordResetToken.deleteMany).toHaveBeenCalled();
    expect(prismaMock.message.deleteMany).toHaveBeenCalled();
    expect(prismaMock.status.deleteMany).toHaveBeenCalled();

    // No log lines since all counts are 0
    expect(logSpy).not.toHaveBeenCalled();

    // No outer error
    expect(errSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  test('stopCleanupJobs stops all scheduled tasks', async () => {
    const mod = await reloadModule();

    mod.startCleanupJobs();
    expect(scheduled).toHaveLength(1);
    const stopSpy = scheduled[0].task.stop;

    mod.stopCleanupJobs();

    expect(stopSpy).toHaveBeenCalledTimes(1);
  });
});
