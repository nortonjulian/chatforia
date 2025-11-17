import { jest } from '@jest/globals';
import {
  buildQueues,
  areCompatible,
  enqueue,
  removeFromQueue,
  createRandomRoom,
  tryMatch,
} from '../randomChatService.js';

describe('buildQueues', () => {
  it('creates queues with expected structures', () => {
    const queues = buildQueues();

    expect(Array.isArray(queues.waitingQueue)).toBe(true);
    expect(queues.waitingBySocket).toBeInstanceOf(Map);
    expect(queues.activeRoomBySocket).toBeInstanceOf(Map);
  });
});

describe('areCompatible', () => {
  const baseA = { userId: 'userA', ageBand: '18-24', wantsAgeFilter: false };
  const baseB = { userId: 'userB', ageBand: '18-24', wantsAgeFilter: false };

  it('returns false when either side is missing', () => {
    expect(areCompatible(null, baseB)).toBe(false);
    expect(areCompatible(baseA, null)).toBe(false);
  });

  it('returns false when user IDs are the same', () => {
    const same = { userId: 'same', ageBand: '18-24', wantsAgeFilter: false };
    expect(areCompatible(same, same)).toBe(false);
  });

  it('returns true when neither side enforces age filter', () => {
    expect(areCompatible(baseA, baseB)).toBe(true);
  });

  it('returns false when current user wants age filter and bands mismatch', () => {
    const a = { userId: 'userA', ageBand: '18-24', wantsAgeFilter: true };
    const b = { userId: 'userB', ageBand: '25-34', wantsAgeFilter: false };
    expect(areCompatible(a, b)).toBe(false);
  });

  it('returns false when peer wants age filter and bands mismatch', () => {
    const a = { userId: 'userA', ageBand: '18-24', wantsAgeFilter: false };
    const b = { userId: 'userB', ageBand: '25-34', wantsAgeFilter: true };
    expect(areCompatible(a, b)).toBe(false);
  });

  it('allows match when filter is requested but other side has no ageBand', () => {
    const a = { userId: 'userA', ageBand: '18-24', wantsAgeFilter: true };
    const b = { userId: 'userB', ageBand: null, wantsAgeFilter: false };
    // condition requires BOTH ageBand values present to block; here it should pass
    expect(areCompatible(a, b)).toBe(true);
  });

  it('returns true when both want age filter and bands match', () => {
    const a = { userId: 'userA', ageBand: '25-34', wantsAgeFilter: true };
    const b = { userId: 'userB', ageBand: '25-34', wantsAgeFilter: true };
    expect(areCompatible(a, b)).toBe(true);
  });
});

describe('enqueue and removeFromQueue', () => {
  it('adds entry to queue and map, and removes it correctly', () => {
    const queues = buildQueues();

    const entry = {
      socketId: 'sock-1',
      userId: 'user-1',
      username: 'Alice',
      ageBand: '18-24',
      wantsAgeFilter: false,
    };

    enqueue(queues, entry);

    expect(queues.waitingQueue).toHaveLength(1);
    expect(queues.waitingQueue[0]).toBe(entry);
    expect(queues.waitingBySocket.get('sock-1')).toBe(entry);

    const removed = removeFromQueue(queues, 'sock-1');

    expect(removed).toBe(entry);
    expect(queues.waitingQueue).toHaveLength(0);
    expect(queues.waitingBySocket.has('sock-1')).toBe(false);
  });

  it('returns null when removing a non-existent socketId', () => {
    const queues = buildQueues();
    const result = removeFromQueue(queues, 'nope');
    expect(result).toBeNull();
  });
});

describe('createRandomRoom', () => {
  it('calls prisma.randomChatRoom.create with correct data and returns room', async () => {
    const prisma = {
      randomChatRoom: {
        create: jest.fn().mockResolvedValue({
          id: 'room-123',
          participants: [{ id: 'user1' }, { id: 'user2' }],
          messages: [
            {
              id: 'msg-1',
              content: "You've been paired for a random chat. Be kind!",
              sender: { id: 'user1' },
            },
          ],
        }),
      },
    };

    const userA = { userId: 'user1', username: 'Alice' };
    const userB = { userId: 'user2', username: 'Bob' };

    const room = await createRandomRoom(prisma, userA, userB);

    expect(prisma.randomChatRoom.create).toHaveBeenCalledTimes(1);

    const call = prisma.randomChatRoom.create.mock.calls[0][0];

    expect(call).toMatchObject({
      data: {
        participants: {
          connect: [{ id: 'user1' }, { id: 'user2' }],
        },
        messages: {
          create: [
            {
              content: "You've been paired for a random chat. Be kind!",
              // sender.connect.id is what we care about
            },
          ],
        },
      },
      include: {
        participants: true,
        messages: { include: { sender: true } },
      },
    });

    expect(room).toEqual({
      id: 'room-123',
      participants: [{ id: 'user1' }, { id: 'user2' }],
      messages: [
        {
          id: 'msg-1',
          content: "You've been paired for a random chat. Be kind!",
          sender: { id: 'user1' },
        },
      ],
    });
  });
});

