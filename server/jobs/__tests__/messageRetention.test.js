import { jest, describe, it, expect, beforeEach } from '@jest/globals';

process.env.MESSAGE_RETENTION_FREE_DAYS = '30';
process.env.MESSAGE_RETENTION_PAID_DAYS = '180';

const mockSchedule = jest.fn();
const mockDeleteMany = jest.fn();

jest.unstable_mockModule('node-cron', () => ({
  __esModule: true,
  default: {
    schedule: mockSchedule,
  },
}));

const prismaPath = new URL('../../utils/prismaClient.js', import.meta.url).pathname;

jest.unstable_mockModule(prismaPath, () => ({
  __esModule: true,
  default: {
    message: {
      deleteMany: mockDeleteMany,
    },
  },
}));

const { startMessageRetentionJob } = await import('../messageRetention.js');

describe('startMessageRetentionJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('schedules the message retention job', () => {
    startMessageRetentionJob();

    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockSchedule).toHaveBeenCalledWith(
      '10 3 * * *',
      expect.any(Function)
    );
  });

  it('deletes old FREE and PLUS/PREMIUM messages when cron runs', async () => {
    mockDeleteMany
      .mockResolvedValueOnce({ count: 3 })
      .mockResolvedValueOnce({ count: 2 });

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    startMessageRetentionJob();

    const cronFn = mockSchedule.mock.calls[0][1];
    await cronFn();

    expect(mockDeleteMany).toHaveBeenCalledTimes(2);

    expect(mockDeleteMany.mock.calls[0][0]).toMatchObject({
      where: {
        createdAt: { lt: expect.any(Date) },
        sender: { plan: 'FREE' },
      },
    });

    expect(mockDeleteMany.mock.calls[1][0]).toMatchObject({
      where: {
        createdAt: { lt: expect.any(Date) },
        sender: { plan: { in: ['PLUS', 'PREMIUM'] } },
      },
    });

    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('logs an error if pruning fails', async () => {
    const err = new Error('DB failed');
    mockDeleteMany.mockRejectedValueOnce(err);

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    startMessageRetentionJob();

    const cronFn = mockSchedule.mock.calls[0][1];
    await cronFn();

    expect(errorSpy).toHaveBeenCalledWith(
      '[MessageRetention] Error while pruning messages:',
      err
    );

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});