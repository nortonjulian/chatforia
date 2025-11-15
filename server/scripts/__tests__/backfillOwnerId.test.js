import { jest } from '@jest/globals';
import backfillOwnerId from '../backfillOwnerId.js';

// --- Prisma mock ---
const prismaMock = {
  chatRoom: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
  participant: {
    findFirst: jest.fn(),
  },
  $disconnect: jest.fn(),
};

describe('server/scripts/backfillOwnerId.js', () => {
  let logSpy;
  let errSpy;

  beforeEach(() => {
    jest.clearAllMocks();

    prismaMock.chatRoom.findMany.mockReset();
    prismaMock.chatRoom.update.mockReset();
    prismaMock.participant.findFirst.mockReset();
    prismaMock.$disconnect.mockReset();

    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  test('happy path: skips owned + empty rooms; updates missing owner; logs count', async () => {
    // Rooms returned by chatRoom.findMany
    prismaMock.chatRoom.findMany.mockResolvedValue([
      { id: 1, ownerId: 42 },   // already owned → skip
      { id: 2, ownerId: null }, // missing owner, but no participants → skip
      { id: 3, ownerId: null }, // missing owner, has participant → update to ownerId=7
    ]);

    // participant.findFirst is called per room missing owner (rooms 2 and 3)
    prismaMock.participant.findFirst
      .mockResolvedValueOnce(null) // for room 2 → skip (empty room)
      .mockResolvedValueOnce({ id: 100, userId: 7, role: 'ADMIN' }); // for room 3

    prismaMock.chatRoom.update.mockResolvedValue({});

    await backfillOwnerId(prismaMock);

    // 1) find rooms
    expect(prismaMock.chatRoom.findMany).toHaveBeenCalledWith({
      select: { id: true, ownerId: true },
    });

    // 2) For room id=2 (no owner): ensure query prefers OWNER/ADMIN/MOD/MEMBER with orderBy role asc + id asc
    expect(prismaMock.participant.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        chatRoomId: 2,
        role: { in: ['OWNER', 'ADMIN', 'MODERATOR', 'MEMBER'] },
      },
      orderBy: [{ role: 'asc' }, { id: 'asc' }],
    });

    // 3) For room id=3 (no owner): same query but for chatRoomId 3
    expect(prismaMock.participant.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        chatRoomId: 3,
        role: { in: ['OWNER', 'ADMIN', 'MODERATOR', 'MEMBER'] },
      },
      orderBy: [{ role: 'asc' }, { id: 'asc' }],
    });

    // 4) Should update only room 3 (room 2 had no participants)
    expect(prismaMock.chatRoom.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.chatRoom.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { ownerId: 7 },
    });

    // 5) Logs “Backfilled ownerId for 1 room(s).”
    expect(logSpy).toHaveBeenCalledWith(
      'Backfilled ownerId for 1 room(s).'
    );

    // No error logs in happy path
    expect(errSpy).not.toHaveBeenCalled();
  });

  test('error path: bubbles error when prisma throws', async () => {
    prismaMock.chatRoom.findMany.mockRejectedValue(new Error('DB down'));

    await expect(backfillOwnerId(prismaMock)).rejects.toThrow('DB down');

    // No updates attempted
    expect(prismaMock.chatRoom.update).not.toHaveBeenCalled();
  });
});
