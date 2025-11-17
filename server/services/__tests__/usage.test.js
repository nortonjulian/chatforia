// server/services/__tests__/usage.test.js
import { jest } from '@jest/globals';

// Freeze time so monthKey() is predictable
const FIXED_DATE = new Date('2025-03-15T12:00:00Z');

// ---- Prisma mock ----
const mockPrisma = {
  sTTUsage: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
  },
};

// ---- Mock prismaClient BEFORE importing usage.js ----
await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: mockPrisma,
}));

// ---- Now import functions under test (note the ../stt path) ----
const { addUsageSeconds, getUsageSeconds } = await import('../stt/usage.js');

describe('stt/usage helpers', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(FIXED_DATE);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('addUsageSeconds upserts with current monthKey and floors increment seconds', async () => {
    const userId = 42;

    await addUsageSeconds(userId, 12.7);

    expect(mockPrisma.sTTUsage.upsert).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.sTTUsage.upsert.mock.calls[0][0];

    // 2025-03 from FIXED_DATE
    expect(arg).toEqual({
      where: {
        userId_monthKey: {
          userId,
          monthKey: '2025-03',
        },
      },
      create: {
        userId,
        monthKey: '2025-03',
        seconds: 12.7, // create uses raw seconds
      },
      update: {
        seconds: {
          increment: 12, // floor(12.7)
        },
      },
    });
  });

  it('addUsageSeconds uses 0 increment for negative seconds', async () => {
    const userId = 7;

    await addUsageSeconds(userId, -5);

    expect(mockPrisma.sTTUsage.upsert).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.sTTUsage.upsert.mock.calls[0][0];

    expect(arg.update.seconds.increment).toBe(0);
  });

  it('getUsageSeconds returns row.seconds when present', async () => {
    const userId = 99;

    mockPrisma.sTTUsage.findUnique.mockResolvedValue({ seconds: 123 });

    const secs = await getUsageSeconds(userId);

    expect(mockPrisma.sTTUsage.findUnique).toHaveBeenCalledWith({
      where: {
        userId_monthKey: {
          userId,
          monthKey: '2025-03',
        },
      },
    });

    expect(secs).toBe(123);
  });

  it('getUsageSeconds returns 0 when row is missing', async () => {
    mockPrisma.sTTUsage.findUnique.mockResolvedValue(null);

    const secs = await getUsageSeconds(5);

    expect(secs).toBe(0);
  });
});
