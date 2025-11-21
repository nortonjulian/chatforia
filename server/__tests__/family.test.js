import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

// ---- Prisma mock ----
const mockPrisma = {
  familyMember: {
    findFirst: jest.fn(),
    create: jest.fn().mockResolvedValue(null),
  },
  familyInvite: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn().mockResolvedValue(null),
  },
  $transaction: jest.fn((ops) => Promise.all(ops)),
};

// Mock the shared prisma client module used by routes/family.js
await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: mockPrisma,
}));

// Import router AFTER mocks are in place
const { default: router } = await import('../routes/family.js');

// Helper to build an app with a given user attached to req.user
function createTestApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/family', router);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('family routes', () => {
  describe('GET /family/me', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = createTestApp(null);

      const res = await request(app).get('/family/me');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Not authenticated' });
      expect(mockPrisma.familyMember.findFirst).not.toHaveBeenCalled();
    });

    it('returns family: null when user has no membership', async () => {
      const user = { id: 1 };
      mockPrisma.familyMember.findFirst.mockResolvedValueOnce(null);

      const app = createTestApp(user);
      const res = await request(app).get('/family/me');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ family: null });
      expect(mockPrisma.familyMember.findFirst).toHaveBeenCalledWith({
        where: { userId: 1 },
        include: {
          group: {
            include: {
              members: {
                include: { user: true },
              },
            },
          },
        },
      });
    });

    it('returns mapped family data when membership exists', async () => {
      const user = { id: 2 };
      mockPrisma.familyMember.findFirst.mockResolvedValueOnce({
        userId: 2,
        role: 'OWNER',
        groupId: 'g1',
        group: {
          id: 'g1',
          name: 'Norton Family',
          totalDataMb: 10240,
          usedDataMb: 2048,
          members: [
            {
              id: 'm1',
              userId: 2,
              role: 'OWNER',
              limitDataMb: null,
              usedDataMb: 1024,
              user: { displayName: 'Julian', email: 'julian@example.com' },
            },
            {
              id: 'm2',
              userId: 3,
              role: 'MEMBER',
              limitDataMb: 2048,
              usedDataMb: 512,
              user: { displayName: null, email: 'guest@example.com' },
            },
          ],
        },
      });

      const app = createTestApp(user);
      const res = await request(app).get('/family/me');

      expect(res.status).toBe(200);
      expect(res.body.family).toEqual({
        id: 'g1',
        name: 'Norton Family',
        role: 'OWNER',
        totalDataMb: 10240,
        usedDataMb: 2048,
        members: [
          {
            id: 'm1',
            userId: 2,
            role: 'OWNER',
            limitDataMb: null,
            usedDataMb: 1024,
            displayName: 'Julian',
          },
          {
            id: 'm2',
            userId: 3,
            role: 'MEMBER',
            limitDataMb: 2048,
            usedDataMb: 512,
            displayName: 'guest@example.com',
          },
        ],
      });
    });
  });

  describe('POST /family/invite', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = createTestApp(null);

      const res = await request(app)
        .post('/family/invite')
        .send({ email: 'friend@example.com' });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Not authenticated' });
    });

    it('returns 403 when user is not owner', async () => {
      const user = { id: 10 };
      mockPrisma.familyMember.findFirst.mockResolvedValueOnce({
        userId: 10,
        groupId: 'g2',
        role: 'MEMBER',
        group: {},
      });

      const app = createTestApp(user);
      const res = await request(app)
        .post('/family/invite')
        .send({ email: 'friend@example.com' });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Not family owner' });
    });

    it('creates invite when user is owner and returns joinUrl', async () => {
      const user = { id: 20 };
      process.env.APP_BASE_URL = 'https://example.com';

      mockPrisma.familyMember.findFirst.mockResolvedValueOnce({
        userId: 20,
        groupId: 'g3',
        role: 'OWNER',
        group: {},
      });

      mockPrisma.familyInvite.create.mockImplementationOnce(async ({ data }) => ({
        id: 'inv1',
        token: data.token,
        groupId: data.groupId,
        email: data.email,
        phone: data.phone,
        expiresAt: data.expiresAt,
        status: 'PENDING',
      }));

      const app = createTestApp(user);
      const res = await request(app)
        .post('/family/invite')
        .send({ email: 'friend@example.com' });

      expect(res.status).toBe(200);
      expect(mockPrisma.familyInvite.create).toHaveBeenCalled();

      const { invite } = res.body;
      expect(invite).toBeDefined();
      expect(invite.token).toBeTruthy();
      expect(invite.joinUrl).toBe(
        `https://example.com/family/join/${invite.token}`
      );
      expect(invite.expiresAt).toBeTruthy();
    });
  });

  describe('POST /family/join', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = createTestApp(null);

      const res = await request(app).post('/family/join').send({ token: 'abc' });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Not authenticated' });
    });

    it('returns 400 when token is missing', async () => {
      const user = { id: 30 };
      const app = createTestApp(user);

      const res = await request(app).post('/family/join').send({});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Missing token' });
    });

    it('returns 400 when invite is invalid or expired', async () => {
      const user = { id: 31 };
      // No invite found:
      mockPrisma.familyInvite.findUnique.mockResolvedValueOnce(null);

      const app = createTestApp(user);
      const res = await request(app).post('/family/join').send({ token: 'badtoken' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid or expired invite' });
    });

    it('returns 400 when user already belongs to a family', async () => {
      const user = { id: 32 };
      const future = new Date(Date.now() + 60 * 60 * 1000);

      mockPrisma.familyInvite.findUnique.mockResolvedValueOnce({
        id: 'inv-ok',
        token: 'goodtoken',
        groupId: 'g4',
        status: 'PENDING',
        expiresAt: future,
      });

      mockPrisma.familyMember.findFirst.mockResolvedValueOnce({
        id: 'fm1',
        userId: 32,
        groupId: 'gX',
      });

      const app = createTestApp(user);
      const res = await request(app).post('/family/join').send({ token: 'goodtoken' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'You already belong to a family' });
    });

    it('adds user to family and marks invite accepted on success', async () => {
      const user = { id: 33 };
      const future = new Date(Date.now() + 60 * 60 * 1000);

      mockPrisma.familyInvite.findUnique.mockResolvedValueOnce({
        id: 'inv-ok',
        token: 'goodtoken',
        groupId: 'g5',
        status: 'PENDING',
        expiresAt: future,
      });

      // No existing membership
      mockPrisma.familyMember.findFirst
        .mockResolvedValueOnce(null); // check existing membership

      mockPrisma.familyMember.create.mockResolvedValueOnce({
        id: 'fm2',
        groupId: 'g5',
        userId: 33,
        role: 'MEMBER',
      });

      mockPrisma.familyInvite.update.mockResolvedValueOnce({
        id: 'inv-ok',
        status: 'ACCEPTED',
      });

      const app = createTestApp(user);
      const res = await request(app).post('/family/join').send({ token: 'goodtoken' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      const [ops] = mockPrisma.$transaction.mock.calls[0];
      expect(Array.isArray(ops)).toBe(true);
      expect(ops.length).toBe(2);

      expect(mockPrisma.familyMember.create).toHaveBeenCalledWith({
        data: {
          groupId: 'g5',
          userId: 33,
          role: 'MEMBER',
        },
      });

      expect(mockPrisma.familyInvite.update).toHaveBeenCalledWith({
        where: { id: 'inv-ok' },
        data: expect.objectContaining({
          status: 'ACCEPTED',
          acceptedAt: expect.any(Date),
        }),
      });
    });
  });
});
