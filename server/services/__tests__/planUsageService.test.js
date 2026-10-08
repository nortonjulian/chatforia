import { jest } from '@jest/globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prismaPath = path.resolve(
  __dirname,
  '../../utils/prismaClient.js',
);

const planUsageMock = {
  upsert: jest.fn(),
  findUnique: jest.fn(),
};

const txMock = {
  planUsage: planUsageMock,
  $executeRawUnsafe: jest.fn(),
};

const prismaMock = {
  planUsage: planUsageMock,
  $transaction: jest.fn(async (fn) => fn(txMock)),
  $executeRawUnsafe: jest.fn(),
};

jest.unstable_mockModule(prismaPath, () => ({
  __esModule: true,
  default: prismaMock,
}));

const {
  getMonthKey,
  getMeterLimit,
  getPlanUsage,
  getUsageSummary,
  assertAndConsumeUsage,
  releaseUsage,
} = await import('../planUsageService.js');

beforeEach(() => {
  jest.clearAllMocks();

  planUsageMock.upsert.mockReset();
  planUsageMock.findUnique.mockReset();
  txMock.$executeRawUnsafe.mockReset();
  prismaMock.$executeRawUnsafe.mockReset();

  prismaMock.$transaction.mockImplementation(async (fn) => fn(txMock));
});

describe('planUsageService', () => {
  test('getMonthKey returns YYYY-MM', () => {
    expect(getMonthKey(new Date('2026-10-06T12:00:00Z'))).toBe('2026-10');
  });

  test('getMeterLimit returns direct count limits', () => {
    expect(
      getMeterLimit(
        { riaActions: 200 },
        'riaActions',
      ),
    ).toBe(200);
  });

  test('getMeterLimit converts minute entitlements to seconds', () => {
    expect(
      getMeterLimit(
        { pstnMinutes: 100 },
        'pstnSeconds',
      ),
    ).toBe(6000);
  });

  test('getMeterLimit rejects unknown meters', () => {
    expect(() =>
      getMeterLimit(
        { riaActions: 20 },
        'notARealMeter',
      ),
    ).toThrow('Unknown usage meter');
  });

  test('getPlanUsage upserts current month row', async () => {
    planUsageMock.upsert.mockResolvedValue({
      userId: 7,
      monthKey: '2026-10',
    });

    const result = await getPlanUsage(
      7,
      new Date('2026-10-06T12:00:00Z'),
    );

    expect(planUsageMock.upsert).toHaveBeenCalledWith({
      where: {
        userId_monthKey: {
          userId: 7,
          monthKey: '2026-10',
        },
      },
      update: {},
      create: {
        userId: 7,
        monthKey: '2026-10',
      },
    });

    expect(result.monthKey).toBe('2026-10');
  });

  test('getUsageSummary reports used, limit, and remaining', async () => {
    planUsageMock.upsert.mockResolvedValue({
      userId: 8,
      monthKey: '2026-10',
      riaActions: 5,
      translationChars: 1000,
      hostedParticipantSeconds: 60,
      smsMessages: 2,
      pstnSeconds: 30,
      forwardingSeconds: 0,
      voicemailTranscriptionSeconds: 0,
    });

    const result = await getUsageSummary(
      8,
      'FREE',
      new Date('2026-10-06T12:00:00Z'),
    );

    expect(result.monthKey).toBe('2026-10');
    expect(result.usage.riaActions).toEqual({
      used: 5,
      limit: 20,
      remaining: 15,
    });

    expect(result.usage.pstnSeconds).toEqual({
      used: 30,
      limit: 600,
      remaining: 570,
    });
  });

  test('assertAndConsumeUsage consumes within allowance', async () => {
    planUsageMock.upsert.mockResolvedValue({
      userId: 9,
      monthKey: '2026-10',
    });

    txMock.$executeRawUnsafe.mockResolvedValue(1);

    planUsageMock.findUnique.mockResolvedValue({
      userId: 9,
      monthKey: '2026-10',
      riaActions: 1,
    });

    const result = await assertAndConsumeUsage({
      userId: 9,
      plan: 'FREE',
      meter: 'riaActions',
      amount: 1,
      date: new Date('2026-10-06T12:00:00Z'),
    });

    expect(result).toEqual({
      allowed: true,
      limit: 20,
      used: 1,
      remaining: 19,
    });
  });

  test('assertAndConsumeUsage throws when allowance is exceeded', async () => {
    planUsageMock.upsert.mockResolvedValue({
      userId: 9,
      monthKey: '2026-10',
    });

    txMock.$executeRawUnsafe.mockResolvedValue(0);

    planUsageMock.findUnique.mockResolvedValue({
      userId: 9,
      monthKey: '2026-10',
      riaActions: 20,
    });

    await expect(
      assertAndConsumeUsage({
        userId: 9,
        plan: 'FREE',
        meter: 'riaActions',
        amount: 1,
        date: new Date('2026-10-06T12:00:00Z'),
      }),
    ).rejects.toMatchObject({
      status: 429,
      code: 'PLAN_ALLOWANCE_EXCEEDED',
      detail: 'riaActions',
      limit: 20,
      used: 20,
      remaining: 0,
    });
  });

  test('rejects unknown meter before SQL execution', async () => {
    await expect(
      assertAndConsumeUsage({
        userId: 1,
        plan: 'FREE',
        meter: 'notARealMeter',
        amount: 1,
      }),
    ).rejects.toThrow('Unknown usage meter');

    expect(txMock.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  test('rejects non-positive usage amounts', async () => {
    await expect(
      assertAndConsumeUsage({
        userId: 1,
        plan: 'FREE',
        meter: 'riaActions',
        amount: 0,
      }),
    ).rejects.toThrow('Usage amount must be a positive integer');
  });

  test('releaseUsage returns one reserved action', async () => {
  prismaMock.$executeRawUnsafe.mockResolvedValue(1);

  await releaseUsage({
    userId: 9,
    meter: 'riaActions',
    amount: 1,
    date: new Date('2026-10-06T12:00:00Z'),
  });

  expect(prismaMock.$executeRawUnsafe).toHaveBeenCalledTimes(1);

  const [sql, amount, userId, monthKey] =
    prismaMock.$executeRawUnsafe.mock.calls[0];

    expect(sql).toContain('GREATEST');
    expect(sql).toContain('"riaActions"');
    expect(amount).toBe(1);
    expect(userId).toBe(9);
    expect(monthKey).toBe('2026-10');
  });

  test('releaseUsage rejects an unknown meter', async () => {
    await expect(
      releaseUsage({
        userId: 9,
        meter: 'fakeMeter',
        amount: 1,
      }),
    ).rejects.toThrow('Unknown usage meter');

    expect(prismaMock.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});
