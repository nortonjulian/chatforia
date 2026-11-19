import { describe, expect, jest, test } from '@jest/globals';
import {
  assertRandomRoomWritable,
  disconnectRandomSocket,
  endRandomRoom,
  randomChatGraceMs,
  randomResumeRequestId,
  requireRandomChatProtocol,
  resumeRandomRoom,
  sweepExpiredRandomRooms,
} from '../services/randomChatLifecycle.js';
import { areCompatible, buildQueues } from '../services/randomChatService.js';
import { anonymousMessage, anonymousParticipants } from '../utils/randomChatPresentation.js';

function fixture() {
  const room = {
    id: 10, chatRoomId: 20, endedAt: null, unlockedAt: null,
    aliasByUser: { '1': 'Quiet Signal 1000', '2': 'Bright Wave 2000' },
    participants: [{ id: 1 }, { id: 2 }],
    connections: [1, 2].map((userId) => ({
      randomChatRoomId: 10, userId, active: true,
      socketId: `old-${userId}`, lastSeenAt: new Date(), disconnectedAt: null,
    })),
  };
  const updateConnections = async ({ where, data }) => {
    const rows = room.connections.filter((row) =>
      (where.randomChatRoomId == null || row.randomChatRoomId === where.randomChatRoomId) &&
      (where.userId == null || row.userId === where.userId) &&
      (where.socketId == null || row.socketId === where.socketId) &&
      (where.active == null || row.active === where.active));
    rows.forEach((row) => Object.assign(row, data));
    return { count: rows.length };
  };
  const prisma = {
    randomChatRoom: {
      findFirst: async ({ where }) => room.endedAt || room.unlockedAt ||
        !room.connections.some((row) => row.userId === where.connections.some.userId && row.active)
        ? null : room,
      findUnique: async ({ where }) => where.chatRoomId === room.chatRoomId ? room : null,
      findMany: async () => [room],
      updateMany: async ({ where, data }) => {
        if (room.id !== where.id || room.endedAt || room.unlockedAt) return { count: 0 };
        Object.assign(room, data);
        return { count: 1 };
      },
    },
    randomChatConnection: {
      updateMany: updateConnections,
      findUnique: async ({ where }) => room.connections.find((row) =>
        row.userId === where.randomChatRoomId_userId.userId) || null,
    },
    userBlock: { findFirst: jest.fn(async () => null) },
    $transaction: async (fn) => fn(prisma),
  };
  const emitted = [];
  const sockets = new Map();
  const io = {
    sockets: { sockets },
    to: (target) => ({ emit: (event, payload) => emitted.push({ target, event, payload }) }),
  };
  const makeSocket = (id) => ({ id, join: jest.fn(), emit: jest.fn(), leave: jest.fn() });
  return { room, prisma, io, emitted, sockets, makeSocket, queues: buildQueues() };
}

