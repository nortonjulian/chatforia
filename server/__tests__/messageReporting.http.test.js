/** @jest-environment node */
import { jest, beforeEach, describe, expect, test } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const db = {
  message: { findUnique: jest.fn(), update: jest.fn() },
  participant: { findFirst: jest.fn() },
  report: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn() },
  userBlock: { upsert: jest.fn() },
  $transaction: jest.fn(),
};
const committed = [];
let reporterId = 7;
const locks = new Map();

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({ default: db }));
await jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: reporterId, role: 'USER' }; next(); },
}));
await jest.unstable_mockModule('../middleware/uploads.js', () => ({
  uploadMedia: { array: () => (_req, _res, next) => next() },
  uploadDirs: { ROOT: '/tmp/chatforia-report-test' },
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

const { default: messagesRouter } = await import('../routes/messages.js');
const app = express();
app.use(express.json());
app.use('/messages', messagesRouter);
app.use((error, _req, res, _next) =>
  res.status(error?.output?.statusCode || 500).json({ error: error.message }));

const primaryMessage = () => ({
  id: 42, chatRoomId: 11, senderId: 9, createdAt: new Date('2026-11-18T12:00:00Z'),
  rawContent: null, contentCiphertext: { ciphertext: 'synthetic' },
  deletedForAll: false, editedAt: null, isHiddenByModeration: false,
  attachments: [{ id: 5, kind: 'IMAGE', url: '/private-media/message/42' }],
  chatRoom: { id: 11, randomChatRoom: null },
});

const payload = (extra = {}) => ({
  messageId: 42, chatRoomId: 11, reportedUserId: 9,
  reason: 'sexual_content', blockAfterReport: false,
  messages: [{ messageId: 42, senderId: 9, plaintext: 'Reporter-submitted text', attachments: [] }],
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  committed.length = 0;
  locks.clear();
  reporterId = 7;
  db.message.findUnique.mockImplementation(async ({ select }) => {
    // Keep this fixture bound to the current Prisma relation contract.
    expect(select.chatRoom.select).toEqual({
      id: true, randomChatRoom: { select: { id: true } },
    });
    return primaryMessage();
  });
  db.participant.findFirst.mockResolvedValue({ id: 1 });
  db.report.findFirst.mockImplementation(async ({ where }) =>
    committed.find(({ type, result }) => type === 'report' &&
      result.messageId === where.messageId && result.reporterId === where.reporterId &&
      result.status === where.status)?.result || null);
  db.report.findMany.mockResolvedValue([]);
  db.report.count.mockResolvedValue(0);
  db.report.create.mockImplementation(async ({ data }) => ({ id: 80 + committed.length, status: 'OPEN', ...data }));
  db.userBlock.upsert.mockResolvedValue({});
  db.message.update.mockResolvedValue({});
  db.$transaction.mockImplementation(async (fn) => {
    const pending = [];
    let releaseLock;
    const tx = {
      $queryRaw: async (_strings, reporter, target) => {
        const key = `${reporter}:${target}`;
        const previous = locks.get(key);
        let resolve;
        const held = new Promise((r) => { resolve = r; });
        locks.set(key, held);
        if (previous) await previous;
        releaseLock = resolve;
        return [{ pg_advisory_xact_lock: null }];
      },
      report: {
        findFirst: (args) => db.report.findFirst(args),
        create: async (args) => {
          const result = await db.report.create(args);
          pending.push({ type: 'report', result });
          return result;
        },
      },
      userBlock: { upsert: async (args) => {
        const result = await db.userBlock.upsert(args);
        pending.push({ type: 'block', result });
        return result;
      } },
      message: { update: async (args) => {
        const result = await db.message.update(args);
        pending.push({ type: 'hide', result });
        return result;
      } },
    };
    try {
      const result = await fn(tx);
      committed.push(...pending);
      return result;
    } finally {
      releaseLock?.();
    }
  });
});

describe('POST /messages/report', () => {
  test('creates an attributed app report with E2EE reporter evidence', async () => {
    const response = await request(app).post('/messages/report').send(payload());
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ success: true, reportId: 80 });
    expect(committed.map((item) => item.type)).toEqual(['report']);
    expect(db.report.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      messageId: 42, reporterId: 7, reportedUserId: 9, chatRoomId: 11,
      decryptedContent: 'Reporter-submitted text',
      evidence: expect.objectContaining({
        primaryMessage: expect.objectContaining({ contentCiphertext: { ciphertext: 'synthetic' } }),
        submittedMessages: [expect.objectContaining({ messageId: 42, plaintext: 'Reporter-submitted text' })],
        contentSource: 'reporter_submission',
      }),
    }) });
    expect(db.userBlock.upsert).not.toHaveBeenCalled();
  });

  test('rejects nonmembers and mismatched room or sender before writes', async () => {
    db.participant.findFirst.mockResolvedValueOnce(null);
    expect((await request(app).post('/messages/report').send(payload())).status).toBe(403);
    expect((await request(app).post('/messages/report').send(payload({ chatRoomId: 12 }))).status).toBe(400);
    expect((await request(app).post('/messages/report').send(payload({ reportedUserId: 10 }))).status).toBe(400);
    expect(db.report.create).not.toHaveBeenCalled();
    expect(committed).toEqual([]);
  });

  test('rejects an already-open report without another moderation record', async () => {
    db.report.findFirst.mockResolvedValueOnce({ id: 79 });
    expect((await request(app).post('/messages/report').send(payload())).status).toBe(409);
    expect(db.report.create).not.toHaveBeenCalled();
    expect(committed).toEqual([]);
  });

  test('rolls back a failed optional block with no committed report', async () => {
    db.userBlock.upsert.mockRejectedValueOnce(new Error('synthetic storage failure'));
    expect((await request(app).post('/messages/report').send(payload({ blockAfterReport: true }))).status).toBe(500);
    expect(db.report.create).toHaveBeenCalledTimes(1);
    expect(committed).toEqual([]);
  });

  test('fabricated reporter plaintext queues human review without punitive auto-hide', async () => {
    db.message.findUnique.mockImplementationOnce(async ({ select }) => {
      expect(select.chatRoom.select.randomChatRoom).toEqual({ select: { id: true } });
      return { ...primaryMessage(), chatRoom: { id: 11, randomChatRoom: { id: 4 } } };
    });
    const response = await request(app).post('/messages/report').send(payload({
      reason: 'threats', messages: [{ messageId: 42, senderId: 9, plaintext: 'I will kill you', attachments: [] }],
    }));
    expect(response.status).toBe(201);
    expect(response.body.moderation.autoHidden).toBe(false);
    expect(response.body.moderation.recommendedAction).toBe('PRIORITY_REVIEW');
    expect(db.report.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      reportedUserId: 9, autoHidden: false,
      scoreFactors: expect.arrayContaining(['random_room_boost', 'matched_threat_pattern']),
    }) });
    expect(db.message.update).not.toHaveBeenCalled();
    expect(committed.map((item) => item.type)).toEqual(['report']);
  });

  test('concurrent duplicate submissions commit only one report and optional block', async () => {
    const [first, second] = await Promise.all([
      request(app).post('/messages/report').send(payload({ blockAfterReport: true })),
      request(app).post('/messages/report').send(payload({ blockAfterReport: true })),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(committed.filter((item) => item.type === 'report')).toHaveLength(1);
    expect(db.userBlock.upsert).toHaveBeenCalledTimes(1);
  });

  test('distinct authorized reporters can report the same message', async () => {
    const first = await request(app).post('/messages/report').send(payload());
    reporterId = 8;
    const second = await request(app).post('/messages/report').send(payload());
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(committed.filter((item) => item.type === 'report')).toHaveLength(2);
  });

  test('rejects a self-report before creating moderation work', async () => {
    reporterId = 9;
    expect((await request(app).post('/messages/report').send(payload())).status).toBe(400);
    expect(db.report.create).not.toHaveBeenCalled();
  });
});
