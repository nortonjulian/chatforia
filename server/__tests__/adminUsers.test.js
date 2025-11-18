/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

let prismaMock;
let adminUsersRouter;

beforeAll(async () => {
  // Mock Prisma BEFORE importing the router
  await jest.unstable_mockModule('@prisma/client', () => {
    prismaMock = {
      user: {
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    return {
      __esModule: true,
      // adminUsers.js: import pkg from '@prisma/client'; const { PrismaClient } = pkg;
      default: { PrismaClient: jest.fn(() => prismaMock) },
      PrismaClient: jest.fn(() => prismaMock),
    };
  });

  // Mock auth middlewares (router.use(requireAuth, requireAdmin))
  await jest.unstable_mockModule('../middleware/auth.js', () => ({
    __esModule: true,
    requireAuth: (req, _res, next) => {
      req.user = { id: 1, isAdmin: true };
      next();
    },
    requireAdmin: (_req, _res, next) => next(),
  }));

  ({ default: adminUsersRouter } = await import('../routes/adminUsers.js'));
});

afterEach(() => {
  jest.clearAllMocks();
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin/users', adminUsersRouter);
  return app;
}

describe('adminUsers routes', () => {
  describe('GET /admin/users', () => {
    test('returns items and total with default params', async () => {
      const app = buildApp();

      const fakeItems = [{ id: 1 }, { id: 2 }];
      prismaMock.user.findMany.mockResolvedValue(fakeItems);
      prismaMock.user.count.mockResolvedValue(2);

      const res = await request(app).get('/admin/users');

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ items: fakeItems, total: 2 });

      expect(prismaMock.user.findMany).toHaveBeenCalledWith({
        where: {},
        take: 50,
        skip: 0,
        orderBy: { createdAt: 'desc' },
        select: expect.any(Object),
      });
      expect(prismaMock.user.count).toHaveBeenCalledWith({ where: {} });
    });

    test('applies query, take, skip and caps take at 200', async () => {
      const app = buildApp();

      prismaMock.user.findMany.mockResolvedValue([]);
      prismaMock.user.count.mockResolvedValue(0);

      const res = await request(app)
        .get('/admin/users')
        .query({ query: 'jul', take: '500', skip: '10' });

      expect(res.statusCode).toBe(200);

      expect(prismaMock.user.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { username: { contains: 'jul', mode: 'insensitive' } },
            { email: { contains: 'jul', mode: 'insensitive' } },
            { phoneNumber: { contains: 'jul' } },
          ],
        },
        take: 200, // capped
        skip: 10,
        orderBy: { createdAt: 'desc' },
        select: expect.any(Object),
      });

      expect(prismaMock.user.count).toHaveBeenCalledWith({
        where: {
          OR: [
            { username: { contains: 'jul', mode: 'insensitive' } },
            { email: { contains: 'jul', mode: 'insensitive' } },
            { phoneNumber: { contains: 'jul' } },
          ],
        },
      });
    });

    test('returns 500 when prisma throws', async () => {
      const app = buildApp();

      prismaMock.user.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app).get('/admin/users');

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to list users' });
    });
  });

  describe('PATCH /admin/users/:id/role', () => {
    test('rejects invalid role', async () => {
      const app = buildApp();

      const res = await request(app)
        .patch('/admin/users/123/role')
        .send({ role: 'SUPERADMIN' });

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid role' });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    test('updates role when valid', async () => {
      const app = buildApp();

      const updatedUser = { id: 5, role: 'ADMIN' };
      prismaMock.user.update.mockResolvedValue(updatedUser);

      const res = await request(app)
        .patch('/admin/users/5/role')
        .send({ role: 'ADMIN' });

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(updatedUser);

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { role: 'ADMIN' },
      });
    });

    test('returns 500 when update fails', async () => {
      const app = buildApp();

      prismaMock.user.update.mockRejectedValue(new Error('fail'));

      const res = await request(app)
        .patch('/admin/users/5/role')
        .send({ role: 'USER' });

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to change role' });
    });
  });

  describe('PATCH /admin/users/:id/flags', () => {
    test('updates boolean flags based on body and sets audit', async () => {
      const app = buildApp();

      const updatedUser = {
        id: 7,
        allowExplicitContent: false,
        showOriginalWithTranslation: true,
        enableAIResponder: true,
        enableReadReceipts: false,
      };
      prismaMock.user.update.mockResolvedValue(updatedUser);

      const res = await request(app)
        .patch('/admin/users/7/flags')
        .send({
          allowExplicitContent: 0,
          showOriginalWithTranslation: 1,
          enableAIResponder: true,
          enableReadReceipts: false,
        });

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(updatedUser);

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: {
          allowExplicitContent: false,
          showOriginalWithTranslation: true,
          enableAIResponder: true,
          enableReadReceipts: false,
        },
      });
    });

    test('returns 500 when flag update fails', async () => {
      const app = buildApp();

      prismaMock.user.update.mockRejectedValue(new Error('fail'));

      const res = await request(app)
        .patch('/admin/users/7/flags')
        .send({ enableAIResponder: true });

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to update flags' });
    });
  });

  describe('POST /admin/users/:id/ban', () => {
    test('bans user and returns success payload', async () => {
      const app = buildApp();

      prismaMock.user.update.mockResolvedValue({
        id: 9,
        isBanned: true,
        bannedAt: new Date(),
      });

      const res = await request(app)
        .post('/admin/users/9/ban')
        .send({ reason: 'spam' });

      expect(res.statusCode).toBe(200);

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 9 },
        data: { isBanned: true, bannedAt: expect.any(Date) },
      });

      expect(res.body).toEqual({
        success: true,
        user: { id: 9, isBanned: true },
      });
    });

    test('returns 500 when ban fails', async () => {
      const app = buildApp();

      prismaMock.user.update.mockRejectedValue(new Error('fail'));

      const res = await request(app)
        .post('/admin/users/9/ban')
        .send({ reason: 'spam' });

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to ban user' });
    });
  });

  describe('POST /admin/users/:id/unban', () => {
    test('unbans user and returns success payload', async () => {
      const app = buildApp();

      prismaMock.user.update.mockResolvedValue({
        id: 10,
        isBanned: false,
        bannedAt: null,
      });

      const res = await request(app)
        .post('/admin/users/10/unban')
        .send({ reason: 'appeal approved' });

      expect(res.statusCode).toBe(200);

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { isBanned: false, bannedAt: null },
      });

      expect(res.body).toEqual({
        success: true,
        user: { id: 10, isBanned: false },
      });
    });

    test('returns 500 when unban fails', async () => {
      const app = buildApp();

      prismaMock.user.update.mockRejectedValue(new Error('fail'));

      const res = await request(app)
        .post('/admin/users/10/unban')
        .send({ reason: 'appeal approved' });

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to unban user' });
    });
  });

  describe('DELETE /admin/users/:id', () => {
    test('deletes user and returns success', async () => {
      const app = buildApp();

      prismaMock.user.delete.mockResolvedValue({});

      const res = await request(app).delete('/admin/users/77');

      expect(res.statusCode).toBe(200);
      expect(prismaMock.user.delete).toHaveBeenCalledWith({
        where: { id: 77 },
      });
      expect(res.body).toEqual({ success: true });
    });

    test('returns 500 when delete fails', async () => {
      const app = buildApp();

      prismaMock.user.delete.mockRejectedValue(new Error('fail'));

      const res = await request(app).delete('/admin/users/77');

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to delete user' });
    });
  });
});
