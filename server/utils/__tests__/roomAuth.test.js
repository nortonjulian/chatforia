import { jest } from '@jest/globals';
import {
  RoleRank,
  canActOnRank,
  getEffectiveRoomRank,
  requireRoomRank,
} from '../../utils/roomAuth.js';

describe('RoleRank', () => {
  test('has expected numeric ordering', () => {
    expect(RoleRank.MEMBER).toBe(0);
    expect(RoleRank.MODERATOR).toBe(1);
    expect(RoleRank.ADMIN).toBe(2);
    expect(RoleRank.OWNER).toBe(3);

    // sanity monotonicity
    expect(RoleRank.MEMBER < RoleRank.MODERATOR).toBe(true);
    expect(RoleRank.MODERATOR < RoleRank.ADMIN).toBe(true);
    expect(RoleRank.ADMIN < RoleRank.OWNER).toBe(true);
  });
});

describe('canActOnRank', () => {
  test('OWNER can act on anyone', () => {
    expect(canActOnRank(RoleRank.OWNER, RoleRank.OWNER)).toBe(true);
    expect(canActOnRank(RoleRank.OWNER, RoleRank.ADMIN)).toBe(true);
    expect(canActOnRank(RoleRank.OWNER, RoleRank.MODERATOR)).toBe(true);
    expect(canActOnRank(RoleRank.OWNER, RoleRank.MEMBER)).toBe(true);
  });

  test('ADMIN can act on MODERATOR or below, not OWNER/ADMIN', () => {
    expect(canActOnRank(RoleRank.ADMIN, RoleRank.OWNER)).toBe(false);
    expect(canActOnRank(RoleRank.ADMIN, RoleRank.ADMIN)).toBe(false);
    expect(canActOnRank(RoleRank.ADMIN, RoleRank.MODERATOR)).toBe(true);
    expect(canActOnRank(RoleRank.ADMIN, RoleRank.MEMBER)).toBe(true);
  });

  test('MODERATOR can act on MEMBER only', () => {
    expect(canActOnRank(RoleRank.MODERATOR, RoleRank.OWNER)).toBe(false);
    expect(canActOnRank(RoleRank.MODERATOR, RoleRank.ADMIN)).toBe(false);
    expect(canActOnRank(RoleRank.MODERATOR, RoleRank.MODERATOR)).toBe(false);
    expect(canActOnRank(RoleRank.MODERATOR, RoleRank.MEMBER)).toBe(true);
  });

  test('MEMBER cannot act on anyone', () => {
    expect(canActOnRank(RoleRank.MEMBER, RoleRank.OWNER)).toBe(false);
    expect(canActOnRank(RoleRank.MEMBER, RoleRank.ADMIN)).toBe(false);
    expect(canActOnRank(RoleRank.MEMBER, RoleRank.MODERATOR)).toBe(false);
    expect(canActOnRank(RoleRank.MEMBER, RoleRank.MEMBER)).toBe(false);
  });
});

describe('getEffectiveRoomRank', () => {
  let prisma;

  beforeEach(() => {
    prisma = {
      chatRoom: {
        findUnique: jest.fn(),
      },
      participant: {
        findUnique: jest.fn(),
      },
    };
  });

  test('throws Boom.badRequest if ids are not numeric', async () => {
    await expect(
      getEffectiveRoomRank(prisma, 'not-a-number', 123, 'MEMBER')
    ).rejects.toThrow(/Invalid ids/);

    await expect(
      getEffectiveRoomRank(prisma, 10, 'nope', 'MEMBER')
    ).rejects.toThrow(/Invalid ids/);
  });

  test('global ADMIN returns RoleRank.ADMIN without hitting DB', async () => {
    const rank = await getEffectiveRoomRank(
      prisma,
      42,
      99,
      'ADMIN' // global role
    );

    expect(rank).toBe(RoleRank.ADMIN);
    expect(prisma.chatRoom.findUnique).not.toHaveBeenCalled();
    expect(prisma.participant.findUnique).not.toHaveBeenCalled();
  });

  test('throws Boom.notFound if room does not exist', async () => {
    prisma.chatRoom.findUnique.mockResolvedValueOnce(null);

    await expect(
      getEffectiveRoomRank(prisma, 5, 777, 'MEMBER')
    ).rejects.toThrow(/Room not found/);

    expect(prisma.chatRoom.findUnique).toHaveBeenCalledWith({
      where: { id: 777 },
      select: { ownerId: true },
    });
  });

  test('returns OWNER if actor is room.ownerId', async () => {
    prisma.chatRoom.findUnique.mockResolvedValueOnce({ ownerId: 5 });

    const rank = await getEffectiveRoomRank(prisma, 5, 123, 'MEMBER');
    expect(rank).toBe(RoleRank.OWNER);

    // participant.findUnique should NOT be called if owner match
    expect(prisma.participant.findUnique).not.toHaveBeenCalled();
  });

  test('returns null if not a participant (not owner, no participant row)', async () => {
    prisma.chatRoom.findUnique.mockResolvedValueOnce({ ownerId: 10 });
    prisma.participant.findUnique.mockResolvedValueOnce(null);

    const rank = await getEffectiveRoomRank(prisma, 5, 123, 'MEMBER');
    expect(rank).toBeNull();

    expect(prisma.chatRoom.findUnique).toHaveBeenCalledWith({
      where: { id: 123 },
      select: { ownerId: true },
    });
    expect(prisma.participant.findUnique).toHaveBeenCalledWith({
      where: { userId_chatRoomId: { userId: 5, chatRoomId: 123 } },
      select: { role: true },
    });
  });

  test('maps participant.role strings to RoleRank constants', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({ ownerId: 99 });

    const cases = [
      { role: 'ADMIN', expected: RoleRank.ADMIN },
      { role: 'MODERATOR', expected: RoleRank.MODERATOR },
      { role: 'MEMBER', expected: RoleRank.MEMBER },
      { role: 'SOMETHING_ELSE', expected: RoleRank.MEMBER }, // default
    ];

    for (const { role, expected } of cases) {
      prisma.participant.findUnique.mockResolvedValueOnce({ role });

      const rank = await getEffectiveRoomRank(
        prisma,
        5, // actorUserId
        123, // roomId
        'MEMBER' // global role != ADMIN
      );

      expect(rank).toBe(expected);
    }
  });
});

