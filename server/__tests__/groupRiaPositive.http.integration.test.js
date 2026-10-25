/**
 * Real HTTP route + real message service + disposable local PostgreSQL.
 * The production dispatch branch is imported with NODE_ENV != test *only*
 * to exercise its normal invocation hook; Jest's test environment is then
 * restored. OpenAI, pushes, bot webhooks and network translations are mocked.
 * Every fixture and message remains inside a single ROLLBACK-only transaction.
 *
 * This proves canonical backend delivery, NOT real phone/socket connectivity.
 */
import { jest, test, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { assertTestDatabaseSelected } from './helpers/testDatabase.js';

jest.setTimeout(90000);
const { raw } = assertTestDatabaseSelected();
const target = new URL(raw);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
  throw new Error('Group Ria positive QA requires disposable local PostgreSQL');
}

const events = [];
const mockedReply = 'Group Ria QA: hello from the mocked provider';
const generate = jest.fn(async () => mockedReply);
const sendPush = jest.fn(async () => ({ ok: true }));
let activeTransaction;

const prisma = new Proxy({}, {
  get(_target, key) {
    if (!activeTransaction) throw new Error('No active Ria QA transaction');
    // createMessageService starts its own Prisma transaction in production.
    // In rollback-only QA, all nested operations must share the outer tx.
    if (key === '$transaction') return async (fn) => fn(activeTransaction);
    return activeTransaction[key];
  },
});

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({ default: prisma }));
await jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    const id = Number(req.get('x-ria-qa-user'));
    if (!Number.isSafeInteger(id) || id <= 0) return next(new Error('Missing QA actor'));
    req.user = { id, role: 'MEMBER' };
    next();
  },
}));
await jest.unstable_mockModule('../middleware/uploads.js', () => ({
  uploadMedia: { array: () => (_req, _res, next) => next() },
}));
await jest.unstable_mockModule('../services/userBlockService.js', () => ({
  assertDirectRoomAllowed: jest.fn(async () => {}),
}));
await jest.unstable_mockModule('../services/translation/translateMessage.js', () => ({
  maybeTranslateForTarget: jest.fn(async () => null),
}));
await jest.unstable_mockModule('../services/botPlatform.js', () => ({
  enqueueBotEventsForMessage: jest.fn(async () => {}),
}));
await jest.unstable_mockModule('../services/pushService.js', () => ({
  sendPushToUser: sendPush,
}));
await jest.unstable_mockModule('../services/badgeSync.js', () => ({
  syncBadgeToUserDevices: jest.fn(async () => {}),
}));
await jest.unstable_mockModule('../services/readReceiptService.js', () => ({
  recordMessageReads: jest.fn(async () => {}),
}));
await jest.unstable_mockModule('../services/socketBus.js', () => ({
  getIo: () => null,
  setHelpers: jest.fn(),
  emitMessageUpsert: jest.fn(),
  emitMessageUpsertToUser: jest.fn(async (userId, roomId, item) => {
    events.push({ event: 'message:upsert', userId, roomId, item });
  }),
  emitMessageAck: jest.fn(),
  emitToUser: jest.fn(),
}));
await jest.unstable_mockModule('../services/aiQueue.js', () => ({
  enqueueAI: jest.fn(async ({ fn }) => fn()),
}));
await jest.unstable_mockModule('../services/groupRiaProvider.js', () => ({
  generateGroupRiaReply: generate,
}));
await jest.unstable_mockModule('../utils/tokenBucket.js', () => ({
  allow: () => true,
}));

const client = new PrismaClient({ datasources: { db: { url: raw } } });
const rollback = new Error('Intentional Group Ria positive QA rollback');
const originalEnv = {
  node: process.env.NODE_ENV,
  flag: process.env.GROUP_RIA_ENABLED,
  bot: process.env.FORIA_BOT_USER_ID,
  translate: process.env.TRANSLATION_ENABLED,
  key: process.env.OPENAI_API_KEY,
};

function appFor(router) {
  const app = express();
  app.use(express.json());
  app.use('/messages', router);
  app.use((error, _req, res, _next) => {
    res.status(error?.isBoom ? error.output.statusCode : 500).json({
      error: error?.isBoom ? error.message : 'QA request failed',
    });
  });
  return app;
}

