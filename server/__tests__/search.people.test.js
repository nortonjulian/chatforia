import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// --- Prisma mocks ------------------------------------------------------------

const mockContactFindMany = jest.fn();
const mockUserFindMany = jest.fn();
const mockSmsThreadFindMany = jest.fn();

const mockPrismaInstance = {
  contact: { findMany: mockContactFindMany },
  user: { findMany: mockUserFindMany },
  smsThread: { findMany: mockSmsThreadFindMany },
};

// IMPORTANT: match `import pkg from '@prisma/client'; const { PrismaClient } = pkg;`
jest.unstable_mockModule('@prisma/client', () => {
  const PrismaClient = jest.fn(() => mockPrismaInstance);
  return {
    __esModule: true,
    default: { PrismaClient }, // default export is an object with PrismaClient
    PrismaClient,              // named export (harmless, but convenient)
  };
});

// --- digitsOnly mock ---------------------------------------------------------

jest.unstable_mockModule('../utils/phone.js', () => ({
  digitsOnly: (s) => String(s || '').replace(/\D/g, ''),
}));

// --- auth mock ---------------------------------------------------------------

jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, res, next) => next(),
}));

// Import router AFTER mocks
const { default: searchPeopleRouter } = await import('../routes/search.people.js');

// --- Helper: build app -------------------------------------------------------

function createApp({ user } = {}) {
  const app = express();
  app.use(express.json());

  // Inject user before hitting router (so requireAuth sees it)
  app.use((req, res, next) => {
    if (user) req.user = user;
    next();
  });

  app.use('/search/people', searchPeopleRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockContactFindMany.mockReset();
  mockUserFindMany.mockReset();
  mockSmsThreadFindMany.mockReset();
});

// --- Tests -------------------------------------------------------------------

