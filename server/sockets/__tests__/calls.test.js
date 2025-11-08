import { registerCallHandlers } from '../calls.js';

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
    _fire(event, payload) {
      const cb = handlers.get(event);
      if (cb) return cb(payload);
    },
    _has(event) {
      return handlers.has(event);
    },
  };
}

function makePrisma() {
  return {
    call: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
}

describe('registerCallHandlers', () => {
  test('no socket.user.id → returns without binding handlers', () => {
    const io = makeIo();
    const socket = makeSocket(); // no user
    const prisma = makePrisma();

    registerCallHandlers({ io, socket, prisma });

    expect(socket.on).not.toHaveBeenCalled();
  });

  test('call:invite → creates call and rings callee', async () => {
    const io = makeIo();
    const socket = makeSocket({ userId: 101 }); // caller
    const prisma = makePrisma();

    const fakeCall = {
      id: 55,
      callerId: 101,
      calleeId: 202,
      chatId: 999,
      mode: 'VIDEO',
      status: 'INITIATED',
      createdAt: new Date('2030-01-01T00:00:00Z'),
    };

    prisma.call.create.mockResolvedValueOnce(fakeCall);

    registerCallHandlers({ io, socket, prisma });

    // Ensure handlers were bound
    expect(socket._has('call:invite')).toBe(true);

    const payload = { calleeId: 202, chatId: 999, mode: 'VIDEO', sdp: 'OFFER_SDP' };
    await socket._fire('call:invite', payload);

    // DB write
    expect(prisma.call.create).toHaveBeenCalledWith({
      data: {
        callerId: 101,
        calleeId: 202,
        chatId: 999,
        mode: 'VIDEO',
        status: 'INITIATED',
      },
    });

    // Ring callee
    const room = io._room('user:202');
    expect(room.emit).toHaveBeenCalledWith('call:ring', {
      callId: 55,
      fromUserId: 101,
      chatId: 999,
      mode: 'VIDEO',
      sdp: 'OFFER_SDP',
      createdAt: fakeCall.createdAt,
    });
  });

  test('call:invite DB error → emits call:error INVITE_FAILED', async () => {
    const io = makeIo();
    const socket = makeSocket({ userId: 1 });
    const prisma = makePrisma();

    prisma.call.create.mockRejectedValueOnce(new Error('nope'));

    registerCallHandlers({ io, socket, prisma });

    await socket._fire('call:invite', { calleeId: 2, mode: 'AUDIO', sdp: 'X' });

    expect(socket.emit).toHaveBeenCalledWith('call:error', { error: 'INVITE_FAILED' });
  });

  test('call:answer reject (by callee) → updates REJECTED and notifies caller', async () => {
    const io = makeIo();
    const socket = makeSocket({ userId: 202 }); // callee socket
    const prisma = makePrisma();

    prisma.call.findUnique.mockResolvedValueOnce({
      id: 77,
      callerId: 101,
      calleeId: 202,
      chatId: 9,
      mode: 'AUDIO',
      status: 'INITIATED',
    });

    prisma.call.update.mockResolvedValueOnce({});

    registerCallHandlers({ io, socket, prisma });

    await socket._fire('call:answer', { callId: 77, accept: false });

    expect(prisma.call.update).toHaveBeenCalledWith({
      where: { id: 77 },
      data: { status: 'REJECTED', endedAt: expect.any(Date) },
    });

    const callerRoom = io._room('user:101');
    expect(callerRoom.emit).toHaveBeenCalledWith('call:rejected', { callId: 77 });
  });

  test('call:answer accept (by callee) → updates ANSWERED and sends SDP to caller', async () => {
    const io = makeIo();
    const socket = makeSocket({ userId: 202 }); // callee
    const prisma = makePrisma();

    prisma.call.findUnique.mockResolvedValueOnce({
      id: 88,
      callerId: 101,
      calleeId: 202,
      status: 'INITIATED',
    });

    prisma.call.update.mockResolvedValueOnce({});

    registerCallHandlers({ io, socket, prisma });

    await socket._fire('call:answer', { callId: 88, accept: true, sdp: 'ANSWER_SDP' });

    expect(prisma.call.update).toHaveBeenCalledWith({
      where: { id: 88 },
      data: { status: 'ANSWERED', acceptedAt: expect.any(Date) },
    });

    const callerRoom = io._room('user:101');
    expect(callerRoom.emit).toHaveBeenCalledWith('call:answered', {
      callId: 88,
      sdp: 'ANSWER_SDP',
    });
  });

  test('call:answer by non-callee is ignored', async () => {
    const io = makeIo();
    const socket = makeSocket({ userId: 303 }); // not the callee
    const prisma = makePrisma();

    prisma.call.findUnique.mockResolvedValueOnce({
      id: 90,
      callerId: 101,
      calleeId: 202, // callee is someone else
      status: 'INITIATED',
    });

    registerCallHandlers({ io, socket, prisma });

    await socket._fire('call:answer', { callId: 90, accept: true, sdp: 'S' });

    expect(prisma.call.update).not.toHaveBeenCalled();
    // no emits to caller either
    const callerRoom = io._room('user:101');
    expect(callerRoom?.emit).toBeUndefined();
  });

  test('call:candidate relays to given user room', async () => {
    const io = makeIo();
    const socket = makeSocket({ userId: 10 });
    const prisma = makePrisma();

    registerCallHandlers({ io, socket, prisma });

    await socket._fire('call:candidate', {
      callId: 1,
      toUserId: 99,
      candidate: { sdpMid: '0', sdpMLineIndex: 0, candidate: 'cand' },
    });

    const target = io._room('user:99');
    expect(target.emit).toHaveBeenCalledWith('call:candidate', {
      callId: 1,
      candidate: { sdpMid: '0', sdpMLineIndex: 0, candidate: 'cand' },
    });
  });

  test('call:hangup → updates ENDED and notifies peer', async () => {
    const io = makeIo();
    const socket = makeSocket({ userId: 101 }); // caller hanging up
    const prisma = makePrisma();

    prisma.call.findUnique.mockResolvedValueOnce({
      id: 123,
      callerId: 101,
      calleeId: 202,
      status: 'ANSWERED',
    });

    prisma.call.update.mockResolvedValueOnce({});

    registerCallHandlers({ io, socket, prisma });

    await socket._fire('call:hangup', { callId: 123 });

    expect(prisma.call.update).toHaveBeenCalledWith({
      where: { id: 123 },
      data: { status: 'ENDED', endedAt: expect.any(Date) },
    });

    const peerRoom = io._room('user:202');
    expect(peerRoom.emit).toHaveBeenCalledWith('call:ended', { callId: 123 });
  });

  test('call:hangup DB error → emits HANGUP_FAILED', async () => {
    const io = makeIo();
    const socket = makeSocket({ userId: 101 });
    const prisma = makePrisma();

    prisma.call.findUnique.mockResolvedValueOnce({
      id: 123,
      callerId: 101,
      calleeId: 202,
      status: 'ANSWERED',
    });
    prisma.call.update.mockRejectedValueOnce(new Error('db down'));

    registerCallHandlers({ io, socket, prisma });

    await socket._fire('call:hangup', { callId: 123 });

    expect(socket.emit).toHaveBeenCalledWith('call:error', { error: 'HANGUP_FAILED' });
  });
});
