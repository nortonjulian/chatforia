/**
 * @jest-environment node
 *
 * Actual production chatrooms router + real Prisma + real local test PostgreSQL.
 * A test-only request header chooses the authenticated fixture user; production
 * authentication code is never changed. The transaction ALWAYS rolls back.
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { assertTestDatabaseSelected } from './helpers/testDatabase.js';

jest.setTimeout(60000);
const { raw } = assertTestDatabaseSelected();
const parsed = new URL(raw);
if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
  throw new Error('Room settings HTTP integration requires local test PostgreSQL');
}

// All routes/middleware use the same uncommitted transaction-bound Prisma client.
let activeTransaction;
const prisma = new Proxy({}, {
  get(_target, key) {
    if (!activeTransaction) throw new Error('No active QA transaction');
    return activeTransaction[key];
  },
});

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  default: prisma,
}));

await jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    const id = Number(req.get('x-room-qa-user'));
    if (!Number.isSafeInteger(id) || id <= 0) {
      return next(new Error('Missing test actor'));
    }
    req.user = { id, role: 'MEMBER' };
    next();
  },
}));

await jest.unstable_mockModule('../services/socketBus.js', () => ({
  getIo: () => null,
}));

await jest.unstable_mockModule('../services/userBlockService.js', () => ({
  assertDirectUsersAllowed: async () => {},
}));

const router = (await import('../routes/chatrooms.js')).default;
const client = new PrismaClient({ datasources: { db: { url: raw } } });
const rollback = new Error('Intentional HTTP integration rollback');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/chatrooms', router);
  app.use((error, _req, res, _next) => {
    const status = error?.isBoom ? error.output.statusCode : 500;
    res.status(status).json({
      error: error?.isBoom ? error.message : 'Test request failed',
    });
  });
  return app;
}

test('HTTP settings respect room ownership, rank, consent and persistence', async () => {
  const app = makeApp();
  try {
    await client.$transaction(async (tx) => {
      activeTransaction = tx;
      const uid = randomUUID().replaceAll('-', '');
      const createUser = async (name) => tx.user.create({
        data: { username: `room_http_${name}_${uid}`, passwordHash: 'test-not-login' },
      });
      const owner = await createUser('owner');
      const admin = await createUser('admin');
      const otherAdmin = await createUser('otheradmin');
      const member = await createUser('member');
      const outsider = await createUser('outsider');
      const room = await tx.chatRoom.create({
        data: {
          name: `Room HTTP QA ${uid}`,
          isGroup: true,
          ownerId: owner.id,
          participants: {
            create: [
              { userId: owner.id, role: 'ADMIN' },
              { userId: admin.id, role: 'ADMIN' },
              { userId: otherAdmin.id, role: 'ADMIN' },
              { userId: member.id, role: 'MEMBER' },
            ],
          },
        },
      });
      const endpoint = `/chatrooms/${room.id}`;
      const as = (user) => ({ 'x-room-qa-user': String(user.id) });

      // Nonmembers and members cannot administer this room.
      expect((await request(app).patch(`${endpoint}/ai-assistant`).set(as(outsider))
        .send({ mode: 'ALWAYS' })).status).toBe(403);
      expect((await request(app).patch(`${endpoint}/auto-translate`).set(as(member))
        .send({ mode: 'ALL' })).status).toBe(403);
      expect((await request(app).patch(`${endpoint}/ai-enabled`).set(as(member))
        .send({ enabled: true })).status).toBe(403);
      expect((await request(app).patch(`${endpoint}/participants/${admin.id}/role`).set(as(member))
        .send({ role: 'MEMBER' })).status).toBe(403);

      // Peer admins are protected, even from other room admins.
      expect((await request(app).patch(`${endpoint}/participants/${otherAdmin.id}/role`)
        .set(as(admin)).send({ role: 'MEMBER' })).status).toBe(403);
      expect((await request(app).patch(`${endpoint}/participants/${member.id}/role`)
        .set(as(admin)).send({ role: 'ADMIN' })).status).toBe(403);
      expect((await request(app).patch(`${endpoint}/participants/${owner.id}/role`)
        .set(as(owner)).send({ role: 'MEMBER' })).status).toBe(403);

      // Room admins can maintain the settings and promote a member to moderator.
      const roleResponse = await request(app).patch(`${endpoint}/participants/${member.id}/role`)
        .set(as(admin)).send({ role: 'MODERATOR' });
      expect(roleResponse.status).toBe(200);
      expect(roleResponse.body.participant.role).toBe('MODERATOR');

      const aiMode = await request(app).patch(`${endpoint}/ai-assistant`)
        .set(as(admin)).send({ mode: 'mention' });
      expect(aiMode.status).toBe(200);
      expect(aiMode.body.aiAssistantMode).toBe('MENTION');

      const translation = await request(app).patch(`${endpoint}/auto-translate`)
        .set(as(owner)).send({ mode: 'tagged' });
      expect(translation.status).toBe(200);
      expect(translation.body.autoTranslateMode).toBe('TAGGED');

      const enabled = await request(app).patch(`${endpoint}/ai-enabled`)
        .set(as(owner)).send({ enabled: true });
      expect(enabled.status).toBe(200);
      expect(enabled.body.allowForiaBot).toBe(true);

      // Legacy default true must never count as active affirmative consent.
      const legacy = await request(app).get(endpoint).set(as(admin));
      expect(legacy.status).toBe(200);
      expect(legacy.body.me.allowAIBot).toBe(false);

      // Only the authenticated member's own consent can change.
      const blocked = await request(app).patch(`${endpoint}/ai-opt`)
        .set(as(outsider)).send({ allow: false });
      expect(blocked.status).toBe(403);
      const optOut = await request(app).patch(`${endpoint}/ai-opt`)
        .set(as(member)).send({ allow: false });
      expect(optOut.status).toBe(200);
      expect(optOut.body.allowAIBot).toBe(false);
      const optIn = await request(app).patch(`${endpoint}/ai-opt`)
        .set(as(member)).send({ allow: true });
      expect(optIn.status).toBe(200);
      expect(optIn.body.allowAIBot).toBe(true);
      const confirmed = await tx.participant.findUnique({
        where: { chatRoomId_userId: { chatRoomId: room.id, userId: member.id } },
        select: { allowAIBot: true, riaGroupConsentedAt: true },
      });
      expect(confirmed.allowAIBot).toBe(true);
      expect(confirmed.riaGroupConsentedAt).toBeInstanceOf(Date);
      const revoke = await request(app).patch(`${endpoint}/ai-opt`)
        .set(as(member)).send({ allow: false });
      expect(revoke.status).toBe(200);
      const afterRevoke = await tx.participant.findUnique({
        where: { chatRoomId_userId: { chatRoomId: room.id, userId: member.id } },
        select: { allowAIBot: true, riaGroupConsentedAt: true },
      });
      expect(afterRevoke).toEqual({ allowAIBot: false, riaGroupConsentedAt: null });

      const dbRoom = await tx.chatRoom.findUnique({
        where: { id: room.id },
        select: { aiAssistantMode: true, autoTranslateMode: true, allowForiaBot: true },
      });
      expect(dbRoom).toEqual({
        aiAssistantMode: 'MENTION', autoTranslateMode: 'TAGGED', allowForiaBot: true,
      });
      const memberRecord = await tx.participant.findUnique({
        where: { chatRoomId_userId: { chatRoomId: room.id, userId: member.id } },
        select: { role: true, allowAIBot: true },
      });
      expect(memberRecord).toEqual({ role: 'MODERATOR', allowAIBot: false });
      const adminRecord = await tx.participant.findUnique({
        where: { chatRoomId_userId: { chatRoomId: room.id, userId: admin.id } },
        select: { allowAIBot: true },
      });
      expect(adminRecord.allowAIBot).toBe(true);

      // Canonical GET must return requester-specific preference; no cross-account leak.
      const readMember = await request(app).get(endpoint).set(as(member));
      expect(readMember.status).toBe(200);
      expect(readMember.body.me.allowAIBot).toBe(false);
      const readAdmin = await request(app).get(endpoint).set(as(admin));
      expect(readAdmin.status).toBe(200);
      expect(readAdmin.body.me.allowAIBot).toBe(false); // historical default is not opt-in
      expect((await request(app).get(endpoint).set(as(outsider))).status).toBe(403);
      expect((await request(app).get(`${endpoint}/participants`).set(as(outsider))).status).toBe(403);

      console.log('PASS: real HTTP role hierarchy, 403 denials, room-mode persistence, consent and isolation');
      throw rollback;
    }, { timeout: 45000 });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    activeTransaction = null;
    await client.$disconnect();
  }
  console.log('PASS: HTTP test fixture transaction rolled back');
});