describe('GET /search/people', () => {
  it('returns 401 when req.user is missing', async () => {
    const app = createApp(); // no user injected

    const res = await request(app)
      .get('/search/people')
      .query({ q: 'alice' });

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
    expect(mockContactFindMany).not.toHaveBeenCalled();
    expect(mockUserFindMany).not.toHaveBeenCalled();
  });

  it('returns empty items array for empty query', async () => {
    const app = createApp({ user: { id: 123 } });

    const res = await request(app)
      .get('/search/people')
      .query({ q: '   ' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ items: [] });

    expect(mockContactFindMany).not.toHaveBeenCalled();
    expect(mockUserFindMany).not.toHaveBeenCalled();
    expect(mockSmsThreadFindMany).not.toHaveBeenCalled();
  });

  it('searches contacts and users, merging and ranking results', async () => {
    const app = createApp({ user: { id: 123 } });
    const q = 'ali';

    mockContactFindMany.mockResolvedValueOnce([
      {
        id: 1,
        alias: 'Alice Contact',
        externalName: null,
        externalPhone: '1234567890',
        user: { id: 10, username: 'alice', avatarUrl: 'alice.png' },
      },
    ]);

    mockUserFindMany.mockResolvedValueOnce([
      {
        id: 2,
        username: 'ali',
        email: 'ali@example.com',
        avatarUrl: 'ali.png',
        phoneNumber: '5550001111',
      },
    ]);

    // No digits in "ali" => qDigits = "" => smsThread not queried
    const res = await request(app)
      .get('/search/people')
      .query({ q });

    expect(res.statusCode).toBe(200);
    expect(mockContactFindMany).toHaveBeenCalledTimes(1);
    expect(mockUserFindMany).toHaveBeenCalledTimes(1);
    expect(mockSmsThreadFindMany).not.toHaveBeenCalled();

    const items = res.body.items;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBe(2);

    // User should rank above contact: user score 80 (exact username match), contact score 70
    const [first, second] = items;

    expect(first.kind).toBe('user');
    expect(first.id).toBe(2);
    expect(first.label).toBe('ali');
    expect(first.userId).toBe(2);

    expect(second.kind).toBe('contact');
    expect(second.id).toBe(1);
    expect(second.label).toBe('Alice Contact');
    expect(second.userId).toBe(10);
  });

  it('boosts exact phone contact match and ranks it highest', async () => {
    const app = createApp({ user: { id: 999 } });
    const q = '(555) 123-4567'; // digitsOnly => 5551234567

    mockContactFindMany.mockResolvedValueOnce([
      {
        id: 1,
        alias: 'Exact Match',
        externalName: null,
        externalPhone: '5551234567', // exact
        user: { id: 10, username: 'exactuser', avatarUrl: null },
      },
      {
        id: 2,
        alias: 'Partial Match',
        externalName: null,
        externalPhone: '9995551234', // contains some digits but not equal
        user: null,
      },
    ]);

    mockUserFindMany.mockResolvedValueOnce([]);

    // qDigits is non-empty, so route will call prisma.smsThread.findMany.
    // We don't care about SMS threads in this test, so just return [].
    mockSmsThreadFindMany.mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/search/people')
      .query({ q });

    expect(res.statusCode).toBe(200);
    const items = res.body.items;
    expect(items.length).toBe(2);

    const [first, second] = items;

    // exact phone contact scored 100
    expect(first.kind).toBe('contact');
    expect(first.id).toBe(1);
    expect(first.phone).toBe('5551234567');

    // partial contact scored 70
    expect(second.kind).toBe('contact');
    expect(second.id).toBe(2);
    expect(second.phone).toBe('9995551234');
  });

  it('includes sms_thread results when qDigits matches participants', async () => {
    const app = createApp({ user: { id: 321 } });
    const q = '+1 777-888-9999'; // digitsOnly => 17778889999

    mockContactFindMany.mockResolvedValueOnce([]);
    mockUserFindMany.mockResolvedValueOnce([]);

    const now = Date.now();
    const lastMessageAt = new Date(now - 10_000).toISOString();

    mockSmsThreadFindMany.mockResolvedValueOnce([
      {
        id: 50,
        participants: ['+1 777-888-9999', '+1 000-111-2222'],
        lastMessageAt,
      },
      {
        id: 51,
        participants: ['+1 123-456-0000'],
        lastMessageAt: new Date(now - 20_000).toISOString(),
      },
    ]);

    const res = await request(app)
      .get('/search/people')
      .query({ q });

    expect(res.statusCode).toBe(200);

    expect(mockSmsThreadFindMany).toHaveBeenCalledWith({
      where: { ownerId: 321 },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
      select: { id: true, participants: true, lastMessageAt: true },
    });

    const items = res.body.items;
    expect(items.length).toBe(1); // only thread 50 has a participant with matching digits

    const [thread] = items;
    expect(thread.kind).toBe('sms_thread');
    expect(thread.id).toBe(50);
    expect(thread.label).toBe('+1 777-888-9999, +1 000-111-2222');
    expect(thread.score).toBe(60);
  });

  it('handles absence of smsThread model gracefully (no crash)', async () => {
    // Remove smsThread from prisma instance for this test
    delete mockPrismaInstance.smsThread;

    const app = createApp({ user: { id: 77 } });
    const q = '5551234567';

    mockContactFindMany.mockResolvedValueOnce([]);
    mockUserFindMany.mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/search/people')
      .query({ q });

    expect(res.statusCode).toBe(200);
    expect(res.body.items).toEqual([]);

    // Because smsThread is missing, findMany should not be called
    expect(mockSmsThreadFindMany).not.toHaveBeenCalled();

    // Restore smsThread for other tests
    mockPrismaInstance.smsThread = { findMany: mockSmsThreadFindMany };
  });

  it('respects the limit param and caps it between 1 and 25', async () => {
    const app = createApp({ user: { id: 123 } });
    const q = 'user';

    // produce more than limit results
    const manyUsers = Array.from({ length: 30 }).map((_, i) => ({
      id: i + 1,
      username: `user${i + 1}`,
      email: `user${i + 1}@example.com`,
      avatarUrl: null,
      phoneNumber: null,
    }));

    mockContactFindMany.mockResolvedValueOnce([]);
    mockUserFindMany.mockResolvedValueOnce(manyUsers);

    const res = await request(app)
      .get('/search/people')
      .query({ q, limit: 50 }); // ask for 50, should cap at 25

    expect(res.statusCode).toBe(200);

    const items = res.body.items;
    expect(items.length).toBe(25);

    // Ensure user.findMany called with capped 'take'
    expect(mockUserFindMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { username: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 25,
      select: { id: true, username: true, avatarUrl: true, phoneNumber: true },
    });
  });
});