describe('requireRoomRank middleware', () => {
  let prisma;
  let next;

  beforeEach(() => {
    prisma = {
      chatRoom: {
        findUnique: jest.fn(),
      },
      participant: {
        findUnique: jest.fn(),
      },
    };
    next = jest.fn();
  });

  function makeReq({ paramsId, bodyChatRoomId, userId, userRole }) {
    return {
      params: { id: paramsId },
      body: bodyChatRoomId ? { chatRoomId: bodyChatRoomId } : {},
      user: { id: userId, role: userRole },
    };
  }

  test('throws Boom.badRequest for invalid room id', async () => {
    const mw = requireRoomRank(prisma, RoleRank.MODERATOR);

    const req = makeReq({
      paramsId: 'not-a-number',
      userId: 5,
      userRole: 'MEMBER',
    });

    await mw(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(Error);
    expect(err.isBoom).toBe(true);
    expect(err.output.statusCode).toBe(400); // badRequest
  });

  test('calls next() with no error if rank >= minRank', async () => {
    // Scenario: user is OWNER so rank=OWNER (3)
    prisma.chatRoom.findUnique.mockResolvedValueOnce({ ownerId: 5 });

    const mw = requireRoomRank(prisma, RoleRank.MODERATOR); // require mod or higher

    const req = makeReq({
      paramsId: 123,
      userId: 5,
      userRole: 'MEMBER', // not global ADMIN, but OWNER path will satisfy
    });

    await mw(req, {}, next);

    expect(next).toHaveBeenCalledWith();
  });

  test('forbidden if user is not a participant', async () => {
    prisma.chatRoom.findUnique.mockResolvedValueOnce({ ownerId: 10 }); // not owner
    prisma.participant.findUnique.mockResolvedValueOnce(null); // not in room

    const mw = requireRoomRank(prisma, RoleRank.MEMBER);

    const req = makeReq({
      paramsId: 456,
      userId: 5,
      userRole: 'MEMBER',
    });

    await mw(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err.isBoom).toBe(true);
    expect(err.output.statusCode).toBe(403); // forbidden
    expect(err.message).toMatch(/Not a participant/i);
  });

  test('forbidden if rank < minRank', async () => {
    // user is MEMBER in room, minRank = MODERATOR
    prisma.chatRoom.findUnique.mockResolvedValueOnce({ ownerId: 10 });
    prisma.participant.findUnique.mockResolvedValueOnce({ role: 'MEMBER' });

    const mw = requireRoomRank(prisma, RoleRank.MODERATOR);

    const req = makeReq({
      paramsId: 999,
      userId: 5,
      userRole: 'MEMBER',
    });

    await mw(req, {}, next);

    const err = next.mock.calls[0][0];
    expect(err.isBoom).toBe(true);
    expect(err.output.statusCode).toBe(403);
    expect(err.message).toMatch(/Insufficient rank/i);
  });

  test('accepts roomId from body.chatRoomId if params.id is missing', async () => {
    prisma.chatRoom.findUnique.mockResolvedValueOnce({ ownerId: 5 });

    const mw = requireRoomRank(prisma, RoleRank.MEMBER); // low bar

    const req = makeReq({
      paramsId: undefined,
      bodyChatRoomId: 77,
      userId: 5,
      userRole: 'MEMBER',
    });

    await mw(req, {}, next);

    expect(next).toHaveBeenCalledWith();
  });

  test('global ADMINs auto-pass because getEffectiveRoomRank returns ADMIN rank', async () => {
    const mw = requireRoomRank(prisma, RoleRank.MODERATOR);

    const req = makeReq({
      paramsId: 55,
      userId: 42,
      userRole: 'ADMIN', // global admin short-circuit
    });

    await mw(req, {}, next);

    expect(next).toHaveBeenCalledWith();

    // Since role was ADMIN, prisma shouldn't have been touched
    expect(prisma.chatRoom.findUnique).not.toHaveBeenCalled();
    expect(prisma.participant.findUnique).not.toHaveBeenCalled();
  });
});
