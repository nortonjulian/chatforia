/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const chatRoomCreate = jest.fn();
const chatRoomFindMany = jest.fn();
const chatRoomFindFirst = jest.fn();
const chatRoomFindUnique = jest.fn();
const chatRoomUpdate = jest.fn();

const participantCreate = jest.fn();
const participantCreateMany = jest.fn();
const participantFindMany = jest.fn();
const participantFindFirst = jest.fn();
const participantFindUnique = jest.fn();
const participantDelete = jest.fn();
const participantUpdate = jest.fn();
const participantUpdateMany = jest.fn();

const userBlockFindFirst = jest.fn();
const mockPrisma = {
  userBlock: { findFirst: userBlockFindFirst },
  $transaction: jest.fn((fn) =>
    fn({
      chatRoom: { create: chatRoomCreate },
      participant: {
        create: participantCreate,
        createMany: participantCreateMany,
      },
    })
  ),
  chatRoom: {
    create: chatRoomCreate,
    findMany: chatRoomFindMany,
    findFirst: chatRoomFindFirst,
    findUnique: chatRoomFindUnique,
    update: chatRoomUpdate,
  },
  participant: {
    create: participantCreate,
    createMany: participantCreateMany,
    findMany: participantFindMany,
    findFirst: participantFindFirst,
    findUnique: participantFindUnique,
    delete: participantDelete,
    update: participantUpdate,
    updateMany: participantUpdateMany,
  },
};

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  default: mockPrisma,
}));

const getEffectiveRoomRankMock = jest.fn();
const canActOnRankMock = jest.fn();
const requireRoomRankMock = jest.fn(() => (_req, _res, next) => next());

const RoleRank = {
  MEMBER: 0,
  MODERATOR: 1,
  ADMIN: 2,
  OWNER: 3,
};

await jest.unstable_mockModule('../utils/roomAuth.js', () => ({
  RoleRank,
  requireRoomRank: (...args) => requireRoomRankMock(...args),
  getEffectiveRoomRank: (...args) => getEffectiveRoomRankMock(...args),
  canActOnRank: (...args) => canActOnRankMock(...args),
}));

await jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 1, role: 'ADMIN', username: 'admin' };
    next();
  },
}));

const chatroomsModule = await import('../routes/chatrooms.js');
const chatroomsRouter = chatroomsModule.default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/rooms', chatroomsRouter);

  app.use((err, req, res, next) => {
    if (err && err.isBoom && err.output) {
      const { statusCode, payload } = err.output;
      return res.status(statusCode).json(payload);
    }

    return res
      .status(err.status || 500)
      .json({ error: err.message || 'Internal server error' });
  });

  return app;
}

