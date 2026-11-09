// __tests__/sms.test.js
import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
} from '@jest/globals';
import request from 'supertest';
import express from 'express';

let listThreadsMock;
let getThreadMock;
let sendUserSmsMock;
let boomBadRequestMock;
let boomNotFoundMock;
let smsMessageFindFirstMock;
let smsMessageFindManyMock;
let smsMessageUpdateManyMock;
let syncBadgeMock;

// --- Mocks ---

// Auth middleware: inject a fake req.user based on header
await jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: (req, _res, next) => {
    const id = Number(req.headers['x-test-user-id'] || '1');
    req.user = { id };
    next();
  },
}));

// smsService functions
await jest.unstable_mockModule('../services/smsService.js', () => {
  listThreadsMock = jest.fn();
  getThreadMock = jest.fn();
  sendUserSmsMock = jest.fn();
  return {
    __esModule: true,
    listThreads: listThreadsMock,
    getThread: getThreadMock,
    sendUserSms: sendUserSmsMock,
  };
});

await jest.unstable_mockModule('../utils/prismaClient.js', () => {
  smsMessageFindFirstMock = jest.fn();
  smsMessageFindManyMock = jest.fn();
  smsMessageUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });
  return {
    default: {
      smsMessage: {
        findFirst: smsMessageFindFirstMock,
        findMany: smsMessageFindManyMock,
        updateMany: smsMessageUpdateManyMock,
      },
    },
  };
});

await jest.unstable_mockModule('../services/badgeSync.js', () => {
  syncBadgeMock = jest.fn().mockResolvedValue(null);
  return { syncBadgeToUserDevices: syncBadgeMock };
});

// Boom — create a realistic badRequest error object
await jest.unstable_mockModule('@hapi/boom', () => {
  boomBadRequestMock = jest.fn((message) => {
    const err = new Error(message);
    err.isBoom = true;
    err.output = {
      statusCode: 400,
      payload: {
        statusCode: 400,
        error: 'Bad Request',
        message,
      },
    };
    return err;
  });

  boomNotFoundMock = jest.fn((message) => {
    const err = new Error(message);
    err.isBoom = true;
    err.output = {
      statusCode: 404,
      payload: {
        statusCode: 404,
        error: 'Not Found',
        message,
      },
    };
    return err;
  });

  return {
    __esModule: true,
    default: {
      badRequest: boomBadRequestMock,
      notFound: boomNotFoundMock,
    },
  };
});

// --- Import router AFTER mocks ---
const { default: smsRouter } = await import('../routes/sms.js');

// --- Build test app ---
const app = express();
app.use('/sms', smsRouter);

// Simple error handler to surface Boom errors as JSON
app.use((err, _req, res, _next) => {
  if (err && err.isBoom && err.output) {
    return res.status(err.output.statusCode).json(err.output.payload);
  }
  return res
    .status(err?.statusCode || 500)
    .json({ error: err?.message || 'Internal error' });
});

beforeEach(() => {
  jest.clearAllMocks();
  smsMessageFindFirstMock.mockReset();
  smsMessageFindManyMock.mockReset();
  smsMessageUpdateManyMock.mockReset().mockResolvedValue({ count: 1 });
});

// ---------------------------------------------------------
// GET /sms/threads
// ---------------------------------------------------------
describe('GET /sms/threads', () => {
  test('returns threads for the authenticated user', async () => {
    const items = [
      { id: 't1', lastMessage: 'hey', peer: '+15550001' },
      { id: 't2', lastMessage: 'yo', peer: '+15550002' },
    ];
    listThreadsMock.mockResolvedValueOnce(items);

    const res = await request(app)
      .get('/sms/threads')
      .set('x-test-user-id', '42');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items });

    expect(listThreadsMock).toHaveBeenCalledTimes(1);
    expect(listThreadsMock).toHaveBeenCalledWith(42);
  });
});

// ---------------------------------------------------------
// GET /sms/threads/:id
// ---------------------------------------------------------
describe('GET /sms/threads/:id', () => {
  test('returns thread for the given id and user', async () => {
    const thread = {
      id: 'thread-123',
      peer: '+15551234567',
      messages: [{ id: 'm1', body: 'hi' }],
    };

    getThreadMock.mockResolvedValueOnce(thread);

    const res = await request(app)
      .get('/sms/threads/thread-123')
      .set('x-test-user-id', '99');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(thread);

    expect(getThreadMock).toHaveBeenCalledTimes(1);
    expect(getThreadMock).toHaveBeenCalledWith(99, 'thread-123');
    // A GET must never clear unread counts, even when the client refreshes.
    expect(smsMessageUpdateManyMock).not.toHaveBeenCalled();
    expect(syncBadgeMock).not.toHaveBeenCalled();
  });
});

