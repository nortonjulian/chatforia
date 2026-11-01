/** @jest-environment node */
import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const primaryMessage = {
  id: 42,
  threadId: 19,
  direction: 'in',
  fromNumber: '+15551234567',
  toNumber: '+15557654321',
  body: 'Suspicious message',
  mediaUrls: [],
  createdAt: new Date('2026-11-01T12:00:00Z'),
};

const previousMessage = {
  ...primaryMessage,
  id: 41,
  body: 'Earlier message',
  createdAt: new Date('2026-11-01T11:59:00Z'),
};

const db = {
  smsMessage: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  report: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  smsBlockedNumber: {
    upsert: jest.fn(),
  },
  $transaction: jest.fn(),
};

db.$transaction.mockImplementation(async (callback) => callback(db));

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: db,
}));

await jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: (req, res, next) => {
    const id = Number(req.headers['x-test-user-id']);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.sendStatus(401);
    }
    req.user = { id };
    return next();
  },
}));

await jest.unstable_mockModule('../services/smsService.js', () => ({
  __esModule: true,
}));

await jest.unstable_mockModule('../services/badgeSync.js', () => ({
  __esModule: true,
  syncBadgeToUserDevices: jest.fn(),
}));

await jest.unstable_mockModule('../utils/analyticsManager.js', () => ({
  __esModule: true,
  default: { capture: jest.fn() },
}));

const { default: smsRouter } = await import('../routes/sms.js');

const app = express();
app.use('/sms', smsRouter);

app.use((err, _req, res, _next) => {
  res.status(err?.output?.statusCode || 500).json({
    error: err?.output?.payload?.message || err?.message || 'Internal error',
  });
});

beforeEach(() => {
  jest.clearAllMocks();

  db.smsMessage.findFirst.mockImplementation(async ({ where }) => {
    if (where.id !== 42 || where.direction !== 'in' ||
        where.thread?.userId !== 7) {
      return null;
    }
    return primaryMessage;
  });

  db.smsMessage.findMany.mockResolvedValue([previousMessage]);
  db.report.findFirst.mockResolvedValue(null);

  db.report.create.mockImplementation(async ({ data }) => ({
    id: 100,
    ...data,
  }));

  db.$transaction.mockImplementation(async (callback) => callback(db));
});

const submit = (body, userId = 7) =>
  request(app)
    .post('/sms/messages/42/report')
    .set('x-test-user-id', String(userId))
    .send(body);

describe('POST /sms/messages/:id/report', () => {
  test('explicit zero excludes previous conversation context', async () => {
    const res = await submit({
      reason: 'spam_scam',
      contextCount: 0,
      blockAfterReport: false,
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(db.smsMessage.findMany).not.toHaveBeenCalled();

    const data = db.report.create.mock.calls[0][0].data;
    expect(data.smsMessageId).toBe(42);
    expect(data.decryptedContent).toBe('Suspicious message');
    expect(data.evidence.contextCount).toBe(0);
    expect(data.evidence.contextMessages).toEqual([]);
    expect(db.smsBlockedNumber.upsert).not.toHaveBeenCalled();
  });

  test.each([5, 10, 20])(
    'selects at most %i previous messages',
    async (count) => {
      const res = await submit({
        reason: 'harassment',
        contextCount: count,
      });

      expect(res.status).toBe(201);

      const query = db.smsMessage.findMany.mock.calls[0][0];

      expect(query.take).toBe(count);
      expect(query.where.threadId).toBe(19);
      expect(query.where.OR).toEqual([
        { createdAt: { lt: primaryMessage.createdAt } },
        {
          createdAt: primaryMessage.createdAt,
          id: { lt: primaryMessage.id },
        },
      ]);

      expect(db.report.create.mock.calls[0][0].data.evidence.contextMessages)
        .toHaveLength(1);
    }
  );

  test('missing context count retains default of ten', async () => {
    const res = await submit({ reason: 'other' });

    expect(res.status).toBe(201);
    expect(db.smsMessage.findMany.mock.calls[0][0].take).toBe(10);
  });

  test('rejects reports from another account', async () => {
    const res = await submit({ reason: 'spam_scam' }, 8);

    expect(res.status).toBe(404);
    expect(db.report.create).not.toHaveBeenCalled();
  });

  test('rejects unauthenticated requests', async () => {
    const res = await request(app)
      .post('/sms/messages/42/report')
      .send({ reason: 'spam_scam' });

    expect(res.status).toBe(401);
    expect(db.report.create).not.toHaveBeenCalled();
  });

  test('rejects duplicate open reports', async () => {
    db.report.findFirst.mockResolvedValueOnce({ id: 99 });

    const res = await submit({ reason: 'spam_scam' });

    expect(res.status).toBe(409);
    expect(db.report.create).not.toHaveBeenCalled();
  });

  test('blocks sender only when explicitly requested', async () => {
    const res = await submit({
      reason: 'threats',
      contextCount: 0,
      blockAfterReport: true,
    });

    expect(res.status).toBe(201);
    expect(db.smsBlockedNumber.upsert).toHaveBeenCalledTimes(1);
    expect(db.smsBlockedNumber.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_phone: {
            userId: 7,
            phone: '+15551234567',
          },
        },
      })
    );
  });
});
