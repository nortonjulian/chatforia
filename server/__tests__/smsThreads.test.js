import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterAll,
} from '@jest/globals';
import request from 'supertest';
import express from 'express';

const ORIGINAL_ENV = process.env;

let prismaMock;

// ---- Mock @prisma/client BEFORE importing the router ----
await jest.unstable_mockModule('@prisma/client', () => {
  prismaMock = {
    smsThread: {
      findMany: jest.fn(),
    },
  };

  const PrismaClient = jest.fn(() => prismaMock);

  // The real code does:
  //   import pkg from '@prisma/client';
  //   const { PrismaClient } = pkg;
  // so we must provide a *default* export that has PrismaClient on it.
  return {
    __esModule: true,
    default: { PrismaClient },
    PrismaClient, // optional named export, but harmless
  };
});

// Import router AFTER mocks
const { default: smsThreadsRouter } = await import('../routes/smsThreads.js');

// Build test app
const app = express();

// Inject a fake user so req.user.id exists
app.use((req, _res, next) => {
  const id = Number(req.headers['x-test-user-id'] || '1');
  req.user = { id };
  next();
});

app.use('/sms-threads', smsThreadsRouter);

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------
describe('GET /sms-threads', () => {
  test('returns empty items when query has no digits', async () => {
    const res = await request(app)
      .get('/sms-threads')
      .query({ q: 'no digits here' })
      .set('x-test-user-id', '42');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });

    // Should not hit the DB at all when qDigits is empty
    expect(prismaMock.smsThread.findMany).not.toHaveBeenCalled();
  });

  test('returns empty items when q is missing', async () => {
    const res = await request(app)
      .get('/sms-threads')
      .set('x-test-user-id', '42');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
    expect(prismaMock.smsThread.findMany).not.toHaveBeenCalled();
  });

  test('filters threads by digits in participants and applies default limit', async () => {
    const dbThreads = [
      {
        id: 't1',
        participants: ['+1 (303) 555-1234', '+1 720 111-2222'],
        lastMessageAt: new Date('2025-01-01T10:00:00Z'),
      },
      {
        id: 't2',
        participants: ['+44 20 7946 0958'],
        lastMessageAt: new Date('2025-01-02T10:00:00Z'),
      },
      {
        id: 't3',
        participants: ['(303) 555-9999'],
        lastMessageAt: new Date('2025-01-03T10:00:00Z'),
      },
    ];

    prismaMock.smsThread.findMany.mockResolvedValueOnce(dbThreads);

    // Search digits "303" → should match t1 and t3
    const res = await request(app)
      .get('/sms-threads')
      .query({ q: ' (303) ' })
      .set('x-test-user-id', '99');

    expect(res.status).toBe(200);

    // DB queried correctly
    expect(prismaMock.smsThread.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.smsThread.findMany).toHaveBeenCalledWith({
      where: { ownerId: 99 },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
      select: { id: true, participants: true, lastMessageAt: true },
    });

    const items = res.body.items;
    // t1 and t3 match by digits
    expect(items.map((t) => t.id)).toEqual(['t1', 't3']);
  });

  test('respects limit query param (min 1, max 25)', async () => {
    const dbThreads = [
      { id: 't1', participants: ['+1 303-111-1111'], lastMessageAt: new Date() },
      { id: 't2', participants: ['+1 303-222-2222'], lastMessageAt: new Date() },
      { id: 't3', participants: ['+1 303-333-3333'], lastMessageAt: new Date() },
    ];
    prismaMock.smsThread.findMany.mockResolvedValueOnce(dbThreads);

    const res = await request(app)
      .get('/sms-threads')
      .query({ q: '303', limit: '1' })
      .set('x-test-user-id', '5');

    expect(res.status).toBe(200);
    const items = res.body.items;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('t1');
  });

  test('clamps limit between 1 and 25', async () => {
    const dbThreads = new Array(30).fill(null).map((_, i) => ({
      id: `t${i + 1}`,
      participants: ['+1 303-000-0000'],
      lastMessageAt: new Date(),
    }));
    prismaMock.smsThread.findMany.mockResolvedValueOnce(dbThreads);

    const res = await request(app)
      .get('/sms-threads')
      .query({ q: '303', limit: '999' }) // should clamp to 25
      .set('x-test-user-id', '10');

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(25);
  });
});
