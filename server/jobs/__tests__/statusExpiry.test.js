import { jest } from '@jest/globals';

jest.useFakeTimers();

const prismaMock = {
  status: { findMany: jest.fn(), deleteMany: jest.fn() },
  statusReaction: { deleteMany: jest.fn() },
  statusView: { deleteMany: jest.fn() },
  statusAsset: { deleteMany: jest.fn() },
  statusKey: { deleteMany: jest.fn() },
  $transaction: jest.fn(),
};

// The job module uses PrismaClient from @prisma/client; we mock it,
// but for most tests we call sweepExpiredStatuses with prismaMock directly.
jest.mock('@prisma/client', () => {
  class PrismaClient {
    constructor() {
      return prismaMock;
    }
  }
  return { __esModule: true, PrismaClient };
});

const reload = async () => {
  jest.resetModules();

  // reset nested mocks:
  Object.values(prismaMock.status).forEach((fn) => fn.mockReset());
  Object.values(prismaMock.statusReaction).forEach((fn) => fn.mockReset());
  Object.values(prismaMock.statusView).forEach((fn) => fn.mockReset());
  Object.values(prismaMock.statusAsset).forEach((fn) => fn.mockReset());
  Object.values(prismaMock.statusKey).forEach((fn) => fn.mockReset());
  prismaMock.$transaction.mockReset();

  return import('../statusExpiry.js');
};

const makeIo = () => {
  const roomEmits = new Map();
  return {
    to: (room) => ({
      emit: (event, payload) => {
        const list = roomEmits.get(room) || [];
        list.push({ event, payload });
        roomEmits.set(room, list);
      },
    }),
    _roomEmits: roomEmits,
  };
};

beforeEach(() => {
  jest.clearAllTimers();
  jest.clearAllMocks();
});

describe('sweepExpiredStatuses', () => {
  test('no expired statuses: finds but does not transact or emit', async () => {
    const mod = await reload();
    const { sweepExpiredStatuses } = mod;
    const io = makeIo();

    prismaMock.status.findMany.mockResolvedValueOnce([]);

    await sweepExpiredStatuses(io, prismaMock);

    expect(prismaMock.status.findMany).toHaveBeenCalledWith({
      where: { expiresAt: { lte: expect.any(Date) } },
      select: { id: true, authorId: true },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(io._roomEmits.size).toBe(0);
  });

  test('expired statuses: deletes in a single transaction and emits to authors', async () => {
    const mod = await reload();
    const { sweepExpiredStatuses } = mod;
    const io = makeIo();

    const expired = [
      { id: 11, authorId: 101 },
      { id: 22, authorId: 202 },
    ];
    prismaMock.status.findMany.mockResolvedValueOnce(expired);

    prismaMock.statusReaction.deleteMany.mockResolvedValue({ count: 2 });
    prismaMock.statusView.deleteMany.mockResolvedValue({ count: 2 });
    prismaMock.statusAsset.deleteMany.mockResolvedValue({ count: 2 });
    prismaMock.statusKey.deleteMany.mockResolvedValue({ count: 2 });
    prismaMock.status.deleteMany.mockResolvedValue({ count: 2 });
    prismaMock.$transaction.mockResolvedValue(undefined);

    await sweepExpiredStatuses(io, prismaMock);

    const ids = expired.map((s) => s.id);

    expect(prismaMock.statusReaction.deleteMany).toHaveBeenCalledWith({
      where: { statusId: { in: ids } },
    });
    expect(prismaMock.statusView.deleteMany).toHaveBeenCalledWith({
      where: { statusId: { in: ids } },
    });
    expect(prismaMock.statusAsset.deleteMany).toHaveBeenCalledWith({
      where: { statusId: { in: ids } },
    });
    expect(prismaMock.statusKey.deleteMany).toHaveBeenCalledWith({
      where: { statusId: { in: ids } },
    });
    expect(prismaMock.status.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ids } },
    });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    const txArg = prismaMock.$transaction.mock.calls[0][0];
    expect(Array.isArray(txArg)).toBe(true);
    expect(txArg).toHaveLength(5);

    const room101 = io._roomEmits.get('user:101') || [];
    const room202 = io._roomEmits.get('user:202') || [];
    expect(room101).toEqual([
      { event: 'status_expired', payload: { statusId: 11 } },
    ]);
    expect(room202).toEqual([
      { event: 'status_expired', payload: { statusId: 22 } },
    ]);
  });
});

describe('registerStatusExpiryJob', () => {
  test('respects custom everyMs and swallows sweep errors', async () => {
    const mod = await reload();
    const { registerStatusExpiryJob } = mod;
    const io = makeIo();

    prismaMock.status.findMany
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce([]);

    registerStatusExpiryJob(io, { everyMs: 200 });

    // 1st sweep (error): should not bubble
    await jest.advanceTimersByTimeAsync(200);

    // 2nd sweep (empty)
    await jest.advanceTimersByTimeAsync(200);

    expect(prismaMock.status.findMany).toHaveBeenCalledTimes(2);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(io._roomEmits.size).toBe(0);
  });
});