describe('chatrooms routes', () => {
  let app;

  beforeEach(() => {
    app = makeApp();

    jest.clearAllMocks();

    userBlockFindFirst.mockReset();
    userBlockFindFirst.mockResolvedValue(null);
    chatRoomCreate.mockReset();
    chatRoomFindMany.mockReset();
    chatRoomFindFirst.mockReset();
    chatRoomFindUnique.mockReset();
    chatRoomUpdate.mockReset();

    participantCreate.mockReset();
    participantCreateMany.mockReset();
    participantFindMany.mockReset();
    participantFindFirst.mockReset();
    participantFindUnique.mockReset();
    participantDelete.mockReset();
    participantUpdate.mockReset();
    participantUpdateMany.mockReset();

    getEffectiveRoomRankMock.mockReset();
    canActOnRankMock.mockReset();
    requireRoomRankMock.mockReset();
    requireRoomRankMock.mockImplementation(() => (_req, _res, next) => next());

    mockPrisma.$transaction.mockReset();
    mockPrisma.$transaction.mockImplementation((fn) =>
      fn({
        chatRoom: { create: chatRoomCreate },
        participant: {
          create: participantCreate,
          createMany: participantCreateMany,
        },
      })
    );
  });

  describe('POST /rooms/', () => {
    test('creates room and participants in a transaction', async () => {
      chatRoomCreate.mockResolvedValueOnce({
        id: 10,
        name: 'Test Room',
        isGroup: true,
        ownerId: 1,
      });

      const res = await request(app)
        .post('/rooms')
        .send({ name: 'Test Room', isGroup: true, userIds: [2, 3] });

      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty('id', 10);
      expect(res.body.room).toMatchObject({
        id: 10,
        name: 'Test Room',
        isGroup: true,
        ownerId: 1,
      });

      expect(participantCreate).toHaveBeenCalledWith({
        data: { chatRoomId: 10, userId: 1, role: 'ADMIN' },
      });

      expect(participantCreateMany).toHaveBeenCalledWith({
        data: [
          { chatRoomId: 10, userId: 2, role: 'MEMBER' },
          { chatRoomId: 10, userId: 3, role: 'MEMBER' },
        ],
        skipDuplicates: true,
      });

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /rooms/', () => {
    test('lists rooms with limit and nextCursor when full page', async () => {
      const now = new Date('2025-01-01T00:00:00.000Z');

      chatRoomFindMany.mockResolvedValue([
        { id: 5, updatedAt: now, participants: [] },
        { id: 4, updatedAt: now, participants: [] },
      ]);

      const res = await request(app).get('/rooms?limit=2');

      expect(res.statusCode).toBe(200);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.count).toBe(2);
      expect(res.body.nextCursor).toEqual({
        id: 4,
        updatedAt: now.toISOString(),
      });

      expect(chatRoomFindMany).toHaveBeenCalledWith({
        where: {
          AND: [{ participants: { some: { userId: 1 } } }],
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 2,
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  displayName: true,
                  avatarUrl: true,
                  publicKey: true,
                  preferredLanguage: true,
                  autoTranslate: true,
                },
              },
            },
          },
        },
      });
    });
  });

  describe('GET /rooms/ privacy', () => {
    test('optional user filter cannot remove the requester membership constraint', async () => {
      chatRoomFindMany.mockResolvedValueOnce([]);
      const res = await request(app).get('/rooms?userId=2');
      expect(res.statusCode).toBe(200);
      expect(chatRoomFindMany.mock.calls[0][0].where).toEqual({
        AND: [
          { participants: { some: { userId: 1 } } },
          { participants: { some: { userId: 2 } } },
        ],
      });
    });

    test('cursor pagination still retains requester membership scoping', async () => {
      chatRoomFindMany.mockResolvedValueOnce([]);
      const at = '2026-10-20T00:00:00.000Z';
      const res = await request(app).get('/rooms')
        .query({ limit: 3, cursorId: 12, cursorUpdatedAt: at });
      expect(res.statusCode).toBe(200);
      expect(chatRoomFindMany.mock.calls[0][0].where).toEqual({
        AND: [{ participants: { some: { userId: 1 } } }],
        OR: [
          { updatedAt: { lt: new Date(at) } },
          { updatedAt: new Date(at), id: { lt: 12 } },
        ],
      });
    });

    test('rejects malformed optional user id without hitting the database', async () => {
      const res = await request(app).get('/rooms?userId=oops');
      expect(res.statusCode).toBe(400);
      expect(chatRoomFindMany).not.toHaveBeenCalled();
    });
  });

  describe('POST /rooms/direct/:targetUserId', () => {
    test('returns 400 for duplicate user IDs', async () => {
      const res = await request(app).post('/rooms/direct/1').send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.error || res.body.message).toBeDefined();
    });

    test('returns existing direct room if found', async () => {
      const existing = {
        id: 20,
        isGroup: false,
        participants: [
          { userId: 1, role: 'ADMIN' },
          { userId: 2, role: 'MEMBER' },
        ],
        messages: [
          {
            id: 100,
            createdAt: new Date('2025-01-01T00:00:00.000Z'),
          },
        ],
      };

      chatRoomFindMany.mockResolvedValueOnce([existing]);

      const res = await request(app).post('/rooms/direct/2').send({});

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        id: 20,
        isGroup: false,
        participants: [
          { userId: 1, role: 'ADMIN' },
          { userId: 2, role: 'MEMBER' },
        ],
      });

      expect(chatRoomFindMany).toHaveBeenCalled();
      expect(chatRoomCreate).not.toHaveBeenCalled();
    });

    test('creates new direct room when none exists', async () => {
      chatRoomFindMany.mockResolvedValueOnce([]);

      const created = {
        id: 30,
        isGroup: false,
        participants: [
          { userId: 1, role: 'ADMIN' },
          { userId: 2, role: 'MEMBER' },
        ],
      };

      chatRoomCreate.mockResolvedValueOnce(created);

      const res = await request(app).post('/rooms/direct/2').send({});

      expect(res.statusCode).toBe(201);
      expect(res.body).toEqual(created);

      expect(chatRoomCreate).toHaveBeenCalledWith({
        data: {
          isGroup: false,
          participants: {
            create: [
              { user: { connect: { id: 1 } }, role: 'ADMIN' },
              { user: { connect: { id: 2 } }, role: 'MEMBER' },
            ],
          },
        },
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      });
    });
  });

  describe('POST /rooms/group', () => {
    test('400 if fewer than 2 user IDs', async () => {
      const res = await request(app)
        .post('/rooms/group')
        .send({ userIds: [2], name: 'group' });

      expect(res.statusCode).toBe(400);
      expect(res.body.error || res.body.message).toBeDefined();
    });

    test('creates group when none exists', async () => {
      chatRoomFindFirst.mockResolvedValueOnce(null);

      const created = {
        id: 50,
        name: 'Group chat',
        isGroup: true,
        participants: [],
      };

      chatRoomCreate.mockResolvedValueOnce(created);

      const res = await request(app)
        .post('/rooms/group')
        .send({ userIds: [1, 2, 3] });

      expect(res.statusCode).toBe(201);
      expect(res.body).toEqual(created);

      expect(chatRoomCreate).toHaveBeenCalled();
    });
  });

  describe('GET /rooms/:id/public-keys', () => {
    test('403 for a nonmember, before querying users', async () => {
      participantFindFirst.mockResolvedValueOnce(null);
      const res = await request(app).get('/rooms/10/public-keys');
      expect(res.statusCode).toBe(403);
      expect(participantFindMany).not.toHaveBeenCalled();
    });

    test('returns list of user public keys', async () => {
      participantFindFirst.mockResolvedValueOnce({ id: 1 });
      participantFindMany.mockResolvedValueOnce([
        { user: { id: 1, publicKey: 'pub1', username: 'alice' } },
        { user: { id: 2, publicKey: 'pub2', username: 'bob' } },
      ]);

      const res = await request(app).get('/rooms/10/public-keys');

      expect(res.statusCode).toBe(200);

      expect(res.body).toEqual([
        { id: 1, publicKey: 'pub1', username: 'alice' },
        { id: 2, publicKey: 'pub2', username: 'bob' },
      ]);

      expect(participantFindMany).toHaveBeenCalledWith({
        where: { chatRoomId: 10 },
        include: {
          user: { select: { id: true, publicKey: true, username: true } },
        },
      });
    });
  });

  describe('POST /rooms/:id/participants/:userId/promote', () => {
    test('allows global admin and updates participant role', async () => {
      mockPrisma.participant.update = jest
        .fn()
        .mockResolvedValue({ userId: 2, role: 'ADMIN' });

      const res = await request(app).post('/rooms/10/participants/2/promote');

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        participant: { userId: 2, role: 'ADMIN' },
      });

      expect(mockPrisma.participant.update).toHaveBeenCalledWith({
        where: { chatRoomId_userId: { chatRoomId: 10, userId: 2 } },
        data: { role: 'ADMIN' },
      });
    });
  });

  describe('GET /rooms/:id/participants', () => {
    test('returns list of participants with ownerId null', async () => {
      participantFindFirst.mockResolvedValueOnce({ userId: 1 });

      chatRoomFindUnique.mockResolvedValueOnce({
        ownerId: null,
        participants: [
          {
            userId: 1,
            role: 'ADMIN',
            user: {
              id: 1,
              username: 'admin',
              publicKey: null,
            },
          },
          {
            userId: 2,
            role: 'MEMBER',
            user: {
              id: 2,
              username: 'bob',
              publicKey: 'pub2',
            },
          },
        ],
      });

      const res = await request(app).get('/rooms/10/participants');

      expect(res.statusCode).toBe(200);
      expect(res.body.ownerId).toBeNull();
      expect(res.body.participants).toHaveLength(2);

      expect(res.body.participants[0]).toMatchObject({
        userId: 1,
        role: 'ADMIN',
      });

      expect(participantFindFirst).toHaveBeenCalledWith({
        where: { chatRoomId: 10, userId: 1 },
        select: { userId: true },
      });

      expect(chatRoomFindUnique).toHaveBeenCalledWith({
        where: { id: 10 },
        select: {
          ownerId: true,
          participants: {
            select: {
              userId: true,
              role: true,
              user: {
                select: {
                  id: true,
                  username: true,
                  publicKey: true,
                  preferredLanguage: true,
                  autoTranslate: true,
                },
              },
            },
          },
        },
      });
    });
  });

  describe('POST /rooms/:id/participants', () => {
    test('returns ok=true if participant already exists', async () => {
      participantFindUnique.mockResolvedValueOnce({
        userId: 2,
        chatRoomId: 10,
      });

      const res = await request(app)
        .post('/rooms/10/participants')
        .send({ userId: 2 });

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true });

      expect(participantFindUnique).toHaveBeenCalledWith({
        where: { chatRoomId_userId: { chatRoomId: 10, userId: 2 } },
      });

      expect(participantCreate).not.toHaveBeenCalled();
    });

    test('creates participant when not existing', async () => {
      participantFindUnique.mockResolvedValueOnce(null);
      participantCreate.mockResolvedValueOnce({ userId: 2, role: 'MEMBER' });

      const res = await request(app)
        .post('/rooms/10/participants')
        .send({ userId: 2 });

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        participant: { userId: 2, role: 'MEMBER' },
      });

      expect(participantCreate).toHaveBeenCalledWith({
        data: { userId: 2, chatRoomId: 10, role: 'MEMBER' },
        select: { userId: true, role: true },
      });
    });
  });

  describe('DELETE /rooms/:id/participants/:userId', () => {
    test('forbidden when actor rank < MODERATOR', async () => {
      getEffectiveRoomRankMock.mockResolvedValueOnce(RoleRank.MEMBER);

      const res = await request(app).delete('/rooms/10/participants/2');

      expect(res.statusCode).toBe(403);
      expect(res.body.error || res.body.message).toBeDefined();
      expect(participantDelete).not.toHaveBeenCalled();
    });

    test('deletes participant when actor has rank and canActOnRank returns true', async () => {
      getEffectiveRoomRankMock.mockResolvedValueOnce(RoleRank.OWNER);
      participantFindUnique.mockResolvedValueOnce({ role: 'MEMBER' });
      canActOnRankMock.mockReturnValueOnce(true);
      participantDelete.mockResolvedValueOnce({});

      const res = await request(app).delete('/rooms/10/participants/2');

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true });

      expect(participantFindUnique).toHaveBeenCalledWith({
        where: { chatRoomId_userId: { chatRoomId: 10, userId: 2 } },
        select: { role: true },
      });
      expect(participantDelete).toHaveBeenCalledWith({
        where: { chatRoomId_userId: { chatRoomId: 10, userId: 2 } },
      });
    });
  });

  test('removing a participant evicts their active group sockets', async () => {
    const { setSocketIo, _resetSocketBus } =
      await import('../services/socketBus.js');

    const socketsLeave = jest.fn().mockResolvedValue(undefined);
    const roomIo = {
      in: jest.fn(() => ({ socketsLeave })),
    };

    setSocketIo(roomIo);

    try {
      getEffectiveRoomRankMock.mockResolvedValueOnce(RoleRank.OWNER);
      participantFindUnique.mockResolvedValueOnce({ role: 'MEMBER' });
      canActOnRankMock.mockReturnValueOnce(true);
      participantDelete.mockResolvedValueOnce({});

      const res = await request(app)
        .delete('/rooms/10/participants/2');

      expect(res.statusCode).toBe(200);
      expect(participantDelete).toHaveBeenCalledTimes(1);
      expect(roomIo.in).toHaveBeenCalledWith('user:2');
      expect(socketsLeave).toHaveBeenCalledWith('10');
    } finally {
      _resetSocketBus();
    }
  });

  describe('meta routes', () => {
    test('GET /rooms/:id/meta returns 403 for a nonmember', async () => {
      participantFindFirst.mockResolvedValueOnce(null);
      const res = await request(app).get('/rooms/10/meta');
      expect(res.statusCode).toBe(403);
      expect(chatRoomFindUnique).not.toHaveBeenCalled();
    });

    test('GET /rooms/:id/meta returns room meta', async () => {
      participantFindFirst.mockResolvedValueOnce({ id: 1 });
      chatRoomFindUnique.mockResolvedValueOnce({
        id: 10,
        name: 'Meta Room',
        description: 'desc',
      });

      const res = await request(app).get('/rooms/10/meta');

      expect(res.statusCode).toBe(200);

      expect(res.body).toEqual({
        id: 10,
        name: 'Meta Room',
        description: 'desc',
      });

      expect(chatRoomFindUnique).toHaveBeenCalledWith({
        where: { id: 10 },
        select: { id: true, name: true, description: true },
      });
    });

    test('PATCH /rooms/:id/meta updates description', async () => {
      chatRoomUpdate.mockResolvedValueOnce({
        id: 10,
        description: 'updated',
      });

      const res = await request(app)
        .patch('/rooms/10/meta')
        .send({ description: 'updated' });

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ id: 10, description: 'updated' });

      expect(chatRoomUpdate).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { description: 'updated' },
        select: { id: true, description: true },
      });
    });
  });
});