async function waitForDelivered(tx, sourceMessageId) {
  for (let n = 0; n < 80; n++) {
    const claim = await tx.groupRiaInvocation.findUnique({
      where: { sourceMessageId },
    });
    if (claim?.status === 'DELIVERED') return claim;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Mocked Group Ria delivery did not complete');
}

test('HTTP @Ria request creates exactly one persisted bot reply and per-member upserts', async () => {
  try {
    await client.$transaction(async (tx) => {
      activeTransaction = tx;
      events.length = 0;
      generate.mockClear();
      sendPush.mockClear();

      const suffix = randomUUID().replaceAll('-', '');
      const makeUser = (who) => tx.user.create({
        data: { username: `ria_positive_${who}_${suffix}`, passwordHash: 'test-only' },
      });
      const sender = await makeUser('sender');
      const member = await makeUser('member');
      const bot = await makeUser('bot');
      const room = await tx.chatRoom.create({
        data: {
          isGroup: true,
          ownerId: sender.id,
          allowForiaBot: true,
          aiAssistantMode: 'MENTION',
          participants: {
            create: [
              { userId: sender.id, role: 'ADMIN', allowAIBot: true, riaGroupConsentedAt: new Date() },
              { userId: member.id, allowAIBot: true, riaGroupConsentedAt: new Date() },
              { userId: bot.id, allowAIBot: false, riaGroupConsentedAt: null },
            ],
          },
        },
      });

      process.env.FORIA_BOT_USER_ID = String(bot.id);
      process.env.GROUP_RIA_ENABLED = 'true';
      process.env.OPENAI_API_KEY = 'test-key-never-sent';
      process.env.TRANSLATION_ENABLED = 'false';

      // The production messages route snapshots IS_TEST at module import.
      // Import in a production-like mode, then restore Jest's 'test' value.
      // Only the local Express app and mocked services can be reached.
      const wasTest = process.env.NODE_ENV;
      let router;
      try {
        process.env.NODE_ENV = 'ria-positive-local-qa';
        router = (await import('../routes/messages.js')).default;
      } finally {
        process.env.NODE_ENV = wasTest;
      }
      const app = appFor(router);
      const cid = `qa-ria-${suffix}`;

      const send = await request(app)
        .post('/messages')
        .set('x-ria-qa-user', String(sender.id))
        .send({ chatRoomId: room.id, clientMessageId: cid, content: '@Ria hello' });

      expect(send.status).toBe(201);
      expect(send.body.message.chatRoomId).toBe(room.id);
      expect(send.body.message.senderId).toBe(sender.id);
      expect(send.body.message.rawContent).toBe('@Ria hello');

      const claim = await waitForDelivered(tx, send.body.message.id);
      expect(claim.replyMessageId).toEqual(expect.any(Number));
      expect(generate).toHaveBeenCalledTimes(1);
      expect(generate).toHaveBeenCalledWith('hello');

      // Retry the exact HTTP submission with the same clientMessageId.
      // Neither the original message nor the AI-generated reply may duplicate.
      const retry = await request(app)
        .post('/messages')
        .set('x-ria-qa-user', String(sender.id))
        .send({ chatRoomId: room.id, clientMessageId: cid, content: '@Ria hello' });
      expect(retry.status).toBe(201);
      expect(retry.body.message.id).toBe(send.body.message.id);
      expect(generate).toHaveBeenCalledTimes(1);

      const stored = await tx.message.findMany({
        where: { chatRoomId: room.id },
        orderBy: { id: 'asc' },
        select: {
          id: true, senderId: true, chatRoomId: true,
          rawContent: true, clientMessageId: true, isAutoReply: true,
        },
      });
      expect(stored).toHaveLength(2);
      expect(stored[0]).toEqual(expect.objectContaining({
        senderId: sender.id, isAutoReply: false, rawContent: '@Ria hello',
      }));
      expect(stored[1]).toEqual(expect.objectContaining({
        id: claim.replyMessageId, chatRoomId: room.id,
        senderId: bot.id, isAutoReply: true, rawContent: mockedReply,
        clientMessageId: `group-ria:${stored[0].id}`,
      }));

      for (const user of [sender, member, bot]) {
        const matches = events.filter(({ event, userId, roomId, item }) =>
          event === 'message:upsert' && userId === user.id &&
          roomId === room.id && item.id === claim.replyMessageId);
        expect(matches).toHaveLength(1);
        expect(matches[0].item.senderId).toBe(bot.id);
        expect(matches[0].item.rawContent).toBe(mockedReply);
      }

      // DB-backed reconnect/delta retrieval for two simulated clients.
      for (const user of [sender, member]) {
        const delta = await request(app)
          .get(`/messages/${room.id}/deltas?sinceId=${stored[0].id}`)
          .set('x-ria-qa-user', String(user.id));
        expect(delta.status).toBe(200);
        expect(delta.body.items).toHaveLength(1);
        expect(delta.body.items[0]).toEqual(expect.objectContaining({
          id: claim.replyMessageId, chatRoomId: room.id,
          rawContent: mockedReply,
        }));
        expect(delta.body.items[0].sender.id).toBe(bot.id);
      }

      console.log('PASS: real HTTP + Postgres message delivery, one Ria reply, shaped upserts and reconnect deltas');
      throw rollback;
    }, { timeout: 75000 });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    activeTransaction = null;
    process.env.NODE_ENV = originalEnv.node;
    if (originalEnv.flag === undefined) delete process.env.GROUP_RIA_ENABLED;
    else process.env.GROUP_RIA_ENABLED = originalEnv.flag;
    if (originalEnv.bot === undefined) delete process.env.FORIA_BOT_USER_ID;
    else process.env.FORIA_BOT_USER_ID = originalEnv.bot;
    if (originalEnv.translate === undefined) delete process.env.TRANSLATION_ENABLED;
    else process.env.TRANSLATION_ENABLED = originalEnv.translate;
    if (originalEnv.key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalEnv.key;
    await client.$disconnect();
  }
});