describe('POST /sms/threads/:id/read', () => {
  test('acknowledges an exact visible inbound message', async () => {
    smsMessageFindManyMock.mockResolvedValueOnce([{ id: 501 }]);

    const res = await request(app)
      .post('/sms/threads/67/read')
      .set('x-test-user-id', '1')
      .send({ messageId: 501 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(smsMessageFindManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: [501] },
        threadId: 67,
        direction: 'in',
        thread: { userId: 1, archivedAt: null, deletedAt: null },
      },
      select: { id: true },
    });
    expect(smsMessageUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: [501] },
        threadId: 67,
        direction: 'in',
        readAt: null,
        thread: { userId: 1, archivedAt: null, deletedAt: null },
      },
      data: { readAt: expect.any(Date) },
    });
    expect(syncBadgeMock).toHaveBeenCalledWith(1, 'sms_thread_read');
  });

  test('does not acknowledge a message missing from the owned thread', async () => {
    smsMessageFindManyMock.mockResolvedValueOnce([]);
    const res = await request(app)
      .post('/sms/threads/67/read')
      .set('x-test-user-id', '2')
      .send({ messageId: 501 });

    expect(res.status).toBe(404);
    expect(boomNotFoundMock).toHaveBeenCalledWith(
      'SMS message not found in owned thread'
    );
    expect(smsMessageUpdateManyMock).not.toHaveBeenCalled();
    expect(syncBadgeMock).not.toHaveBeenCalled();
  });

  test('rejects a mixed batch before changing any read state', async () => {
    smsMessageFindManyMock.mockResolvedValueOnce([{ id: 501 }]);
    const res = await request(app)
      .post('/sms/threads/67/read')
      .set('x-test-user-id', '1')
      .send({ messageIds: [501, 999] });
    expect(res.status).toBe(404);
    expect(smsMessageUpdateManyMock).not.toHaveBeenCalled();
    expect(syncBadgeMock).not.toHaveBeenCalled();
  });

  test('same-time arrival, duplicate retry, and out-of-order ack leave unseen rows unread', async () => {
    const at = new Date('2026-11-09T12:00:00.000Z');
    const rows = [500, 501].map((id) => ({
      id, threadId: 67, userId: 1, direction: 'in', createdAt: at, readAt: null,
    }));
    smsMessageFindManyMock.mockImplementation(async ({ where }) => rows
      .filter((row) => where.id.in.includes(row.id) && row.threadId === where.threadId &&
        row.direction === where.direction && row.userId === where.thread.userId)
      .map(({ id }) => ({ id })));
    let injected = false;
    smsMessageUpdateManyMock.mockImplementation(async ({ where, data }) => {
      if (!injected) {
        rows.push({ id: 502, threadId: 67, userId: 1, direction: 'in', createdAt: at, readAt: null });
        injected = true;
      }
      const changed = rows.filter((row) => where.id.in.includes(row.id) &&
        row.threadId === where.threadId && row.direction === where.direction &&
        row.userId === where.thread.userId && row.readAt === null);
      changed.forEach((row) => { row.readAt = data.readAt; });
      return { count: changed.length };
    });

    const post = (messageIds) => request(app).post('/sms/threads/67/read')
      .set('x-test-user-id', '1').send({ messageIds });
    expect((await post([500, 501, 500])).status).toBe(200);
    expect(rows.filter((row) => row.readAt).map((row) => row.id)).toEqual([500, 501]);
    expect(rows.find((row) => row.id === 502).readAt).toBeNull();

    // The earlier ID can commit after the first acknowledgment. A retry must
    // not retroactively mark it read merely because its ID is lower.
    rows.push({ id: 499, threadId: 67, userId: 1, direction: 'in', createdAt: at, readAt: null });
    expect((await post([501, 500])).status).toBe(200);
    expect(rows.find((row) => row.id === 499).readAt).toBeNull();
    expect(rows.find((row) => row.id === 502).readAt).toBeNull();
    expect(syncBadgeMock).toHaveBeenCalledTimes(1);
  });

  test('invalid acknowledgment does not modify unread state', async () => {
    const res = await request(app)
      .post('/sms/threads/67/read')
      .set('x-test-user-id', '1')
      .send({ messageId: 0 });
    expect(res.status).toBe(400);
    expect(smsMessageUpdateManyMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------
// POST /sms/send
// ---------------------------------------------------------
describe('POST /sms/send', () => {
  test('400 when "to" or "body" is missing', async () => {
    const res = await request(app)
      .post('/sms/send')
      .set('x-test-user-id', '7')
      .send({ to: '+15550009999' }); // body missing

    expect(boomBadRequestMock).toHaveBeenCalledTimes(1);
    expect(boomBadRequestMock).toHaveBeenCalledWith(
      'to and body (or mediaUrls) required'
    );

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: 'Error',
      message: 'to and body (or mediaUrls) required',
    });

    expect(sendUserSmsMock).not.toHaveBeenCalled();
  });

  test('202 when "to" and "body" are provided and service succeeds', async () => {
    const out = { sid: 'SM123', status: 'queued' };
    sendUserSmsMock.mockResolvedValueOnce(out);

    const res = await request(app)
      .post('/sms/send')
      .set('x-test-user-id', '7')
      .send({ to: '+15550001111', body: 'Hello from Chatforia' });

    expect(res.status).toBe(202);
    expect(res.body).toEqual(out);

    expect(sendUserSmsMock).toHaveBeenCalledTimes(1);
    expect(sendUserSmsMock).toHaveBeenCalledWith({
      userId: 7,
      to: '+15550001111',
      body: 'Hello from Chatforia',
      from: undefined,
      mediaUrls: [],
    });
  });
});
