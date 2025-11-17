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

  return {
    __esModule: true,
    default: {
      badRequest: boomBadRequestMock,
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
    expect(boomBadRequestMock).toHaveBeenCalledWith('to and body required');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: 'to and body required',
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
    });
  });
});
