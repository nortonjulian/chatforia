jest.useFakeTimers();

let findManyMock;
let deleteManyMock;
let disconnectMock;

jest.mock('@prisma/client', () => {
  findManyMock = jest.fn();
  deleteManyMock = jest.fn();
  disconnectMock = jest.fn();

  class PrismaClient {
    constructor() {
      this.message = {
        findMany: findManyMock,
        deleteMany: deleteManyMock,
      };
      this.$disconnect = disconnectMock;
    }
  }
  return { __esModule: true, default: { PrismaClient } };
});

const reload = async () => {
  jest.resetModules();
  // reset mocks between imports
  findManyMock.mockReset();
  deleteManyMock.mockReset();
  disconnectMock.mockReset();
  return import('../deleteExpiredMessages.js');
};

const makeIo = () => {
  const roomEmitMap = new Map();
  return {
    to: (room) => ({
      emit: (event, payload) => {
        const arr = roomEmitMap.get(room) || [];
        arr.push({ event, payload });
        roomEmitMap.set(room, arr);
      },
    }),
    _roomEmitMap: roomEmitMap,
  };
};

describe('initDeleteExpired', () => {
  beforeEach(() => {
    jest.clearAllTimers();
    jest.clearAllMocks();
  });

  test('uses default interval (10s) and no-ops when nothing expired', async () => {
    const mod = await reload();
    const io = makeIo();

    // First tick returns empty
    findManyMock.mockResolvedValueOnce([]);

    const { stop } = mod.initDeleteExpired(io); // default 10_000 ms

    // No calls before timers run
    expect(findManyMock).not.toHaveBeenCalled();

    // Advance exactly one tick
    jest.advanceTimersByTime(10_000);

    // One poll occurred
    expect(findManyMock).toHaveBeenCalledWith({
      where: { expiresAt: { lte: expect.any(Date) } },
      select: { id: true, chatRoomId: true },
      take: 250,
    });

    // No deletes, no emits
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(io._roomEmitMap.size).toBe(0);

    await stop();
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  test('deletes expired IDs and emits message_expired to each room', async () => {
    const mod = await reload();
    const io = makeIo();

    // First interval: 3 expired messages
    findManyMock
      .mockResolvedValueOnce([
        { id: 1, chatRoomId: 10 },
        { id: 2, chatRoomId: 10 },
        { id: 3, chatRoomId: 77 },
      ])
      // Second interval: nothing
      .mockResolvedValueOnce([]);

    deleteManyMock.mockResolvedValue({ count: 3 });

    const { stop } = mod.initDeleteExpired(io, 500); // faster interval for test

    // First tick
    jest.advanceTimersByTime(500);

    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { id: { in: [1, 2, 3] } },
    });

    // Emissions grouped by room
    const room10 = io._roomEmitMap.get('10') || [];
    const room77 = io._roomEmitMap.get('77') || [];

    expect(room10).toEqual([
      { event: 'message_expired', payload: { id: 1 } },
      { event: 'message_expired', payload: { id: 2 } },
    ]);
    expect(room77).toEqual([
      { event: 'message_expired', payload: { id: 3 } },
    ]);

    // Second tick (no expired) should not call deleteMany again
    jest.advanceTimersByTime(500);
    expect(deleteManyMock).toHaveBeenCalledTimes(1);

    await stop();
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  test('stop() clears the interval and prevents further polls', async () => {
    const mod = await reload();
    const io = makeIo();

    findManyMock.mockResolvedValue([]); // always empty for simplicity

    const { stop } = mod.initDeleteExpired(io, 200);

    // one tick
    jest.advanceTimersByTime(200);
    expect(findManyMock).toHaveBeenCalledTimes(1);

    // stop and advance—should not call again
    await stop();
    jest.advanceTimersByTime(1000);
    expect(findManyMock).toHaveBeenCalledTimes(1); // unchanged
  });
});
