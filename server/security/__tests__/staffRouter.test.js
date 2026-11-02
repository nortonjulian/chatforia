import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

import { createStaffRouter } from '../../routes/staff.js';
let assignment, session, db, grant, app;
beforeEach(() => {
  process.env.STAFF_SECURITY_ENABLED = 'true';
  process.env.STAFF_DASHBOARD_ENABLED = 'true';
  assignment = {
    profile: 'ACCESS_ADMIN',
    active: true,
    revokedAt: null,
    revokedById: null,
    user: { isBanned: false, deletedAt: null },
  };
  session = {
    user: { id: 17, twoFactorEnabled: true },
    auth: { mfaVerified: true, tokenVersion: 4 },
  };
  db = {
    staffAssignment: {
      findUnique: jest.fn(async () => assignment),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
    user: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
  };
  grant = jest.fn(async () => ({ sessionsRevoked: true }));
  app = express();
  app.use(express.json());
  app.use(
    '/staff',
    createStaffRouter({
      db,
      grant,
      authenticate: (req, res, next) => {
        if (!session) return res.sendStatus(401);
        Object.assign(req, session);
        next();
      },
    })
  );
});
afterEach(() => {
  delete process.env.STAFF_SECURITY_ENABLED;
  delete process.env.STAFF_DASHBOARD_ENABLED;
});
test('rollout flag disables API even for valid sessions', async () => {
  delete process.env.STAFF_SECURITY_ENABLED;
  expect((await request(app).get('/staff/session')).status).toBe(404);
  expect(db.staffAssignment.findUnique).not.toHaveBeenCalled();
});
test('anonymous access fails', async () => {
  session = null;
  expect((await request(app).get('/staff/session')).status).toBe(401);
});
test.each(['missingMfa', 'revoked', 'noAssignment'])(
  'rejects %s',
  async (scenario) => {
    if (scenario === 'missingMfa') session.auth.mfaVerified = false;
    if (scenario === 'revoked') assignment.revokedAt = new Date();
    if (scenario === 'noAssignment') assignment = null;
    expect((await request(app).get('/staff/assignments')).status).toBe(403);
  }
);
test('session exposes only current permissions and allowed delegation', async () => {
  const response = await request(app).get('/staff/session');
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body.delegatableProfiles).toEqual([
    'SENIOR_ENGINEER',
    'SUPPORT',
  ]);
});
test('profile without user-read permission cannot list users', async () => {
  expect((await request(app).get('/staff/users')).status).toBe(403);
  expect(db.user.findMany).not.toHaveBeenCalled();
});
test('pagination is bounded', async () => {
  expect(
    (await request(app).get('/staff/assignments?take=100000')).status
  ).toBe(400);
});
test('forged actor, MFA and token version are ignored', async () => {
  const response = await request(app)
    .post('/staff/assignments/16/grant')
    .send({
      profile: 'SUPPORT',
      reason: 'Verified scope change',
      actorUserId: 13,
      authentication: { mfaVerified: true, tokenVersion: 0 },
    });
  expect(response.status).toBe(200);
  expect(grant).toHaveBeenCalledWith(
    expect.objectContaining({
      actorUserId: 17,
      authentication: session.auth,
      targetUserId: 16,
      db,
    })
  );
});
test.each([
  { profile: 'CTO', reason: 'Escalate privilege' },
  { profile: 'SUPPORT', reason: '' },
])('invalid grant is rejected before service invocation', async (body) => {
  expect(
    (await request(app).post('/staff/assignments/16/grant').send(body)).status
  ).toBe(400);
  expect(grant).not.toHaveBeenCalled();
});
test('database outage returns a sanitized failure', async () => {
  db.staffAssignment.findUnique.mockRejectedValue(
    new Error('sensitive database details')
  );
  const response = await request(app).get('/staff/session');
  expect(response.status).toBe(503);
  expect(response.text).not.toContain('sensitive');
});

test('dashboard kill switch preserves the independent authentication-security flag', async () => {
  delete process.env.STAFF_DASHBOARD_ENABLED;
  expect((await request(app).get('/staff/session')).status).toBe(404);
  expect(process.env.STAFF_SECURITY_ENABLED).toBe('true');
});

test('support resolution repeats session authorization inside the transaction and writes its audit', async () => {
  assignment.profile = 'SUPPORT';
  const actor = {
    id: 17,
    role: 'USER',
    isBanned: false,
    deletedAt: null,
    isSystem: false,
    isTestAccount: false,
    twoFactorEnabled: true,
    twoFactorEnrolledAt: new Date(),
    totpSecretEnc: 'encrypted-fixture',
    tokenVersion: 4,
  };
  const tx = {
    $queryRaw: jest.fn(async () => []),
    user: { findUnique: jest.fn(async () => actor) },
    staffAssignment: db.staffAssignment,
    report: { updateMany: jest.fn(async () => ({ count: 1 })) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  db.$transaction = jest.fn(async (callback) => callback(tx));
  const response = await request(app)
    .post('/staff/reports/29/resolve')
    .send({ reason: 'Verified resolution reason' });
  expect(response.status).toBe(200);
  expect(tx.auditLog.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        actorId: 17,
        action: 'REPORT_RESOLVED',
        resourceId: '29',
      }),
    })
  );
  actor.tokenVersion = 5;
  tx.report.updateMany.mockClear();
  tx.auditLog.create.mockClear();
  expect(
    (
      await request(app)
        .post('/staff/reports/29/resolve')
        .send({ reason: 'Session now invalidated' })
    ).status
  ).toBe(503);
  expect(tx.report.updateMany).not.toHaveBeenCalled();
  expect(tx.auditLog.create).not.toHaveBeenCalled();
});

test('canary cohort restriction does not widen an authenticated assignment', async () => {
  process.env.STAFF_DASHBOARD_USER_IDS = '18';
  try {
    expect((await request(app).get('/staff/session')).status).toBe(403);
    expect(db.staffAssignment.findUnique).not.toHaveBeenCalled();
  } finally {
    delete process.env.STAFF_DASHBOARD_USER_IDS;
  }
});