describe('server-authoritative Random Chat lifecycle', () => {
  test('protocol gate rejects legacy, malformed and unsupported values without granting room authority', () => {
    const f = fixture();
    const socket = f.makeSocket('legacy');
    for (const value of [undefined, null, '2', 1, 3, true, {}, [2]]) {
      expect(requireRandomChatProtocol(socket, { requestId: 'join_1', randomChatProtocol: value })).toBe(false);
    }
    expect(socket.emit).toHaveBeenCalledTimes(8);
    expect(socket.emit).toHaveBeenCalledWith('random:error', {
      code: 'UPDATE_REQUIRED', message: 'Update Chatforia to use Random Chat.',
      requiredProtocol: 2, requestId: 'join_1',
    });
    expect(f.queues.waitingBySocket.size).toBe(0);
    expect(f.room.connections.map((entry) => entry.socketId)).toEqual(['old-1', 'old-2']);
    expect(requireRandomChatProtocol(socket, { randomChatProtocol: 2 })).toBe(true);
    expect(socket.emit).toHaveBeenCalledTimes(8);
  });
  test('defaults to 120 seconds and rejects out-of-range settings', () => {
    const previous = process.env.RANDOM_CHAT_RECONNECT_GRACE_MS;
    try {
      delete process.env.RANDOM_CHAT_RECONNECT_GRACE_MS;
      expect(randomChatGraceMs()).toBe(120000);
      process.env.RANDOM_CHAT_RECONNECT_GRACE_MS = '99999999';
      expect(randomChatGraceMs()).toBe(120000);
      process.env.RANDOM_CHAT_RECONNECT_GRACE_MS = '60000';
      expect(randomChatGraceMs()).toBe(60000);
    } finally {
      if (previous == null) delete process.env.RANDOM_CHAT_RECONNECT_GRACE_MS;
      else process.env.RANDOM_CHAT_RECONNECT_GRACE_MS = previous;
    }
  });
  test('restores only the authenticated participant with their own alias', async () => {
    const f = fixture();
    const socket = f.makeSocket('new-1');
    f.sockets.set(socket.id, socket);
    const restored = await resumeRandomRoom({ ...f, socket, userId: 1,
      requestId: 'fresh_1', roomId: 9999 });
    expect(restored).toMatchObject({
      roomId: 20, requestId: 'fresh_1',
      myAlias: 'Quiet Signal 1000', partnerAlias: 'Bright Wave 2000',
    });
    expect(socket.join).toHaveBeenCalledWith('random:20');
    expect(await resumeRandomRoom({ ...f, socket: f.makeSocket('intruder'), userId: 3 })).toBeNull();
  });

  test('resume correlation accepts bounded IDs and grants no room authority', () => {
    expect(randomResumeRequestId({ requestId: 'ios_123-ABC' })).toBe('ios_123-ABC');
    for (const value of [null, 'a'.repeat(81), 'bad:room', 'room/20', 20]) {
      expect(randomResumeRequestId({ requestId: value })).toBeNull();
    }
  });

  test('temporary disconnect preserves the room; stale socket cannot evict a newer binding', async () => {
    const f = fixture();
    await disconnectRandomSocket({ ...f, socketId: 'old-1', userId: 1 });
    expect(f.room.endedAt).toBeNull();
    expect(f.emitted).toContainEqual(expect.objectContaining({ event: 'random:peer_reconnecting' }));
    const socket = f.makeSocket('new-1');
    await resumeRandomRoom({ ...f, socket, userId: 1 });
    await disconnectRandomSocket({ ...f, socketId: 'old-1', userId: 1 });
    expect(f.room.connections[0].socketId).toBe('new-1');
  });

  test('two authenticated sockets for one user leave only the newest socket bound', async () => {
    const f = fixture();
    const first = f.makeSocket('first-1');
    const second = f.makeSocket('second-1');
    f.sockets.set(first.id, first);
    f.sockets.set(second.id, second);
    await resumeRandomRoom({ ...f, socket: first, userId: 1 });
    await resumeRandomRoom({ ...f, socket: second, userId: 1 });
    expect(first.leave).toHaveBeenCalledWith('random:20');
    expect(f.queues.activeRoomBySocket.has(first.id)).toBe(false);
    expect(f.queues.activeRoomBySocket.get(second.id).userId).toBe(1);
    await disconnectRandomSocket({ ...f, socketId: first.id, userId: 1 });
    expect(f.room.connections[0].socketId).toBe(second.id);
  });

  test('timeout ends once and prevents replay or writes', async () => {
    const f = fixture();
    const old = new Date(Date.now() - 121000);
    f.room.connections[0].disconnectedAt = old;
    f.room.connections[0].lastSeenAt = old;
    await sweepExpiredRandomRooms(f.prisma, f.io);
    expect(f.room.endedReason).toBe('reconnect_timeout');
    expect(await resumeRandomRoom({ ...f, socket: f.makeSocket('new-1'), userId: 1 })).toBeNull();
    await expect(assertRandomRoomWritable(f.prisma, 20, 1, { '1': {}, '2': {} }))
      .rejects.toThrow();
    expect(await endRandomRoom({ ...f, room: f.room, reason: 'peer_left' })).toBe(false);
  });

  test('encrypted writes require payloads for exactly the matched identities', async () => {
    const f = fixture();
    await expect(assertRandomRoomWritable(f.prisma, 20, 1, { '1': {}, '2': {} }))
      .resolves.toBe(f.room);
    await expect(assertRandomRoomWritable(f.prisma, 20, 1, { '1': {}, '3': {} }))
      .rejects.toThrow();
    await expect(assertRandomRoomWritable(f.prisma, 20, 3, { '1': {}, '2': {} }))
      .rejects.toThrow();
  });

  test('blocked users cannot resume; teen and adult candidates never match', async () => {
    const f = fixture();
    f.prisma.userBlock.findFirst.mockResolvedValue({ id: 5 });
    expect(await resumeRandomRoom({ ...f, socket: f.makeSocket('new-1'), userId: 1 })).toBeNull();
    expect(f.room.endedReason).toBe('account_blocked');
    expect(areCompatible(
      { userId: 1, ageBand: 'TEEN_13_17' },
      { userId: 2, ageBand: 'ADULT_18_24' }
    )).toBe(false);
  });

  test('explicit Leave and Next end once with participant-specific reasons', async () => {
    for (const reason of ['peer_left', 'peer_skipped']) {
      const f = fixture();
      expect(await endRandomRoom({ ...f, room: f.room, reason, endedById: 1 })).toBe(true);
      expect(f.emitted.filter((event) => event.event === 'random:ended')).toHaveLength(2);
      expect(f.emitted.find((event) => event.target === 'user:2').payload.reason).toBe(reason);
      expect(f.emitted.find((event) => event.target === 'user:1').payload.reason)
        .toBe(reason === 'peer_skipped' ? 'you_skipped' : 'you_left');
      expect(await endRandomRoom({ ...f, room: f.room, reason, endedById: 1 })).toBe(false);
    }
  });

  test('room and message views retain IDs and keys while hiding real usernames', () => {
    const randomChatRoom = {
      unlockedAt: null, aliasByUser: { '1': 'Quiet Signal', '2': 'Bright Wave' },
    };
    const participants = anonymousParticipants({
      randomChatRoom,
      participants: [{ userId: 1, user: { id: 1, username: 'private-name', publicKey: 'key' } }],
    });
    expect(participants[0].user).toMatchObject({ id: 1, username: 'Quiet Signal', publicKey: 'key' });
    expect(JSON.stringify(participants)).not.toContain('private-name');
    const message = anonymousMessage({
      senderId: 2, sender: { id: 2, username: 'real-name', publicKey: 'sender-key' },
      readBy: [{ id: 1, username: 'another-name' }],
    }, randomChatRoom);
    expect(message.sender).toMatchObject({ id: 2, username: 'Bright Wave' });
    expect(JSON.stringify(message)).not.toContain('real-name');
  });
});
