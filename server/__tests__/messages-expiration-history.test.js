/** @jest-environment node */
import { jest, test, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const db = {
  participant: { findFirst: jest.fn(async () => ({ id: 1, clearedAt: null })) },
  randomChatRoom: { findFirst: jest.fn(async () => null) },
  threadState: { findUnique: jest.fn(async () => null) },
  message: { findMany: jest.fn(async () => []) },
  user: { findUnique: jest.fn(async () => ({ preferredLanguage: 'en' })) },
};

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({ default: db }));
await jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 7, role: 'USER' }; next(); },
}));
await jest.unstable_mockModule('../middleware/uploads.js', () => ({
  uploadMedia: { array: () => (_req, _res, next) => next() },
  uploadDirs: { ROOT: '/tmp/chatforia-expiration-history' },
}));
await jest.unstable_mockModule('../services/socketBus.js', () => ({
  getIo: () => null, emitMessageUpsert: jest.fn(), emitMessageUpsertToUser: jest.fn(),
  emitMessageAck: jest.fn(), emitToUser: jest.fn(),
}));
await jest.unstable_mockModule('../services/messageService.js', () => ({
  createMessageService: jest.fn(), shapeMessageForUser: jest.fn(),
}));
await jest.unstable_mockModule('../services/userBlockService.js', () => ({
  assertDirectRoomAllowed: jest.fn(), assertDirectUsersAllowed: jest.fn(),
  isBlockedEitherWay: jest.fn(),
}));
await jest.unstable_mockModule('../services/translation/translateMessage.js', () => ({
  maybeTranslateForTarget: jest.fn(),
}));
await jest.unstable_mockModule('../services/pushService.js', () => ({ sendPushToUser: jest.fn() }));
await jest.unstable_mockModule('../services/badgeSync.js', () => ({ syncBadgeToUserDevices: jest.fn() }));
await jest.unstable_mockModule('../services/readReceiptService.js', () => ({ recordMessageReads: jest.fn() }));

const priorEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'expiration-history-qa';
const { default: messagesRouter } = await import('../routes/messages.js');
const { default: roomsRouter } = await import('../routes/rooms.js');
process.env.NODE_ENV = priorEnv;

const app = express();
app.use('/messages', messagesRouter);
app.use('/rooms', roomsRouter);
app.use((error, _req, res, _next) => res.status(error?.output?.statusCode || 500).json({ error: error.message }));

beforeEach(() => jest.clearAllMocks());

for (const [name, url] of [
  ['first page', '/messages/8'],
  ['cursor page', '/messages/8?cursorId=99'],
  ['compound cursor page', '/messages/8?cursor=2026-01-01T00%3A00%3A00.000Z_99'],
  ['same-route reconnect delta', '/messages/8?sinceId=10'],
  ['dedicated reconnect delta', '/messages/8/deltas?sinceId=10'],
]) {
  test(`${name} excludes elapsed messages at the database read`, async () => {
    const response = await request(app).get(url);
    expect(response.status).toBe(200);
    expect(db.message.findMany).toHaveBeenCalledTimes(1);
    const where = db.message.findMany.mock.calls[0][0].where;
    const deadline = where.AND?.find((clause) => clause.OR?.some((item) => item.expiresAt));
    expect(deadline).toBeDefined();
    expect(deadline.OR).toEqual([
      { expiresAt: null },
      { expiresAt: { gt: expect.any(Date) } },
    ]);
    // A deadline filter must coexist with each route's independent cursor.
    if (url.includes('cursorId')) expect(where.id).toEqual({ lt: 99 });
    if (url.includes('cursor=')) expect(where.OR).toHaveLength(2);
    if (url.includes('sinceId')) expect(where.id).toEqual({ gt: 10 });
  });
}

test('legacy room history excludes elapsed and tombstoned rows', async () => {
  const response = await request(app).get('/rooms/8/messages');
  expect(response.status).toBe(200);
  const where = db.message.findMany.mock.calls[0][0].where;
  expect(where.AND).toEqual([
    { OR: [{ chatRoomId: 8 }] },
    { deletedForAll: false },
    { OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] },
  ]);
});

test('legacy history checks membership before querying messages', async () => {
  db.participant.findFirst.mockResolvedValueOnce(null);
  const response = await request(app).get('/rooms/8/messages');
  expect(response.status).toBe(403);
  expect(db.message.findMany).not.toHaveBeenCalled();
});