describe('production Room settings route contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chatRoomFindUnique.mockReset();
    chatRoomUpdate.mockReset();
    participantFindUnique.mockReset();
    participantUpdate.mockReset();
    participantUpdateMany.mockReset();
    getEffectiveRoomRankMock.mockReset();
    canActOnRankMock.mockReset();
    requireRoomRankMock.mockImplementation(() => (_req, _res, next) => next());
  });
  test('room owner changes existing member role (no upsert)', async () => {
    getEffectiveRoomRankMock.mockResolvedValueOnce(RoleRank.OWNER);
    chatRoomFindUnique.mockResolvedValueOnce({ ownerId: 1 });
    participantFindUnique.mockResolvedValueOnce({ userId: 3, role: 'MEMBER' });
    canActOnRankMock.mockReturnValueOnce(true);
    participantUpdate.mockResolvedValueOnce({ userId: 3, role: 'MODERATOR' });
    const res = await request(makeApp()).patch('/rooms/42/participants/3/role').send({ role: 'MODERATOR' });
    // Verify the response proves a persisted update, not merely a 200 status.
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      participant: { userId: 3, role: 'MODERATOR' },
    });
    expect(participantUpdate).toHaveBeenCalledWith({
      where: { chatRoomId_userId: { chatRoomId: 42, userId: 3 } },
      data: { role: 'MODERATOR' },
      select: { userId: true, role: true },
    });
  });

  test('unprivileged user cannot change participant role', async () => {
    getEffectiveRoomRankMock.mockResolvedValueOnce(RoleRank.MEMBER);
    chatRoomFindUnique.mockResolvedValueOnce({ ownerId: 4 });
    participantFindUnique.mockResolvedValueOnce({ userId: 3, role: 'MEMBER' });
    const res = await request(makeApp()).patch('/rooms/42/participants/3/role').send({ role: 'ADMIN' });
    expect(res.statusCode).toBe(403);
    expect(participantUpdate).not.toHaveBeenCalled();
  });

  test('AI mode persists enum case and rejects unsupported modes', async () => {
    chatRoomUpdate.mockResolvedValueOnce({ id: 42, aiAssistantMode: 'MENTION', allowForiaBot: false });
    const accepted = await request(makeApp()).patch('/rooms/42/ai-assistant').send({ mode: 'mention' });
    expect(accepted.statusCode).toBe(200);
    expect(chatRoomUpdate).toHaveBeenCalledWith({
      where: { id: 42 }, data: { aiAssistantMode: 'MENTION' },
      select: { id: true, aiAssistantMode: true, allowForiaBot: true },
    });
    const rejected = await request(makeApp()).patch('/rooms/42/ai-assistant').send({ mode: 'everything' });
    expect(rejected.statusCode).toBe(400);
  });

  test('AI opt-in is restricted to caller membership', async () => {
    participantUpdateMany.mockResolvedValueOnce({ count: 0 });
    const notMember = await request(makeApp()).patch('/rooms/42/ai-opt').send({ allow: true });
    expect(notMember.statusCode).toBe(403);
    participantUpdateMany.mockResolvedValueOnce({ count: 1 });
    const consent = await request(makeApp()).patch('/rooms/42/ai-opt').send({ allow: false });
    expect(consent.statusCode).toBe(200);
    expect(participantUpdateMany).toHaveBeenCalledWith({
      where: { chatRoomId: 42, userId: 1 }, data: { allowAIBot: false },
    });
  });

  test('room translation stores correct enum and validates requested modes', async () => {
    chatRoomUpdate.mockResolvedValueOnce({ id: 42, autoTranslateMode: 'TAGGED' });
    const valid = await request(makeApp()).patch('/rooms/42/auto-translate').send({ mode: 'tagged' });
    expect(valid.statusCode).toBe(200);
    expect(chatRoomUpdate).toHaveBeenCalledWith({
      where: { id: 42 }, data: { autoTranslateMode: 'TAGGED' },
      select: { id: true, autoTranslateMode: true },
    });
    const invalid = await request(makeApp()).patch('/rooms/42/auto-translate').send({ mode: 'nonsense' });
    expect(invalid.statusCode).toBe(400);
  });
});
