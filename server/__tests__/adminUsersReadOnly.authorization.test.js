/** @jest-environment node */
import { jest, beforeEach, describe, test, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const db = {
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: db,
}));

const { default: router } =
  await import('../routes/adminUsersReadOnly.js');

const app = express();
app.use(express.json());
app.use('/admin/users', router);

const tokenFor = (id, options = {}) =>
  jwt.sign(
    {
      id,
      typ: 'session',
      tokenVersion: options.tokenVersion ?? 0,
      mfaVerified: options.mfaVerified ?? false,
    },
    process.env.JWT_SECRET || 'test_secret',
    { algorithm: 'HS256', expiresIn: '15m' }
  );

beforeEach(() => {
  jest.clearAllMocks();

  db.user.findUnique.mockImplementation(async ({ where }) => {
    if (where.id === 1) {
      return {
        id: 1,
        role: 'ADMIN',
        twoFactorEnabled: true,
        tokenVersion: 0,
        isBanned: false,
        deletedAt: null,
      };
    }

    if (where.id === 7) {
      return {
        id: 7,
        role: 'USER',
        twoFactorEnabled: false,
        tokenVersion: 0,
        isBanned: false,
        deletedAt: null,
      };
    }

    return null;
  });

  db.user.findMany.mockResolvedValue([
    { id: 7, username: 'example', role: 'USER' },
  ]);
  db.user.count.mockResolvedValue(1);
});

describe('read-only administrator Users API authorization', () => {
  test('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/admin/users');
    expect(res.status).toBe(401);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  test('rejects ordinary users', async () => {
    const res = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${tokenFor(7)}`);

    expect(res.status).toBe(403);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  test('rejects administrators without MFA verification', async () => {
    const res = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${tokenFor(1)}`);

    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('mfa_verification_required');
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  test('allows MFA-verified administrators', async () => {
    const res = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${tokenFor(1, {
        mfaVerified: true,
      })}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items).toHaveLength(1);
  });

  test('rejects stale session versions', async () => {
    const res = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${tokenFor(1, {
        mfaVerified: true,
        tokenVersion: 99,
      })}`);

    expect(res.status).toBe(401);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  test('enforces pagination limits', async () => {
    const res = await request(app)
      .get('/admin/users?take=201&skip=0')
      .set('Authorization', `Bearer ${tokenFor(1, {
        mfaVerified: true,
      })}`);

    expect(res.status).toBe(400);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  test('rejects negative pagination offsets', async () => {
    const res = await request(app)
      .get('/admin/users?take=50&skip=-1')
      .set('Authorization', `Bearer ${tokenFor(1, {
        mfaVerified: true,
      })}`);

    expect(res.status).toBe(400);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  test('restricts database-selected user fields', async () => {
    const res = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${tokenFor(1, {
        mfaVerified: true,
      })}`);

    expect(res.status).toBe(200);

    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
          username: true,
          role: true,
          isBanned: true,
        },
      })
    );

    const select = db.user.findMany.mock.calls[0][0].select;

    for (const field of [
      'passwordHash',
      'totpSecretEnc',
      'email',
      'phoneNumber',
      'billingCustomerId',
    ]) {
      expect(select).not.toHaveProperty(field);
    }
  });

  test('does not expose role changes', async () => {
    const res = await request(app)
      .patch('/admin/users/7/role')
      .set('Authorization', `Bearer ${tokenFor(1, {
        mfaVerified: true,
      })}`)
      .send({ role: 'ADMIN' });

    expect(res.status).toBe(404);
  });

  test('does not expose account deletion', async () => {
    const res = await request(app)
      .delete('/admin/users/7')
      .set('Authorization', `Bearer ${tokenFor(1, {
        mfaVerified: true,
      })}`);

    expect(res.status).toBe(404);
  });
});
