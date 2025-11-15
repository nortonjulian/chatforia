/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// ---- mock PrismaClient ----
const mockPrisma = {
  auditLog: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

// routes/adminAudit.js does:
//   import pkg from '@prisma/client';
//   const { PrismaClient } = pkg;
//   const prisma = new PrismaClient();
await jest.unstable_mockModule('@prisma/client', () => {
  const PrismaClient = jest.fn(() => mockPrisma);
  return {
    default: { PrismaClient },
    PrismaClient,
  };
});

// ---- mock auth middleware (requireAuth + requireAdmin) ----
await jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 1, role: 'ADMIN' };
    next();
  },
  requireAdmin: (_req, _res, next) => next(),
}));

// import router AFTER mocks
const adminAuditModule = await import('../routes/adminAudit.js');
const adminAuditRouter = adminAuditModule.default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin/audit', adminAuditRouter);
  return app;
}

describe('adminAudit routes', () => {
  let app;

  beforeEach(() => {
    app = makeApp();
    jest.clearAllMocks();
  });

  describe('GET /admin/audit', () => {
    test('returns items and total with default pagination', async () => {
      const now = new Date('2025-01-01T00:00:00.000Z');

      const prismaItems = [
        {
          id: 1,
          createdAt: now,
          action: 'USER_BANNED',
          actorId: 1,
          targetUserId: 2,
          targetMessageId: null,
          targetReportId: null,
          notes: 'manual ban',
          actor: { id: 1, username: 'admin', role: 'ADMIN' },
        },
      ];

      mockPrisma.auditLog.findMany.mockResolvedValue(prismaItems);
      mockPrisma.auditLog.count.mockResolvedValue(1);

      const res = await request(app).get('/admin/audit');

      expect(res.statusCode).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items).toHaveLength(1);

      // createdAt should be serialized as ISO string
      expect(res.body.items[0].createdAt).toBe(now.toISOString());

      // rest of the fields should match
      expect(res.body.items[0]).toMatchObject({
        id: 1,
        action: 'USER_BANNED',
        actorId: 1,
        targetUserId: 2,
        targetMessageId: null,
        targetReportId: null,
        notes: 'manual ban',
        actor: { id: 1, username: 'admin', role: 'ADMIN' },
      });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
        where: {},
        take: 50,
        skip: 0,
        orderBy: { createdAt: 'desc' },
        include: {
          actor: { select: { id: true, username: true, role: true } },
        },
      });

      expect(mockPrisma.auditLog.count).toHaveBeenCalledWith({
        where: {},
      });
    });

    test('applies filters, take, and skip from query params', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);

      const res = await request(app)
        .get('/admin/audit')
        .query({ actorId: '5', action: 'ban', take: '100', skip: '200' });

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ items: [], total: 0 });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
        where: {
          actorId: 5,
          action: { contains: 'ban', mode: 'insensitive' },
        },
        take: 100,
        skip: 200,
        orderBy: { createdAt: 'desc' },
        include: {
          actor: { select: { id: true, username: true, role: true } },
        },
      });

      expect(mockPrisma.auditLog.count).toHaveBeenCalledWith({
        where: {
          actorId: 5,
          action: { contains: 'ban', mode: 'insensitive' },
        },
      });
    });

    test('caps take at 500', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);

      await request(app)
        .get('/admin/audit')
        .query({ take: '9999' });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
        where: {},
        take: 500, // capped
        skip: 0,
        orderBy: { createdAt: 'desc' },
        include: {
          actor: { select: { id: true, username: true, role: true } },
        },
      });
    });

    test('500 on Prisma error', async () => {
      mockPrisma.auditLog.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app).get('/admin/audit');

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to fetch audit logs' });
    });
  });

  describe('GET /admin/audit/export.csv', () => {
    test('returns CSV with expected headers and rows', async () => {
      const now = new Date('2025-01-01T00:00:00.000Z');

      mockPrisma.auditLog.findMany.mockResolvedValue([
        {
          id: 1,
          createdAt: now,
          action: 'USER_BANNED',
          actorId: 1,
          targetUserId: 2,
          targetMessageId: null,
          targetReportId: null,
          notes: 'manual "ban"', // has quotes to test escaping
          actor: { id: 1, username: 'admin', role: 'ADMIN' },
        },
      ]);

      const res = await request(app).get('/admin/audit/export.csv');

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('audit-export.csv');

      const body = res.text;
      const lines = body.split('\n');

      // header
      expect(lines[0]).toBe(
        '"id","createdAt","action","actorId","actorUsername","actorRole","targetUserId","targetMessageId","targetReportId","notes"'
      );

      // single row
      expect(lines[1]).toContain('"1"');
      expect(lines[1]).toContain('"USER_BANNED"');
      expect(lines[1]).toContain('"1"'); // actorId
      expect(lines[1]).toContain('"admin"');
      expect(lines[1]).toContain('"ADMIN"');
      expect(lines[1]).toContain('"2"');
      // notes with quotes should be escaped ("" inside)
      expect(lines[1]).toContain('"manual ""ban"""');

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: 'desc' },
        take: 5000,
        include: {
          actor: { select: { id: true, username: true, role: true } },
        },
      });
    });

    test('applies filters to CSV export', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);

      await request(app)
        .get('/admin/audit/export.csv')
        .query({ actorId: '10', action: 'login' });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
        where: {
          actorId: 10,
          action: { contains: 'login', mode: 'insensitive' },
        },
        orderBy: { createdAt: 'desc' },
        take: 5000,
        include: {
          actor: { select: { id: true, username: true, role: true } },
        },
      });
    });

    test('500 on Prisma error', async () => {
      mockPrisma.auditLog.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app).get('/admin/audit/export.csv');

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to export audit CSV' });
    });
  });
});
