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
    expect(queues.sessionByRoomId).toBeInstanceOf(Map);
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
  it('creates linked chat and random rooms in a transaction', async () => {
    const chatRoomCreate = jest.fn().mockResolvedValue({
      id: 'chat-room-123',
    });

    const randomChatRoomCreate = jest.fn().mockResolvedValue({
      id: 'random-room-123',
      participants: [{ id: 'user1' }, { id: 'user2' }],
      messages: [
        {
          id: 'msg-1',
          rawContent: "You've been paired for a random chat. Be kind!",
          sender: { id: 'user1' },
        },
      ],
    });

    const tx = {
      chatRoom: {
        create: chatRoomCreate,
      },
      randomChatRoom: {
        create: randomChatRoomCreate,
      },
    };

    const prisma = {
      $transaction: jest.fn(
        async (callback) => callback(tx),
      ),
    };

    const userA = {
      userId: 'user1',
      username: 'Alice',
    };

    const userB = {
      userId: 'user2',
      username: 'Bob',
    };

    const room = await createRandomRoom(
      prisma,
      userA,
      userB,
    );

    expect(
      prisma.$transaction,
    ).toHaveBeenCalledTimes(1);

    expect(
      chatRoomCreate,
    ).toHaveBeenCalledWith({
      data: {
        isGroup: false,
        participants: {
          create: [
            {
              user: {
                connect: {
                  id: 'user1',
                },
              },
              role: 'MEMBER',
            },
            {
              user: {
                connect: {
                  id: 'user2',
                },
              },
              role: 'MEMBER',
            },
          ],
        },
      },
    });

    expect(
      randomChatRoomCreate,
    ).toHaveBeenCalledTimes(1);

    const randomRoomCall =
      randomChatRoomCreate.mock.calls[0][0];

    expect(randomRoomCall).toMatchObject({
      data: {
        chatRoom: {
          connect: {
            id: 'chat-room-123',
          },
        },
        participants: {
          connect: [
            { id: 'user1' },
            { id: 'user2' },
          ],
        },
        aliasByUser: {
          user1: expect.any(String),
          user2: expect.any(String),
        },
        messages: {
          create: [
            {
              rawContent:
                "You've been paired for a random chat. Be kind!",
              sender: {
                connect: {
                  id: 'user1',
                },
              },
              chatRoom: {
                connect: {
                  id: 'chat-room-123',
                },
              },
            },
          ],
        },
      },
      include: {
        participants: true,
        messages: {
          include: {
            sender: true,
          },
        },
      },
    });

    expect(room).toEqual({
      id: 'chat-room-123',
      chatRoomId: 'chat-room-123',
      randomChatRoomId: 'random-room-123',
      participants: [
        { id: 'user1' },
        { id: 'user2' },
      ],
      messages: [
        {
          id: 'msg-1',
          rawContent:
            "You've been paired for a random chat. Be kind!",
          sender: {
            id: 'user1',
          },
        },
      ],
      aliasByUser: {
        user1: expect.any(String),
        user2: expect.any(String),
      },
    });

    expect(
      room.aliasByUser.user1,
    ).not.toBe(
      room.aliasByUser.user2,
    );
  });
});

