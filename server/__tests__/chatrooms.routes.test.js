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

const mockPrisma = {
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
        where: {},
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 2,
        include: { participants: { include: { user: true } } },
      });
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
        participants: [],
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
        participants: [],
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
    test('returns list of user public keys', async () => {
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
        where: { userId_chatRoomId: { userId: 2, chatRoomId: 10 } },
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

      expect(participantDelete).toHaveBeenCalledWith({
        where: { userId_chatRoomId: { userId: 2, chatRoomId: 10 } },
      });
    });
  });

  describe('meta routes', () => {
    test('GET /rooms/:id/meta returns room meta', async () => {
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