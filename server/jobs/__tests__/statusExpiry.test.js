jest.useFakeTimers();

const prismaMock = {
  status: { findMany: jest.fn(), deleteMany: jest.fn() },
  statusReaction: { deleteMany: jest.fn() },
  statusView: { deleteMany: jest.fn() },
  statusAsset: { deleteMany: jest.fn() },
  statusKey: { deleteMany: jest.fn() },
  $transaction: jest.fn(),
};

// The module imports a *named* export { prisma }
jest.mock('../../utils/prismaClient.js', () => ({
  __esModule: true,
  prisma: prismaMock,
}));

const reload = async () => {
  jest.resetModules();
  Object.values(prismaMock).forEach((v) => {
    if (typeof v === 'function') return;
    Object.values(v).forEach((fn) => fn.mockReset());
  });
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

describe('registerStatusExpiryJob', () => {
  test('no expired statuses: finds but does not transact or emit', async () => {
    const mod = await reload();
    const io = makeIo();

    prismaMock.status.findMany.mockResolvedValueOnce([]);

    mod.registerStatusExpiryJob(io, { everyMs: 1_000 });

    // trigger one sweep
    jest.advanceTimersByTime(1_000);

    expect(prismaMock.status.findMany).toHaveBeenCalledWith({
      where: { expiresAt: { lte: expect.any(Date) } },
      select: { id: true, authorId: true },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(io._roomEmits.size).toBe(0);
  });

  test('expired statuses: deletes in a single transaction and emits to authors', async () => {
    const mod = await reload();
    const io = makeIo();

    const expired = [
      { id: 11, authorId: 101 },
      { id: 22, authorId: 202 },
    ];
    prismaMock.status.findMany.mockResolvedValueOnce(expired);

    // provide dummy returns for deleteMany calls (not strictly needed)
    prismaMock.statusReaction.deleteMany.mockResolvedValue({ count: 2 });
    prismaMock.statusView.deleteMany.mockResolvedValue({ count: 2 });
    prismaMock.statusAsset.deleteMany.mockResolvedValue({ count: 2 });
    prismaMock.statusKey.deleteMany.mockResolvedValue({ count: 2 });
    prismaMock.status.deleteMany.mockResolvedValue({ count: 2 });
    prismaMock.$transaction.mockResolvedValue(undefined);

    mod.registerStatusExpiryJob(io, { everyMs: 500 });

    jest.advanceTimersByTime(500);

    // each deleteMany called with the list of expired IDs
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

    // The five operations are wrapped in a single transaction
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    const txArg = prismaMock.$transaction.mock.calls[0][0];
    expect(Array.isArray(txArg)).toBe(true);
    expect(txArg).toHaveLength(5);

    // Emits one event per expired status to the author's room
    const room101 = io._roomEmits.get('user:101') || [];
    const room202 = io._roomEmits.get('user:202') || [];
    expect(room101).toEqual([{ event: 'status_expired', payload: { statusId: 11 } }]);
    expect(room202).toEqual([{ event: 'status_expired', payload: { statusId: 22 } }]);
  });

  test('respects custom everyMs and swallows sweep errors', async () => {
    const mod = await reload();
    const io = makeIo();

    // First sweep throws; second sweep returns empty
    prismaMock.status.findMany
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce([]);

    mod.registerStatusExpiryJob(io, { everyMs: 200 });

    // 1st sweep (error): should not throw out of the interval
    expect(() => jest.advanceTimersByTime(200)).not.toThrow();

    // 2nd sweep (empty)
    jest.advanceTimersByTime(200);

    // Called twice
    expect(prismaMock.status.findMany).toHaveBeenCalledTimes(2);
    // Still no transaction or emits
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(io._roomEmits.size).toBe(0);
  });
});
