/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';

// ✅ Mock prisma client used by the script
// Paths are relative to THIS file: server/scripts/__tests__/cleanupVoicemail.test.js
jest.mock('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: {
    user: {
      findMany: jest.fn(),
    },
    voicemail: {
      updateMany: jest.fn(),
    },
    $disconnect: jest.fn(),
  },
}));

import prisma from '../../utils/prismaClient.js';

describe('cleanupVoicemail script', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules(); // so each test re-runs the script fresh
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('soft-deletes old voicemails according to user settings and disconnects prisma', async () => {
    const fixedNow = new Date('2024-01-31T00:00:00.000Z');
    jest.useFakeTimers().setSystemTime(fixedNow);

    prisma.user.findMany.mockResolvedValueOnce([
      { id: 1, voicemailAutoDeleteDays: 30 },
      { id: 2, voicemailAutoDeleteDays: null },
      { id: 3, voicemailAutoDeleteDays: 0 },
    ]);

    prisma.voicemail.updateMany.mockResolvedValueOnce({ count: 2 });

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await jest.isolateModulesAsync(async () => {
      await import('../cleanupVoicemail.js');
    });

    jest.useRealTimers();

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { voicemailAutoDeleteDays: { not: null } },
      select: { id: true, voicemailAutoDeleteDays: true },
    });

    expect(prisma.voicemail.updateMany).toHaveBeenCalledTimes(1);
    const updateArg = prisma.voicemail.updateMany.mock.calls[0][0];

    expect(updateArg.where.userId).toBe(1);
    expect(updateArg.where.deleted).toBe(false);
    expect(updateArg.where.createdAt.lt).toBeInstanceOf(Date);

    const expectedCutoffMs =
      fixedNow.getTime() - 30 * 24 * 60 * 60 * 1000;
    expect(updateArg.where.createdAt.lt.getTime()).toBe(expectedCutoffMs);

    expect(updateArg.data).toEqual({ deleted: true });

    expect(logSpy).toHaveBeenCalledWith(
      'Voicemail cleanup complete. Total soft-deleted: 2'
    );
    expect(prisma.$disconnect).toHaveBeenCalled();

    logSpy.mockRestore();
  });

  test('on error, logs and calls process.exit(1)', async () => {
    prisma.user.findMany.mockRejectedValueOnce(new Error('DB down'));

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation(() => {});

    await jest.isolateModulesAsync(async () => {
      await import('../cleanupVoicemail.js');
    });

    expect(errorSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
