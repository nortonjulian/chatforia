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

jest.mock('../../utils/prismaClient.js', () => ({
  __esModule: true,
  default: prismaMock,
}));

const reimportScript = async () => {
  jest.resetModules();
  // Clear the require cache entry so main() runs on each import
  const path = require.resolve('../backfillOwnerId.cjs');
  delete require.cache[path];
  // Import/require the script (it auto-runs main())
  return require('../backfillOwnerId.cjs');
};

describe('server/scripts/backfillOwnerId.cjs', () => {
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test('happy path: skips owned + empty rooms; updates missing owner; logs count; disconnects', async () => {
    // Rooms returned by chatRoom.findMany
    prismaMock.chatRoom.findMany.mockResolvedValue([
      { id: 1, ownerId: 42 }, // already owned → skip
      { id: 2, ownerId: null }, // missing owner, but no participants → skip
      { id: 3, ownerId: null }, // missing owner, has participant → update to ownerId=7
    ]);

    // participant.findFirst is called per room missing owner (rooms 2 and 3)
    prismaMock.participant.findFirst
      .mockResolvedValueOnce(null) // for room 2 → skip (empty room)
      .mockResolvedValueOnce({ id: 100, userId: 7, role: 'ADMIN' }); // for room 3

    prismaMock.chatRoom.update.mockResolvedValue({});

    await reimportScript();

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
    expect(logSpy).toHaveBeenCalledWith('Backfilled ownerId for 1 room(s).');

    // 6) Always disconnects at the end
    expect(prismaMock.$disconnect).toHaveBeenCalledTimes(1);

    // Should NOT call process.exit on success
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  test('error path: logs error, exits with code 1, and disconnects', async () => {
    prismaMock.chatRoom.findMany.mockRejectedValue(new Error('DB down'));

    await reimportScript();

    expect(errSpy).toHaveBeenCalled(); // console.error(e)
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(prismaMock.$disconnect).toHaveBeenCalledTimes(1);
    // No updates attempted
    expect(prismaMock.chatRoom.update).not.toHaveBeenCalled();
  });
});
