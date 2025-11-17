import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// --- Prisma + middleware mocks ---
const mockPrisma = {
  chatRoom: {
    findUnique: jest.fn(),
  },
  chatRoomInvite: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  participant: {
    upsert: jest.fn(),
  },
};

// Fake PrismaClient: new PrismaClient() -> mockPrisma
class FakePrismaClient {
  constructor() {
    return mockPrisma;
  }
}

const mockRequireAuth = jest.fn((req, _res, next) => {
  // Simulate authed user
  req.user = { id: 1 };
  next();
});

// ---- Mock modules BEFORE importing the router ----
await jest.unstable_mockModule('@prisma/client', () => ({
  __esModule: true,
  default: { PrismaClient: FakePrismaClient },
}));

await jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: mockRequireAuth,
}));

// Import router under test
const groupInvitesRouter = (await import('../routes/groupInvites.js')).default;

// Build an Express app using the router
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/', groupInvitesRouter);

  // Generic error handler (should rarely be hit here)
  app.use((err, _req, res, _next) => {
    return res.status(500).json({ error: err.message });
  });

  return app;
}

describe('groupInvites routes', () => {
  let app;

  beforeEach(() => {
    app = makeApp();
    jest.clearAllMocks();
    // Default base URL for invites
    process.env.APP_BASE_URL = 'https://app.test';
  });

  describe('POST /chatrooms/:roomId/invites (create invite)', () => {
    it('creates an invite when user is owner/admin', async () => {
      // User is owner of room 10
      mockPrisma.chatRoom.findUnique.mockResolvedValue({
        ownerId: 1,
        participants: [],
      });

      const inviteRow = {
        code: 'invitecode123',
        expiresAt: new Date('2030-01-01T00:00:00.000Z').toISOString(),
        maxUses: 5,
        usedCount: 0,
      };
      mockPrisma.chatRoomInvite.create.mockResolvedValue(inviteRow);

      const res = await request(app)
        .post('/chatrooms/10/invites')
        .send({ maxUses: 5, expiresInMinutes: 60 })
        .expect(200);

      // Permission check
      expect(mockPrisma.chatRoom.findUnique).toHaveBeenCalledWith({
        where: { id: 10 },
        select: {
          ownerId: true,
          participants: {
            where: { userId: 1 },
            select: { role: true },
          },
        },
      });

      // Invite creation
      const createArgs = mockPrisma.chatRoomInvite.create.mock.calls[0][0];
      expect(createArgs.where).toBeUndefined();
      expect(createArgs.data.chatRoomId).toBe(10);
      expect(createArgs.data.createdById).toBe(1);
      expect(createArgs.data.maxUses).toBe(5);
      expect(createArgs.data.expiresAt).toBeInstanceOf(Date);

      // URL built from APP_BASE_URL + /join/:code
      expect(res.body).toEqual({
        code: 'invitecode123',
        expiresAt: inviteRow.expiresAt,
        maxUses: 5,
        usedCount: 0,
        url: 'https://app.test/join/invitecode123',
      });
    });

    it('returns 403 when user cannot manage room', async () => {
      // User is neither owner nor ADMIN
      mockPrisma.chatRoom.findUnique.mockResolvedValue({
        ownerId: 2,
        participants: [{ role: 'MEMBER' }],
      });

      const res = await request(app)
        .post('/chatrooms/10/invites')
        .send({ maxUses: 5 })
        .expect(403);

      expect(res.body).toEqual({ error: 'Forbidden' });
      expect(mockPrisma.chatRoomInvite.create).not.toHaveBeenCalled();
    });
  });

  describe('GET /chatrooms/:roomId/invites (list invites)', () => {
    it('lists invites for a room when user can manage room', async () => {
      mockPrisma.chatRoom.findUnique.mockResolvedValue({
        ownerId: 1,
        participants: [],
      });

      const invites = [
        {
          code: 'c1',
          maxUses: 5,
          usedCount: 1,
          expiresAt: null,
          revokedAt: null,
          createdAt: '2025-01-01T00:00:00.000Z',
        },
        {
          code: 'c2',
          maxUses: 0,
          usedCount: 0,
          expiresAt: '2030-01-01T00:00:00.000Z',
          revokedAt: null,
          createdAt: '2025-01-02T00:00:00.000Z',
        },
      ];
      mockPrisma.chatRoomInvite.findMany.mockResolvedValue(invites);

      const res = await request(app)
        .get('/chatrooms/10/invites')
        .expect(200);

      expect(mockPrisma.chatRoomInvite.findMany).toHaveBeenCalledWith({
        where: { chatRoomId: 10 },
        orderBy: { createdAt: 'desc' },
        select: {
          code: true,
          maxUses: true,
          usedCount: true,
          expiresAt: true,
          revokedAt: true,
          createdAt: true,
        },
      });

      expect(res.body).toEqual(invites);
    });
  });

  describe('DELETE /chatrooms/:roomId/invites/:code (revoke invite)', () => {
    it('revokes invite when user can manage room', async () => {
      mockPrisma.chatRoom.findUnique.mockResolvedValue({
        ownerId: 1,
        participants: [],
      });

      mockPrisma.chatRoomInvite.update.mockResolvedValue({});

      const res = await request(app)
        .delete('/chatrooms/10/invites/abc123')
        .expect(200);

      expect(mockPrisma.chatRoomInvite.update).toHaveBeenCalledWith({
        where: { code: 'abc123' },
        data: { revokedAt: expect.any(Date) },
      });

      expect(res.body).toEqual({ ok: true });
    });
  });

  describe('GET /invites/:code (resolve/preview invite)', () => {
    it('returns 404 when invite does not exist', async () => {
      mockPrisma.chatRoomInvite.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/invites/unknown')
        .expect(404);

      expect(res.body).toEqual({ error: 'Invite not found' });
    });

    it('returns status "ok" when invite is valid', async () => {
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      mockPrisma.chatRoomInvite.findUnique.mockResolvedValue({
        code: 'okcode',
        expiresAt: future,
        maxUses: 10,
        usedCount: 1,
        revokedAt: null,
        chatRoom: { id: 123, name: 'Cool Room' },
      });

      const res = await request(app)
        .get('/invites/okcode')
        .expect(200);

      expect(res.body).toEqual({
        code: 'okcode',
        roomId: 123,
        roomName: 'Cool Room',
        status: 'ok',
      });
    });

    it('returns status "expired" when invite is expired', async () => {
      const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      mockPrisma.chatRoomInvite.findUnique.mockResolvedValue({
        code: 'expiredcode',
        expiresAt: past,
        maxUses: 0,
        usedCount: 0,
        revokedAt: null,
        chatRoom: { id: 123, name: 'Room' },
      });

      const res = await request(app)
        .get('/invites/expiredcode')
        .expect(200);

      expect(res.body.status).toBe('expired');
    });
  });

  describe('POST /invites/:code/accept (join via invite)', () => {
    it('allows join when invite is valid and increments usedCount', async () => {
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      mockPrisma.chatRoomInvite.findUnique.mockResolvedValue({
        id: 1,
        code: 'joincode',
        expiresAt: future,
        maxUses: 5,
        usedCount: 1,
        revokedAt: null,
        chatRoomId: 999,
      });

      mockPrisma.participant.upsert.mockResolvedValue({});
      mockPrisma.chatRoomInvite.update.mockResolvedValue({});

      const res = await request(app)
        .post('/invites/joincode/accept')
        .expect(200);

      // Participant upsert as MEMBER
      expect(mockPrisma.participant.upsert).toHaveBeenCalledWith({
        where: {
          chatRoomId_userId: { chatRoomId: 999, userId: 1 },
        },
        create: {
          chatRoomId: 999,
          userId: 1,
          role: 'MEMBER',
        },
        update: {},
      });

      // usedCount increment
      expect(mockPrisma.chatRoomInvite.update).toHaveBeenCalledWith({
        where: { code: 'joincode' },
        data: { usedCount: { increment: 1 } },
      });

      expect(res.body).toEqual({ ok: true, roomId: 999 });
    });

    it('returns 410 when invite is revoked', async () => {
      mockPrisma.chatRoomInvite.findUnique.mockResolvedValue({
        id: 1,
        code: 'revoked',
        expiresAt: null,
        maxUses: 0,
        usedCount: 0,
        revokedAt: new Date().toISOString(),
        chatRoomId: 1,
      });

      const res = await request(app)
        .post('/invites/revoked/accept')
        .expect(410);

      expect(res.body).toEqual({ error: 'Invite revoked' });
      expect(mockPrisma.participant.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.chatRoomInvite.update).not.toHaveBeenCalled();
    });

    it('returns 404 when invite not found', async () => {
      mockPrisma.chatRoomInvite.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/invites/missing/accept')
        .expect(404);

      expect(res.body).toEqual({ error: 'Invite not found' });
    });
  });
});
