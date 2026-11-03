import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

import { hasVerifiedAdminAccess } from '../../middleware/verifiedAdmin.js';
import { createAdminUserDetailsRouter } from '../../routes/adminUserDetails.js';
import { USER_EDIT_FIELDS } from '../adminUserDetails.js';

let users, audits, actor, authentication, signedIn, failAudit, db, app;
const ordinary = (id) => ({
  id,
  username: `synthetic_${id}`,
  displayName: 'Current name',
  role: 'USER',
  preferredLanguage: 'en',
  showReadReceipts: true,
  showOriginalWithTranslation: true,
  isBanned: false,
  isSystem: false,
  isTestAccount: false,
  deletedAt: null,
  staffAssignment: null,
  founderOwnership: null,
  passwordHash: 'NEVER_RETURN_PASSWORD',
  totpSecretEnc: 'NEVER_RETURN_MFA',
  recoveryToken: 'NEVER_RETURN_RECOVERY',
});
beforeEach(() => {
  users = new Map([1, 2, 3, 4, 5, 6, 7].map((id) => [id, ordinary(id)]));
  audits = [];
  Object.assign(users.get(1), {
    role: 'ADMIN',
    twoFactorEnabled: true,
    tokenVersion: 4,
  });
  users.get(3).staffAssignment = { id: 3, active: true };
  users.get(4).founderOwnership = { id: 1 };
  users.get(5).role = 'ADMIN';
  users.get(6).isSystem = true;
  users.get(7).staffAssignment = { id: 7, active: false };
  actor = { ...users.get(1) };
  authentication = { mfaVerified: true, tokenVersion: 4 };
  signedIn = true;
  failAudit = false;
  const tx = {
    $queryRaw: jest.fn(async () => []),
    user: {
      findUnique: jest.fn(async ({ where }) =>
        users.has(where.id) ? { ...users.get(where.id) } : null
      ),
      update: jest.fn(async ({ where, data }) =>
        Object.assign(users.get(where.id), data)
      ),
    },
    auditLog: {
      create: jest.fn(async ({ data }) => {
        if (failAudit) throw new Error('private database credential detail');
        audits.push(data);
        return data;
      }),
    },
  };
  db = {
    user: tx.user,
    $transaction: async (callback) => {
      const before = structuredClone([...users]),
        prior = [...audits];
      try {
        return await callback(tx);
      } catch (error) {
        users = new Map(before);
        audits = prior;
        throw error;
      }
    },
  };
  app = express();
  app.use(express.json());
  app.use(
    '/admin/users',
    createAdminUserDetailsRouter({
      db,
      authenticate: (req, res, next) => {
        if (!signedIn) return res.sendStatus(401);
        req.user = actor;
        req.auth = authentication;
        next();
      },
      authorize: (req, res, next) =>
        hasVerifiedAdminAccess(req) ? next() : res.sendStatus(403),
    })
  );
});
async function edit(changes, extra = {}) {
  const details = await request(app).get('/admin/users/2');
  return request(app)
    .patch('/admin/users/2')
    .send({
      changes,
      version: details.body.version,
      reason: 'Verified synthetic preference edit',
      ...extra,
    });
}
test('View exposes only permitted details and the explicit edit contract', async () => {
  const response = await request(app).get('/admin/users/2');
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body.editableFields).toEqual(USER_EDIT_FIELDS);
  expect(response.body.user.username).toBe('synthetic_2');
  expect(response.text).not.toMatch(
    /NEVER_RETURN|passwordHash|totpSecretEnc|recoveryToken|tokenVersion/
  );
});
test('Edit normalizes, saves and atomically audits only allowed fields', async () => {
  const response = await edit({
    displayName: ' New name ',
    preferredLanguage: 'es-mx',
    showReadReceipts: false,
  });
  expect(response.status).toBe(200);
  expect(response.body.user).toMatchObject({
    displayName: 'New name',
    preferredLanguage: 'es-MX',
    showReadReceipts: false,
  });
  expect(users.get(2).role).toBe('USER');
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    actorId: 1,
    action: 'ADMIN_USER_PREFERENCES_UPDATED',
    resourceId: '2',
    metadata: {
      fields: ['displayName', 'preferredLanguage', 'showReadReceipts'],
    },
  });
  expect(response.text).not.toContain('NEVER_RETURN');
});
test.each([
  'role',
  'username',
  'email',
  'passwordHash',
  'totpSecretEnc',
  'twoFactorEnabled',
  'tokenVersion',
  'googleSub',
  'isBanned',
])('rejects unauthorized field %s', async (field) => {
  expect((await edit({ [field]: 'forged' })).status).toBe(400);
  expect(audits).toHaveLength(0);
});
test.each([
  { displayName: 'x'.repeat(101) },
  { displayName: 'bad\nname' },
  { preferredLanguage: 'bad locale' },
  { showReadReceipts: 'false' },
])('rejects invalid preference values', async (changes) => {
  expect((await edit(changes)).status).toBe(400);
  expect(users.get(2).displayName).toBe('Current name');
  expect(audits).toHaveLength(0);
});
test.each([3, 4, 5, 6, 7])(
  'refuses all edits to protected identity %s',
  async (id) => {
    const details = await request(app).get(`/admin/users/${id}`);
    expect(details.body.editableFields).toEqual([]);
    expect(
      (
        await request(app)
          .patch(`/admin/users/${id}`)
          .send({
            changes: { displayName: 'forged' },
            version: details.body.version,
            reason: 'Protected identity rejection',
          })
      ).status
    ).toBe(403);
    expect(audits).toHaveLength(0);
  }
);
test('stale current values return a conflict without overwriting newer data', async () => {
  const current = await request(app).get('/admin/users/2');
  users.get(2).displayName = 'Newer value';
  expect(
    (
      await request(app)
        .patch('/admin/users/2')
        .send({
          changes: { displayName: 'Stale save' },
          version: current.body.version,
          reason: 'Stale form rejection',
        })
    ).status
  ).toBe(409);
  expect(users.get(2).displayName).toBe('Newer value');
  expect(audits).toHaveLength(0);
});
test('read and edit both require authentication and verified administrator MFA', async () => {
  signedIn = false;
  expect((await request(app).get('/admin/users/2')).status).toBe(401);
  signedIn = true;
  authentication.mfaVerified = false;
  expect((await request(app).get('/admin/users/2')).status).toBe(403);
  expect((await request(app).patch('/admin/users/2').send({})).status).toBe(
    403
  );
  authentication.mfaVerified = true;
  actor.role = 'USER';
  expect((await request(app).get('/admin/users/2')).status).toBe(403);
});
test('edit rechecks current database session version under its transaction locks', async () => {
  users.get(1).tokenVersion = 5;
  expect((await edit({ displayName: 'Must not save' })).status).toBe(403);
  expect(audits).toHaveLength(0);
});
test('audit failure rolls back the user update and returns no private error detail', async () => {
  failAudit = true;
  const response = await edit({ displayName: 'Must roll back' });
  expect(response.status).toBe(503);
  expect(users.get(2).displayName).toBe('Current name');
  expect(audits).toHaveLength(0);
  expect(response.text).not.toContain('credential');
});
test('invalid IDs and nonexistent users are handled without disclosure', async () => {
  expect((await request(app).get('/admin/users/invalid')).status).toBe(400);
  expect((await request(app).get('/admin/users/999')).status).toBe(404);
});
