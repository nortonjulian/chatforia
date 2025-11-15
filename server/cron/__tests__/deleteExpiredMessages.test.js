import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// Global mocks for Prisma methods
const findManyMock = jest.fn();
const deleteManyMock = jest.fn();
const disconnectMock = jest.fn();

/**
 * Reloads the module under test with:
 * - fresh Prisma mocks
 * - ESM-friendly mock for '@prisma/client'
 */
const reload = async () => {
  jest.resetModules();

  findManyMock.mockReset();
  deleteManyMock.mockReset();
  disconnectMock.mockReset();

  // Mock @prisma/client in an ESM-friendly way
  await jest.unstable_mockModule('@prisma/client', () => {
    class PrismaClient {
      constructor() {
        this.message = {
          findMany: findManyMock,
          deleteMany: deleteManyMock,
        };
        this.$disconnect = disconnectMock;
      }
    }

    // deleteExpiredMessages.js does:
    //   import pkg from '@prisma/client';
    //   const { PrismaClient } = pkg;
    // so default export must be an object with { PrismaClient }
    return {
      __esModule: true,
      default: { PrismaClient },
    };
  });

  // Import the module under test (will see mocked Prisma)
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
    jest.clearAllMocks();
  });

  test('uses default interval (10s) and no-ops when nothing expired', async () => {
    const mod = await reload();
    const io = makeIo();

    // First tick returns empty
    findManyMock.mockResolvedValueOnce([]);

    // Capture the interval callback when initDeleteExpired sets it up
    let intervalCallback;
    const originalSetInterval = global.setInterval;
    global.setInterval = (cb, ms) => {
      intervalCallback = cb;
      return 1; // fake timer id
    };

    const { stop } = mod.initDeleteExpired(io); // default 10_000 ms

    // Restore real setInterval
    global.setInterval = originalSetInterval;

    expect(typeof intervalCallback).toBe('function');

    // No calls before "interval" runs
    expect(findManyMock).not.toHaveBeenCalled();

    // Manually invoke the captured interval callback
    await intervalCallback();

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

    // Capture interval callback around initDeleteExpired
    let intervalCallback;
    const originalSetInterval = global.setInterval;
    global.setInterval = (cb, ms) => {
      intervalCallback = cb;
      return 1;
    };

    const { stop } = mod.initDeleteExpired(io, 500); // intervalMs irrelevant now

    global.setInterval = originalSetInterval;

    expect(typeof intervalCallback).toBe('function');

    // First tick
    await intervalCallback();

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
    await intervalCallback();
    expect(deleteManyMock).toHaveBeenCalledTimes(1);

    await stop();
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  test('stop() clears the interval and prevents further polls (via disconnect)', async () => {
    const mod = await reload();
    const io = makeIo();

    findManyMock.mockResolvedValue([]); // always empty for simplicity

    let intervalCallback;
    const originalSetInterval = global.setInterval;
    global.setInterval = (cb, ms) => {
      intervalCallback = cb;
      return 1;
    };

    const { stop } = mod.initDeleteExpired(io, 200);

    global.setInterval = originalSetInterval;

    expect(typeof intervalCallback).toBe('function');

    // one tick
    await intervalCallback();
    expect(findManyMock).toHaveBeenCalledTimes(1);

    // stop should disconnect prisma
    await stop();
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });
});
