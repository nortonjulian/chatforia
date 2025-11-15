import { jest } from '@jest/globals';

// Shared mock objects
const prismaMock = {
  participant: {
    findUnique: jest.fn(),
  },
};

const makeBoomMock = () => {
  const forbidden = (msg) => {
    const err = new Error(msg);
    err.isBoom = true;
    err.output = { statusCode: 403, payload: { message: msg } };
    return err;
  };
  return {
    __esModule: true,
    default: { forbidden },
    forbidden,
  };
};

// Helper: (re)load roomAuth.js with fresh mocks each time
const reloadModule = async () => {
  jest.resetModules();

  // Re-register ESM mocks AFTER reset, BEFORE import

  // Mock Boom
  jest.unstable_mockModule('@hapi/boom', () => makeBoomMock());

  // Mock prisma wrapper used by roomAuth.js:
  // roomAuth.js has: import { prisma } from '../utils/prismaClient.js';
  jest.unstable_mockModule('../utils/prismaClient.js', () => ({
    __esModule: true,
    prisma: prismaMock,
  }));

  // Now import the module under test
  return import('../roomAuth.js');
};

// Simple req/res/next helpers
const makeReqResNext = (overrides = {}) => {
  const req = {
    user: { id: 1, role: 'USER' },
    params: { id: '10' },
    body: {},
    ...overrides.req,
  };
  const res = {}; // not used by these middlewares
  const next = jest.fn();
  return { req, res, next };
};

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.participant.findUnique.mockReset();
});

describe('getRoomRole()', () => {
  test('returns {role:null} when user missing', async () => {
    const { getRoomRole } = await reloadModule();
    const out = await getRoomRole(null, 1);
    expect(out).toEqual({ role: null });
    expect(prismaMock.participant.findUnique).not.toHaveBeenCalled();
  });

  test('global ADMIN bypasses room check', async () => {
    const { getRoomRole } = await reloadModule();
    const out = await getRoomRole({ id: 99, role: 'ADMIN' }, 123);
    expect(out).toEqual({ role: 'ADMIN' });
    expect(prismaMock.participant.findUnique).not.toHaveBeenCalled();
  });

  test('returns DB participant role when found', async () => {
    prismaMock.participant.findUnique.mockResolvedValue({ role: 'MODERATOR' });
    const { getRoomRole } = await reloadModule();

    const out = await getRoomRole({ id: '7', role: 'USER' }, '55');
    expect(prismaMock.participant.findUnique).toHaveBeenCalledWith({
      where: { userId_chatRoomId: { userId: 7, chatRoomId: 55 } },
      select: { role: true },
    });
    expect(out).toEqual({ role: 'MODERATOR' });
  });

  test('returns {role:null} when participant not found', async () => {
    prismaMock.participant.findUnique.mockResolvedValue(null);
    const { getRoomRole } = await reloadModule();

    const out = await getRoomRole({ id: 7, role: 'USER' }, 55);
    expect(out).toEqual({ role: null });
  });
});

describe('requireRoomMember()', () => {
  test('next() when user is MEMBER (via params.id)', async () => {
    prismaMock.participant.findUnique.mockResolvedValue({ role: 'MEMBER' });
    const { requireRoomMember } = await reloadModule();

    const mw = requireRoomMember(); // default param = 'id'
    const { req, res, next } = makeReqResNext({
      req: { user: { id: 2, role: 'USER' }, params: { id: '42' } },
    });

    await mw(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  test('next() when user is MEMBER (falls back to body.chatRoomId)', async () => {
    prismaMock.participant.findUnique.mockResolvedValue({ role: 'MEMBER' });
    const { requireRoomMember } = await reloadModule();

    const mw = requireRoomMember(); // will try params.id, then body.chatRoomId
    const { req, res, next } = makeReqResNext({
      req: { user: { id: 3 }, params: {}, body: { chatRoomId: 77 } },
    });

    await mw(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(prismaMock.participant.findUnique).toHaveBeenCalledWith({
      where: { userId_chatRoomId: { userId: 3, chatRoomId: 77 } },
      select: { role: true },
    });
  });

  test('forbidden when not a member', async () => {
    prismaMock.participant.findUnique.mockResolvedValue(null);
    const { requireRoomMember } = await reloadModule();

    const mw = requireRoomMember();
    const { req, res, next } = makeReqResNext({
      req: { user: { id: 4 }, params: { id: '100' } },
    });

    await mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(Error);
    expect(err.isBoom).toBe(true);
    expect(err.output.statusCode).toBe(403);
    expect(err.message).toBe('Not a member of this room');
  });
});

describe('requireRoomAdmin()', () => {
  test('next() when role=MODERATOR', async () => {
    prismaMock.participant.findUnique.mockResolvedValue({ role: 'MODERATOR' });
    const { requireRoomAdmin } = await reloadModule();

    const mw = requireRoomAdmin();
    const { req, res, next } = makeReqResNext({
      req: { user: { id: 5 }, params: { id: '21' } },
    });

    await mw(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  test('next() when role=ADMIN (room admin) OR global ADMIN', async () => {
    // Case 1: room ADMIN
    prismaMock.participant.findUnique.mockResolvedValue({ role: 'ADMIN' });
    const { requireRoomAdmin } = await reloadModule();

    const mw1 = requireRoomAdmin();
    const { req: req1, res: res1, next: next1 } = makeReqResNext({
      req: { user: { id: 6 }, params: { id: '22' } },
    });
    await mw1(req1, res1, next1);
    expect(next1).toHaveBeenCalledWith();

    // Case 2: global ADMIN (should bypass DB)
    prismaMock.participant.findUnique.mockClear();
    const mw2 = requireRoomAdmin();
    const { req: req2, res: res2, next: next2 } = makeReqResNext({
      req: { user: { id: 7, role: 'ADMIN' }, params: { id: '33' } },
    });
    await mw2(req2, res2, next2);
    expect(next2).toHaveBeenCalledWith();
    expect(prismaMock.participant.findUnique).not.toHaveBeenCalled();
  });

  test('forbidden when only MEMBER', async () => {
    prismaMock.participant.findUnique.mockResolvedValue({ role: 'MEMBER' });
    const { requireRoomAdmin } = await reloadModule();

    const mw = requireRoomAdmin();
    const { req, res, next } = makeReqResNext({
      req: { user: { id: 8 }, params: { id: '44' } },
    });

    await mw(req, res, next);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(Error);
    expect(err.isBoom).toBe(true);
    expect(err.output.statusCode).toBe(403);
    expect(err.message).toBe('Insufficient room permissions');
  });
});

describe('assertRoomAdminOrThrow()', () => {
  test('resolves when MODERATOR or ADMIN', async () => {
    prismaMock.participant.findUnique.mockResolvedValue({ role: 'MODERATOR' });
    const { assertRoomAdminOrThrow } = await reloadModule();

    await expect(
      assertRoomAdminOrThrow({ id: 9, role: 'USER' }, 55)
    ).resolves.toBeUndefined();
  });

  test('throws Boom forbidden when role is null', async () => {
    prismaMock.participant.findUnique.mockResolvedValue(null);
    const { assertRoomAdminOrThrow } = await reloadModule();

    await expect(
      assertRoomAdminOrThrow({ id: 10, role: 'USER' }, 66)
    ).rejects.toMatchObject({ isBoom: true, output: { statusCode: 403 } });
  });
});