describe('tryMatch', () => {
  const mkSocket = (id) => ({
    id,
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
  });

  it('enqueues currentEntry and emits random:waiting when no compatible peer', async () => {
    const queues = buildQueues();
    const prisma = { randomChatRoom: { create: jest.fn() } };

    const socket = mkSocket('sock-1');
    const io = {
      sockets: {
        sockets: {
          get: jest.fn((sid) => (sid === 'sock-1' ? socket : null)),
        },
      },
    };

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
    expect(socket.emit).toHaveBeenCalledWith('random:waiting', {
      message: 'Looking for a partner…',
    });
  });

  it('skips incompatible peers and still enqueues if none compatible', async () => {
    const queues = buildQueues();
    const prisma = { randomChatRoom: { create: jest.fn() } };

    const socket = mkSocket('sock-2');
    const io = {
      sockets: {
        sockets: {
          get: jest.fn((sid) => (sid === 'sock-2' ? socket : null)),
        },
      },
    };

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

    const getSocketById = jest.fn((sid) => (sid === 'sock-2' ? socket : null));

    const result = await tryMatch({
      queues,
      prisma,
      io,
      currentEntry,
      getSocketById,
    });

    expect(result).toEqual({ matched: false });

    expect(queues.waitingQueue).toHaveLength(2);
    expect(queues.waitingQueue).toEqual(
      expect.arrayContaining([existingEntry, currentEntry]),
    );

    expect(socket.emit).toHaveBeenCalledWith('random:waiting', {
      message: 'Looking for a partner…',
    });
  });

  it('matches with compatible peer, creates room, joins sockets, and emits random:matched', async () => {
    const queues = buildQueues();

    const chatRoomCreate = jest.fn().mockResolvedValue({
      id: 'room-999',
    });

    const randomChatRoomCreate = jest.fn().mockResolvedValue({
      id: 'random-room-999',
      participants: [{ id: 'user-1' }, { id: 'user-2' }],
      messages: [],
    });

    const tx = {
      chatRoom: {
        create: chatRoomCreate,
      },
      randomChatRoom: {
        create: randomChatRoomCreate,
      },
    };

    const prisma = {
      $transaction: jest.fn(
        async (callback) => callback(tx),
      ),
      contact: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    const peerEntry = {
      socketId: 'sock-peer',
      userId: 'user-2',
      username: 'Bob',
      ageBand: '18-24',
      wantsAgeFilter: false,
    };

    enqueue(queues, peerEntry);

    const currentEntry = {
      socketId: 'sock-current',
      userId: 'user-1',
      username: 'Alice',
      ageBand: '18-24',
      wantsAgeFilter: false,
    };

    const socketCurrent = mkSocket('sock-current');
    const socketPeer = mkSocket('sock-peer');

    const io = {
      sockets: {
        sockets: {
          get: jest.fn((sid) => {
            if (sid === 'sock-current') return socketCurrent;
            if (sid === 'sock-peer') return socketPeer;
            return null;
          }),
        },
      },
    };

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

    expect(result).toEqual({
      matched: true,
      roomId: 'room-999',
      chatRoomId: 'room-999',
      randomChatRoomId: 'random-room-999',
      myAlias: expect.any(String),
      partnerAlias: expect.any(String),
    });

    expect(queues.waitingQueue).toHaveLength(0);
    expect(queues.waitingBySocket.size).toBe(0);

    expect(queues.activeRoomBySocket.get('sock-current')).toEqual({
      roomId: 'room-999',
      randomChatRoomId: 'random-room-999',
      peerSocketId: 'sock-peer',
      peerUserId: 'user-2',
    });

    expect(queues.activeRoomBySocket.get('sock-peer')).toEqual({
      roomId: 'room-999',
      randomChatRoomId: 'random-room-999',
      peerSocketId: 'sock-current',
      peerUserId: 'user-1',
    });

    expect(queues.sessionByRoomId.get('room-999')).toEqual(
      expect.objectContaining({
        roomId: 'room-999',
        isUnlocked: false,
        users: expect.any(Object),
      }),
    );

    expect(socketCurrent.join).toHaveBeenCalledWith('random:room-999');
    expect(socketPeer.join).toHaveBeenCalledWith('random:room-999');

    expect(socketCurrent.emit).toHaveBeenCalledWith(
      'random:matched',
      expect.objectContaining({
        roomId: 'room-999',
        myAlias: expect.any(String),
        partnerAlias: expect.any(String),
        partnerDisplayName: expect.any(String),
        relationshipStatus: 'none',
      }),
    );

    expect(socketPeer.emit).toHaveBeenCalledWith(
      'random:matched',
      expect.objectContaining({
        roomId: 'room-999',
        myAlias: expect.any(String),
        partnerAlias: expect.any(String),
        partnerDisplayName: expect.any(String),
        relationshipStatus: 'none',
      }),
    );

    const currentMatchedPayload =
      socketCurrent.emit.mock.calls.find(
        ([event]) => event === 'random:matched',
      )[1];

    const peerMatchedPayload =
      socketPeer.emit.mock.calls.find(
        ([event]) => event === 'random:matched',
      )[1];

    expect(currentMatchedPayload.partnerDisplayName).toBe(
      currentMatchedPayload.partnerAlias,
    );

    expect(peerMatchedPayload.partnerDisplayName).toBe(
      peerMatchedPayload.partnerAlias,
    );
  });
});