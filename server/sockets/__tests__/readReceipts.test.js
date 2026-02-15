import { jest } from '@jest/globals';
import { registerReadReceipts } from '../readReceipts.js';

function makeIo() {
  const rooms = new Map(); // room -> { emit: jest.fn() }
  return {
    to: jest.fn((room) => {
      if (!rooms.has(room)) rooms.set(room, { emit: jest.fn() });
      return rooms.get(room);
    }),
    _room(room) {
      return rooms.get(room);
    },
  };
}

function makeSocket({ userId } = {}) {
  const handlers = new Map();
  return {
    user: userId ? { id: userId } : undefined,
    on: jest.fn((event, cb) => handlers.set(event, cb)),
    emit: jest.fn(),
    _fire(event, payload, ack) {
      const cb = handlers.get(event);
      if (cb) return cb(payload, ack);
    },
    _has(event) {
      return handlers.has(event);
    },
  };
}

function makePrisma() {
  return {
    participant: { findUnique: jest.fn() },
    message: { findUnique: jest.fn() },
    messageRead: { findUnique: jest.fn(), create: jest.fn() },
  };
}

describe('registerReadReceipts', () => {
  test('binds message:read handler', () => {
    const io = makeIo();
    const socket = makeSocket({ userId: 1 });
    const prisma = makePrisma();

    registerReadReceipts(io, socket, { prisma, IS_TEST: true });

    expect(socket._has('message:read')).toBe(true);
  });

  test('no socket.user.id → ack UNAUTHORIZED', async () => {
    const io = makeIo();
    const socket = makeSocket(); // no user
    const prisma = makePrisma();

    registerReadReceipts(io, socket, { prisma, IS_TEST: true });

    const ack = jest.fn();
    await socket._fire('message:read', { roomId: 1, messageId: 10 }, ack);

    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'UNAUTHORIZED' });
  });

  test('bad payload → ack BAD_PAYLOAD', async () => {
    const io = makeIo();
    const socket = makeSocket({ userId: 7 });
    const prisma = makePrisma();

    registerReadReceipts(io, socket, { prisma, IS_TEST: true });

    const ack = jest.fn();
    await socket._fire('message:read', { roomId: 'abc', messageId: 'nope' }, ack);

    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'BAD_PAYLOAD' });
    expect(prisma.participant.findUnique).not.toHaveBeenCalled();
  });

  test('messageId <= 0 → ack ignored true and no DB work', async () => {
    const io = makeIo();
    const socket = makeSocket({ userId: 7 });
    const prisma = makePrisma();

    registerReadReceipts(io, socket, { prisma, IS_TEST: true });

    const ack = jest.fn();
    await socket._fire('message:read', { roomId: 1, messageId: 0 }, ack);

    expect(ack).toHaveBeenCalledWith({ ok: true, ignored: true });
    expect(prisma.participant.findUnique).not.toHaveBeenCalled();
    expect(prisma.message.findUnique).not.toHaveBeenCalled();
    expect(prisma.messageRead.findUnique).not.toHaveBeenCalled();
    expect(prisma.messageRead.create).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });

  test('not a room member → ack FORBIDDEN', async () => {
    const io = makeIo();
    const socket = makeSocket({ userId: 7 });
    const prisma = makePrisma();

    prisma.participant.findUnique.mockResolvedValueOnce(null);

    registerReadReceipts(io, socket, { prisma, IS_TEST: true });

    const ack = jest.fn();
    await socket._fire('message:read', { roomId: 123, messageId: 55 }, ack);

    expect(prisma.participant.findUnique).toHaveBeenCalledWith({
      where: { chatRoomId_userId: { chatRoomId: 123, userId: 7 } },
      select: { userId: true },
    });
    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'FORBIDDEN' });

    expect(prisma.message.findUnique).not.toHaveBeenCalled();
    expect(prisma.messageRead.findUnique).not.toHaveBeenCalled();
    expect(prisma.messageRead.create).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });

  test('message not in room → ack MESSAGE_NOT_IN_ROOM', async () => {
    const io = makeIo();
    const socket = makeSocket({ userId: 7 });
    const prisma = makePrisma();

    prisma.participant.findUnique.mockResolvedValueOnce({ userId: 7 });
    prisma.message.findUnique.mockResolvedValueOnce({ id: 55, chatRoomId: 999 }); // mismatch

    registerReadReceipts(io, socket, { prisma, IS_TEST: true });

    const ack = jest.fn();
    await socket._fire('message:read', { roomId: 123, messageId: 55 }, ack);

    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'MESSAGE_NOT_IN_ROOM' });
    expect(prisma.messageRead.findUnique).not.toHaveBeenCalled();
    expect(prisma.messageRead.create).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });

  test('existing read → ack created false and no broadcast', async () => {
    const io = makeIo();
    const socket = makeSocket({ userId: 7 });
    const prisma = makePrisma();

    prisma.participant.findUnique.mockResolvedValueOnce({ userId: 7 });
    prisma.message.findUnique.mockResolvedValueOnce({ id: 55, chatRoomId: 123 });

    const existingDate = new Date('2026-02-14T20:31:22.123Z');
    prisma.messageRead.findUnique.mockResolvedValueOnce({ readAt: existingDate });

    registerReadReceipts(io, socket, { prisma, IS_TEST: true });

    const ack = jest.fn();
    await socket._fire('message:read', { roomId: 123, messageId: 55 }, ack);

    expect(prisma.messageRead.findUnique).toHaveBeenCalledWith({
      where: { messageId_userId: { messageId: 55, userId: 7 } },
      select: { readAt: true },
    });

    expect(ack).toHaveBeenCalledWith({
      ok: true,
      created: false,
      readAt: existingDate.toISOString(),
    });

    expect(prisma.messageRead.create).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });

  test('new read → creates, broadcasts, ack created true', async () => {
    const io = makeIo();
    const socket = makeSocket({ userId: 7 });
    const prisma = makePrisma();

    prisma.participant.findUnique.mockResolvedValueOnce({ userId: 7 });
    prisma.message.findUnique.mockResolvedValueOnce({ id: 55, chatRoomId: 123 });
    prisma.messageRead.findUnique.mockResolvedValueOnce(null);

    const createdDate = new Date('2026-02-14T20:31:22.123Z');
    prisma.messageRead.create.mockResolvedValueOnce({ readAt: createdDate });

    registerReadReceipts(io, socket, { prisma, IS_TEST: true });

    const ack = jest.fn();
    await socket._fire('message:read', { roomId: 123, messageId: 55 }, ack);

    expect(prisma.messageRead.create).toHaveBeenCalledWith({
      data: { messageId: 55, userId: 7 },
      select: { readAt: true },
    });

    const room = io._room('123');
    expect(room.emit).toHaveBeenCalledWith('message:read', {
      roomId: 123,
      messageId: 55,
      userId: 7,
      readAt: createdDate.toISOString(),
    });

    expect(ack).toHaveBeenCalledWith({
      ok: true,
      created: true,
      readAt: createdDate.toISOString(),
    });
  });

  test('DB throws → ack SERVER_ERROR', async () => {
    const io = makeIo();
    const socket = makeSocket({ userId: 7 });
    const prisma = makePrisma();

    prisma.participant.findUnique.mockRejectedValueOnce(new Error('db down'));

    registerReadReceipts(io, socket, { prisma, IS_TEST: true });

    const ack = jest.fn();
    await socket._fire('message:read', { roomId: 123, messageId: 55 }, ack);

    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'SERVER_ERROR' });
  });
});