describe('tryMatch', () => {
  const mkSocket = (id) => {
    return {
      id,
      join: jest.fn(),
      emit: jest.fn(),
    };
  };

  it('enqueues currentEntry and emits "waiting" when no compatible peer', async () => {
    const queues = buildQueues();
    const prisma = { randomChatRoom: { create: jest.fn() } };
    const io = {}; // not used in current implementation

    const socket = mkSocket('sock-1');
    const getSocketById = jest.fn((sid) => (sid === 'sock-1' ? socket : null));

    const currentEntry = {
      socketId: 'sock-1',
      userId: 'user-1',
      username: 'Alice',
      ageBand: '18-24',
      wantsAgeFilter: false,
    };

    const result = await tryMatch({
      queues,
      prisma,
      io,
      currentEntry,
      getSocketById,
    });

    expect(result).toEqual({ matched: false });
    expect(queues.waitingQueue).toHaveLength(1);
    expect(queues.waitingQueue[0]).toBe(currentEntry);
    expect(queues.waitingBySocket.get('sock-1')).toBe(currentEntry);

    expect(getSocketById).toHaveBeenCalledWith('sock-1');
    expect(socket.emit).toHaveBeenCalledWith(
      'waiting',
      'Looking for a partner…',
    );
  });

  it('skips incompatible peers and still enqueues if none compatible', async () => {
    const queues = buildQueues();
    const prisma = { randomChatRoom: { create: jest.fn() } };
    const io = {};
    const socket = mkSocket('sock-2');

    // Incompatible existing entry (age filter mismatch)
    const existingEntry = {
      socketId: 'sock-x',
      userId: 'other-user',
      username: 'Charlie',
      ageBand: '25-34',
      wantsAgeFilter: true,
    };
    enqueue(queues, existingEntry);

    const currentEntry = {
      socketId: 'sock-2',
      userId: 'user-2',
      username: 'Bob',
      ageBand: '18-24',
      wantsAgeFilter: true,
    };

    const getSocketById = jest.fn((sid) =>
      sid === 'sock-2' ? socket : null,
    );

    const result = await tryMatch({
      queues,
      prisma,
      io,
      currentEntry,
      getSocketById,
    });

    expect(result.matched).toBe(false);
    // both entries should now be in the queue (original + new)
    expect(queues.waitingQueue).toHaveLength(2);
    expect(queues.waitingQueue).toEqual(
      expect.arrayContaining([existingEntry, currentEntry]),
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'waiting',
      'Looking for a partner…',
    );
  });

  it('matches with compatible peer, creates room, joins sockets, and emits pair_found', async () => {
    const queues = buildQueues();
    const io = {};

    const prisma = {
      randomChatRoom: {
        create: jest.fn().mockResolvedValue({
          id: 'room-999',
          participants: [{ id: 'user-1' }, { id: 'user-2' }],
          messages: [],
        }),
      },
    };

    // Existing waiting peer
    const peerEntry = {
      socketId: 'sock-peer',
      userId: 'user-2',
      username: 'Bob',
      ageBand: '18-24',
      wantsAgeFilter: false,
    };
    enqueue(queues, peerEntry);

    // New arriving user
    const currentEntry = {
      socketId: 'sock-current',
      userId: 'user-1',
      username: 'Alice',
      ageBand: '18-24',
      wantsAgeFilter: false,
    };

    const socketCurrent = mkSocket('sock-current');
    const socketPeer = mkSocket('sock-peer');

    const getSocketById = jest.fn((sid) => {
      if (sid === 'sock-current') return socketCurrent;
      if (sid === 'sock-peer') return socketPeer;
      return null;
    });

    const result = await tryMatch({
      queues,
      prisma,
      io,
      currentEntry,
      getSocketById,
    });

    // result summary
    expect(result).toEqual({
      matched: true,
      roomId: 'room-999',
      partnerId: 'user-2',
    });

    // queue is emptied
    expect(queues.waitingQueue).toHaveLength(0);
    expect(queues.waitingBySocket.size).toBe(0);

    // activeRoomBySocket is populated for both sockets
    const activeCurrent = queues.activeRoomBySocket.get('sock-current');
    const activePeer = queues.activeRoomBySocket.get('sock-peer');

    expect(activeCurrent).toEqual({
      roomId: 'room-999',
      peerSocketId: 'sock-peer',
      peerUserId: 'user-2',
    });
    expect(activePeer).toEqual({
      roomId: 'room-999',
      peerSocketId: 'sock-current',
      peerUserId: 'user-1',
    });

    // sockets joined the room
    expect(socketCurrent.join).toHaveBeenCalledWith('random:room-999');
    expect(socketPeer.join).toHaveBeenCalledWith('random:room-999');

    // both sides got pair_found with correct payload
    expect(socketCurrent.emit).toHaveBeenCalledWith('pair_found', {
      roomId: 'room-999',
      partner: 'Bob',
      partnerId: 'user-2',
    });
    expect(socketPeer.emit).toHaveBeenCalledWith('pair_found', {
      roomId: 'room-999',
      partner: 'Alice',
      partnerId: 'user-1',
    });
  });
});
