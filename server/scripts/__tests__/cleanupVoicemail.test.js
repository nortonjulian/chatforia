/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';

const prisma = {
  user: {
    findMany: jest.fn(),
  },
  voicemail: {
    updateMany: jest.fn(),
  },
  $disconnect: jest.fn(),
};

const mockPrisma = async () => {
  await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
    __esModule: true,
    default: prisma,
  }));
};

describe('cleanupVoicemail script', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    prisma.user.findMany.mockReset();
    prisma.voicemail.updateMany.mockReset();
    prisma.$disconnect.mockReset();

    process.env = { ...originalEnv };
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
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
      await mockPrisma();
      await import('../cleanupVoicemail.js');
    });

    await Promise.resolve();

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        voicemailAutoDeleteDays: {
          not: null,
        },
      },
      select: {
        id: true,
        voicemailAutoDeleteDays: true,
      },
    });

    expect(prisma.voicemail.updateMany).toHaveBeenCalledTimes(1);

    const updateArg = prisma.voicemail.updateMany.mock.calls[0][0];

    expect(updateArg.where.userId).toBe(1);
    expect(updateArg.where.deleted).toBe(false);
    expect(updateArg.where.createdAt.lt).toBeInstanceOf(Date);

    const expectedCutoffMs =
      fixedNow.getTime() - 30 * 24 * 60 * 60 * 1000;

    expect(updateArg.where.createdAt.lt.getTime()).toBe(expectedCutoffMs);

    expect(updateArg.data).toEqual({
      deleted: true,
    });

    expect(logSpy).toHaveBeenCalledWith(
      'User 1: soft-deleted 2 voicemail(s) older than 30 days',
    );

    expect(logSpy).toHaveBeenCalledWith(
      'Voicemail cleanup complete. Total soft-deleted: 2',
    );

    expect(prisma.$disconnect).toHaveBeenCalled();
  });

  test('on error, logs and calls process.exit(1)', async () => {
    prisma.user.findMany.mockRejectedValueOnce(new Error('DB down'));

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    await jest.isolateModulesAsync(async () => {
      await mockPrisma();
      await import('../cleanupVoicemail.js');
    });

    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(prisma.$disconnect).toHaveBeenCalled();
  });
});