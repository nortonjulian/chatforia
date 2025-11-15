import { jest } from '@jest/globals';
import cron from 'node-cron';

const ORIGINAL_ENV = process.env;

// --- Prisma mock ---
const prismaMock = {
  user: { findMany: jest.fn() },
  transcript: { deleteMany: jest.fn() },
};

// The job uses PrismaClient directly from @prisma/client, so we mock that
jest.mock('@prisma/client', () => {
  class PrismaClient {
    constructor() {
      return prismaMock; // every new PrismaClient() returns this mock
    }
  }
  return { __esModule: true, PrismaClient };
});

// We'll capture scheduled jobs here
let scheduled = [];

// ✅ Helper: fresh-ish import of the job module each time,
// but WITHOUT jest.resetModules (so our cron spy still applies)
const reload = async () => {
  prismaMock.user.findMany.mockReset();
  prismaMock.transcript.deleteMany.mockReset();
  // dynamic import is fine; module may be cached, but startTranscriptRetentionJob
  // is idempotent to call multiple times
  return import('../transcriptRetention.js');
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

beforeEach(() => {
  // global jest.setup already clears mocks; we also want to reset our local state
  scheduled = [];

  // Spy on cron.schedule so we see what the job registers
  jest.spyOn(cron, 'schedule').mockImplementation((expr, fn) => {
    const task = { stop: jest.fn() };
    scheduled.push({ expr, fn, task });
    return task;
  });
});

afterEach(() => {
  // restore cron.schedule so we don't leak state across tests
  if (jest.isMockFunction(cron.schedule)) {
    cron.schedule.mockRestore();
  }
});

describe('startTranscriptRetentionJob', () => {
  test('schedules cron at 03:10 daily', async () => {
    const mod = await reload();
    mod.startTranscriptRetentionJob();

    expect(cron.schedule).toHaveBeenCalledTimes(1);
    expect(scheduled[0].expr).toBe('10 3 * * *');
    expect(typeof scheduled[0].fn).toBe('function');
  });

  test('deletes all for users with storeTranscripts=false; prunes by cutoff for positive retention; ignores 0/undefined/negative', async () => {
    // Fixed "now" for deterministic cutoff
    const NOW = Date.UTC(2025, 6, 15, 3, 10, 0); // Jul 15, 2025 03:10:00 UTC
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);

    const mod = await reload();
    mod.startTranscriptRetentionJob();

    // Users:
    // u1: store=false -> delete all
    // u2: store=true, retention=30 -> delete where createdAt < NOW - 30d
    // u3: store=true, retention=0 -> no deletion
    // u4: store=true, retention=undefined -> no deletion
    // u5: store=true, retention=-5 -> no deletion
    prismaMock.user.findMany.mockResolvedValue([
      { id: 1, a11yStoreTranscripts: false, a11yTranscriptRetentionDays: 10 },
      { id: 2, a11yStoreTranscripts: true, a11yTranscriptRetentionDays: 30 },
      { id: 3, a11yStoreTranscripts: true, a11yTranscriptRetentionDays: 0 },
      { id: 4, a11yStoreTranscripts: true, a11yTranscriptRetentionDays: undefined },
      { id: 5, a11yStoreTranscripts: true, a11yTranscriptRetentionDays: -5 },
    ]);

    // Run the scheduled function
    expect(scheduled[0]).toBeDefined();
    await scheduled[0].fn();

    // u1: delete all transcripts for user 1
    expect(prismaMock.transcript.deleteMany).toHaveBeenCalledWith({
      where: { userId: 1 },
    });

    // u2: delete older than cutoff
    const cutoff30 = new Date(NOW - 30 * 24 * 60 * 60 * 1000);
    expect(prismaMock.transcript.deleteMany).toHaveBeenCalledWith({
      where: { userId: 2, createdAt: { lt: cutoff30 } },
    });

    // No calls for users 3, 4, 5 beyond the two above
    expect(prismaMock.transcript.deleteMany).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  test('handles empty user list', async () => {
    const mod = await reload();
    mod.startTranscriptRetentionJob();

    prismaMock.user.findMany.mockResolvedValue([]);
    expect(scheduled[0]).toBeDefined();
    await scheduled[0].fn();

    expect(prismaMock.user.findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        a11yStoreTranscripts: true,
        a11yTranscriptRetentionDays: true,
      },
    });
    expect(prismaMock.transcript.deleteMany).not.toHaveBeenCalled();
  });
});
