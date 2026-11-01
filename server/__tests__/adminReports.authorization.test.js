/** @jest-environment node */
import { jest, beforeEach, describe, test, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const db = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  report: {
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  message: {
    update: jest.fn(),
  },
  $disconnect: jest.fn(),
};

await jest.unstable_mockModule('@prisma/client', () => ({
  __esModule: true,
  default: {
    PrismaClient: jest.fn(() => db),
  },
  PrismaClient: jest.fn(() => db),
}));

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: db,
}));

const { default: adminReportsRouter } =
  await import('../routes/adminReports.js');

const app = express();
app.use(express.json());
app.use('/admin/reports', adminReportsRouter);

const tokenFor = (id, { mfaVerified = false, tokenVersion = 0 } = {}) =>
  jwt.sign(
    { id, tokenVersion, typ: 'session', mfaVerified },
    process.env.JWT_SECRET || 'test_secret',
    { algorithm: 'HS256', expiresIn: '15m' }
  );

const asUser = (id, options) => ({
  Authorization: `Bearer ${tokenFor(id, options)}`,
});

beforeEach(() => {
  jest.clearAllMocks();

  db.user.findUnique.mockImplementation(async ({ where }) => {
    if (where.id === 7) {
      return {
        id: 7,
        username: 'ordinary-user',
        role: 'USER',
        tokenVersion: 0,
        isBanned: false,
        deletedAt: null,
      };
    }

    if (where.id === 1) {
      return {
        id: 1,
        username: 'admin-user',
        role: 'ADMIN',
        twoFactorEnabled: true,
        tokenVersion: 0,
        isBanned: false,
        deletedAt: null,
      };
    }

    return null;
  });

  db.report.findMany.mockResolvedValue([]);
  db.report.count.mockResolvedValue(0);
  db.report.update.mockResolvedValue({
    id: 42,
    status: 'RESOLVED',
  });
});

describe('Admin Reports real authorization middleware', () => {
  test('rejects unauthenticated report listing', async () => {
    const res = await request(app).get('/admin/reports');

    expect(res.status).toBe(401);
    expect(db.report.findMany).not.toHaveBeenCalled();
  });

  test('rejects ordinary users from report listing', async () => {
    const res = await request(app)
      .get('/admin/reports')
      .set(asUser(7));

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Admin access required');
    expect(db.report.findMany).not.toHaveBeenCalled();
  });

  test('allows administrators to list reports', async () => {
    const res = await request(app)
      .get('/admin/reports')
      .set(asUser(1, { mfaVerified: true }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [],
      total: 0,
    });

    expect(db.report.findMany).toHaveBeenCalledTimes(1);
  });

  test('rejects administrator without MFA session proof', async () => {
    const res = await request(app)
      .get('/admin/reports')
      .set(asUser(1));

    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('mfa_verification_required');
    expect(db.report.findMany).not.toHaveBeenCalled();
  });

  test('rejects administrator when MFA enrollment is disabled', async () => {
    db.user.findUnique.mockImplementationOnce(async () => ({
      id: 1,
      role: 'ADMIN',
      twoFactorEnabled: false,
      tokenVersion: 0,
    }));

    const res = await request(app)
      .get('/admin/reports')
      .set(asUser(1, { mfaVerified: true }));

    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('2fa_required');
    expect(db.report.findMany).not.toHaveBeenCalled();
  });

  test('rejects administrator with stale session version', async () => {
    const res = await request(app)
      .get('/admin/reports')
      .set(asUser(1, {
        mfaVerified: true,
        tokenVersion: 99,
      }));

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_session');
    expect(db.report.findMany).not.toHaveBeenCalled();
  });

  test('rejects ordinary users from resolving reports', async () => {
    const res = await request(app)
      .patch('/admin/reports/42/resolve')
      .set(asUser(7))
      .send({ notes: 'Unauthorized attempt' });

    expect(res.status).toBe(403);
    expect(db.report.update).not.toHaveBeenCalled();
  });

  test('rejects ordinary users from warning accounts', async () => {
    const res = await request(app)
      .post('/admin/reports/users/77/warn')
      .set(asUser(7))
      .send({ notes: 'Unauthorized attempt' });

    expect(res.status).toBe(403);
  });

  test('rejects ordinary users from banning accounts', async () => {
    const res = await request(app)
      .post('/admin/reports/users/77/ban')
      .set(asUser(7))
      .send({ reason: 'Unauthorized attempt' });

    expect(res.status).toBe(403);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  test('rejects ordinary users from deleting messages', async () => {
    const res = await request(app)
      .delete('/admin/reports/messages/88')
      .set(asUser(7));

    expect(res.status).toBe(403);
    expect(db.message.update).not.toHaveBeenCalled();
  });
});
