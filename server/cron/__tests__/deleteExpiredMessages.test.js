import { fileURLToPath } from 'node:url';
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

const findManyMock = jest.fn();
const deleteManyMock = jest.fn();

const reload = async () => {
  jest.resetModules();

  findManyMock.mockReset();
  deleteManyMock.mockReset();

  await jest.unstable_mockModule(fileURLToPath(new URL('../../utils/prismaClient.js', import.meta.url)), () => ({
    __esModule: true,
    default: {
      message: {
        findMany: findManyMock,
        deleteMany: deleteManyMock,
      },
    },
  }));

  const mod = await import('../deleteExpiredMessages.js');
  const bus = await import('../../services/socketBus.js');
  bus.setSocketIo(null);
  return { ...mod, setSocketIo: bus.setSocketIo };
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
  let originalSetInterval;
  let originalClearInterval;

  beforeEach(() => {
    jest.clearAllMocks();

    originalSetInterval = global.setInterval;
    originalClearInterval = global.clearInterval;
  });

  afterEach(() => {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  });

  test('uses default interval (10s) and no-ops when nothing expired', async () => {
    const mod = await reload();
    const io = makeIo();
    mod.setSocketIo(io);

    findManyMock.mockResolvedValueOnce([]);

    let intervalCallback;
    const fakeTimerId = 123;
    const clearIntervalMock = jest.fn();

    global.setInterval = jest.fn((cb, ms) => {
      intervalCallback = cb;
      expect(ms).toBe(10_000);
      return fakeTimerId;
    });

    global.clearInterval = clearIntervalMock;

    const { stop } = mod.initDeleteExpired(io);

    expect(global.setInterval).toHaveBeenCalledTimes(1);
    expect(typeof intervalCallback).toBe('function');
    expect(findManyMock).not.toHaveBeenCalled();

    await intervalCallback();

    expect(findManyMock).toHaveBeenCalledWith({
      where: { expiresAt: { lte: expect.any(Date) } },
      select: { id: true, chatRoomId: true, expiresAt: true },
      take: 250,
    });

    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(io._roomEmitMap.size).toBe(0);

    await stop();

    expect(clearIntervalMock).toHaveBeenCalledWith(fakeTimerId);
  });

  test('deletes expired IDs and emits message_expired to each room', async () => {
    const mod = await reload();
    const io = makeIo();
    mod.setSocketIo(io);

    findManyMock
      .mockResolvedValueOnce([
        { id: 1, chatRoomId: 10, expiresAt: new Date(0) },
        { id: 2, chatRoomId: 10, expiresAt: new Date(0) },
        { id: 3, chatRoomId: 77, expiresAt: new Date(0) },
      ])
      .mockResolvedValueOnce([]);

    deleteManyMock.mockResolvedValue({ count: 3 });

    let intervalCallback;
    const fakeTimerId = 456;
    const clearIntervalMock = jest.fn();

    global.setInterval = jest.fn((cb, ms) => {
      intervalCallback = cb;
      expect(ms).toBe(500);
      return fakeTimerId;
    });

    global.clearInterval = clearIntervalMock;

    const { stop } = mod.initDeleteExpired(undefined, 500);

    expect(global.setInterval).toHaveBeenCalledTimes(1);
    expect(typeof intervalCallback).toBe('function');

    await intervalCallback();

    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { id: { in: [1, 2, 3] } },
    });

    const room10 = io._roomEmitMap.get('10') || [];
    const room77 = io._roomEmitMap.get('77') || [];

    const eventsFor = (id, roomId) => ['message:expired', 'message_expired'].map((event) => ({
      event, payload: { id, messageId: id, chatRoomId: roomId, roomId,
        expiresAt: new Date(0).toISOString() },
    }));
    expect(room10).toEqual([...eventsFor(1, 10), ...eventsFor(2, 10)]);
    expect(room77).toEqual(eventsFor(3, 77));

    await intervalCallback();

    expect(deleteManyMock).toHaveBeenCalledTimes(1);

    await stop();

    expect(clearIntervalMock).toHaveBeenCalledWith(fakeTimerId);
  });

  test('stop() clears the interval and prevents further automatic polling', async () => {
    const mod = await reload();
    const io = makeIo();
    mod.setSocketIo(io);

    findManyMock.mockResolvedValue([]);

    let intervalCallback;
    const fakeTimerId = 789;
    const clearIntervalMock = jest.fn();

    global.setInterval = jest.fn((cb, ms) => {
      intervalCallback = cb;
      expect(ms).toBe(200);
      return fakeTimerId;
    });

    global.clearInterval = clearIntervalMock;

    const { stop } = mod.initDeleteExpired(io, 200);

    expect(typeof intervalCallback).toBe('function');

    await intervalCallback();

    expect(findManyMock).toHaveBeenCalledTimes(1);

    await stop();

    expect(clearIntervalMock).toHaveBeenCalledWith(fakeTimerId);
  });
});