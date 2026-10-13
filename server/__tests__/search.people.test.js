import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const mockContactFindMany = jest.fn();
const mockUserFindMany = jest.fn();
const mockSmsThreadFindMany = jest.fn();
const mockReportFindMany = jest.fn();

const mockPrismaInstance = {
  contact: { findMany: mockContactFindMany },
  user: { findMany: mockUserFindMany },
  smsThread: { findMany: mockSmsThreadFindMany },
  report: { findMany: mockReportFindMany },
};

jest.unstable_mockModule('@prisma/client', () => {
  const PrismaClient = jest.fn(() => mockPrismaInstance);
  return {
    __esModule: true,
    default: { PrismaClient },
    PrismaClient,
  };
});

jest.unstable_mockModule('../utils/phone.js', () => ({
  digitsOnly: (s) => String(s || '').replace(/\D/g, ''),
}));

jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, res, next) => next(),
}));

const { default: searchPeopleRouter } = await import('../routes/search.people.js');

function createApp({ user } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (user) req.user = user;
    next();
  });
  app.use('/search/people', searchPeopleRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockContactFindMany.mockResolvedValue([]);
  mockUserFindMany.mockResolvedValue([]);
  mockSmsThreadFindMany.mockResolvedValue([]);
  mockReportFindMany.mockResolvedValue([]);
});

describe('GET /search/people', () => {
  it('returns 401 when req.user is missing', async () => {
    const res = await request(createApp())
      .get('/search/people')
      .query({ q: 'alice' });

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
    expect(mockContactFindMany).not.toHaveBeenCalled();
    expect(mockUserFindMany).not.toHaveBeenCalled();
  });

  it('returns empty items for an empty query', async () => {
    const res = await request(createApp({ user: { id: 123 } }))
      .get('/search/people')
      .query({ q: '   ' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ items: [] });
    expect(mockContactFindMany).not.toHaveBeenCalled();
    expect(mockUserFindMany).not.toHaveBeenCalled();
  });

  it('does not enumerate public users with fewer than 3 characters', async () => {
    const res = await request(createApp({ user: { id: 123 } }))
      .get('/search/people')
      .query({ q: 'Jo' });

    expect(res.statusCode).toBe(200);
    expect(mockContactFindMany).toHaveBeenCalledTimes(1);
    expect(mockUserFindMany).not.toHaveBeenCalled();
  });

  it('searches username OR displayName while preserving discoverability rules', async () => {
    const q = 'John Smith';

    await request(createApp({ user: { id: 123 } }))
      .get('/search/people')
      .query({ q });

    expect(mockUserFindMany).toHaveBeenCalledWith({
      where: {
        id: { not: 123 },
        isBanned: false,
        isSystem: false,
        isTestAccount: false,
        deletedAt: null,
        AND: [
          {
            OR: [
              { username: { contains: q, mode: 'insensitive' } },
              { displayName: { contains: q, mode: 'insensitive' } },
            ],
          },
          {
            OR: [
              { discoverability: 'EVERYONE' },
              {
                discoverability: 'CONTACTS_ONLY',
                contactsSaved: { some: { ownerId: 123 } },
              },
            ],
          },
        ],
      },
      take: 10,
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
      },
    });
  });

  it('keeps duplicate display names as distinct selectable users', async () => {
    mockUserFindMany.mockResolvedValueOnce([
      {
        id: 100,
        username: 'johnsmith25',
        displayName: 'John Smith',
        avatarUrl: 'one.png',
      },
      {
        id: 200,
        username: 'johnsmithnyc',
        displayName: 'John Smith',
        avatarUrl: 'two.png',
      },
    ]);

    const res = await request(createApp({ user: { id: 999 } }))
      .get('/search/people')
      .query({ q: 'John Smith' });

    expect(res.statusCode).toBe(200);
    const users = res.body.items.filter((item) => item.kind === 'user');
    expect(users).toHaveLength(2);
    expect(users.map((u) => u.userId)).toEqual([100, 200]);
    expect(users.map((u) => u.username)).toEqual(['johnsmith25', 'johnsmithnyc']);
    expect(users.every((u) => u.displayName === 'John Smith')).toBe(true);
  });

  it('filters report-backed blocks from both public users and linked contacts', async () => {
    mockContactFindMany.mockResolvedValueOnce([
      {
        id: 10,
        alias: 'Blocked John',
        externalName: null,
        externalPhone: null,
        user: {
          id: 200,
          username: 'johntwo',
          displayName: 'John Smith',
          avatarUrl: null,
        },
      },
    ]);
    mockUserFindMany.mockResolvedValueOnce([
      { id: 100, username: 'johnone', displayName: 'John Smith', avatarUrl: null },
      { id: 200, username: 'johntwo', displayName: 'John Smith', avatarUrl: null },
    ]);
    mockReportFindMany.mockResolvedValueOnce([
      { reporterId: 999, reportedUserId: 200 },
    ]);

    const res = await request(createApp({ user: { id: 999 } }))
      .get('/search/people')
      .query({ q: 'John' });

    expect(res.statusCode).toBe(200);
    expect(res.body.items.map((item) => item.userId)).toEqual([100]);
    expect(mockReportFindMany).toHaveBeenCalledWith({
      where: {
        blockApplied: true,
        OR: [
          {
            reporterId: 999,
            reportedUserId: { in: [100, 200] },
          },
          {
            reportedUserId: 999,
            reporterId: { in: [100, 200] },
          },
        ],
      },
      select: {
        reporterId: true,
        reportedUserId: true,
      },
    });
  });

  it('caps returned search results at 12', async () => {
    mockUserFindMany.mockResolvedValueOnce(
      Array.from({ length: 30 }, (_, i) => ({
        id: i + 1,
        username: `user${i + 1}`,
        displayName: `User ${i + 1}`,
        avatarUrl: null,
      }))
    );

    const res = await request(createApp({ user: { id: 123 } }))
      .get('/search/people')
      .query({ q: 'user', limit: 50 });

    expect(res.statusCode).toBe(200);
    expect(res.body.items).toHaveLength(12);
    expect(mockUserFindMany.mock.calls[0][0].take).toBe(12);
  });

  it('preserves exact phone contact and SMS-thread behavior', async () => {
    mockContactFindMany.mockResolvedValueOnce([
      {
        id: 1,
        alias: 'Mom',
        externalName: null,
        externalPhone: '5551234567',
        user: null,
      },
    ]);
    mockSmsThreadFindMany.mockResolvedValueOnce([
      {
        id: 50,
        participants: ['5551234567'],
        lastMessageAt: new Date().toISOString(),
      },
    ]);

    const res = await request(createApp({ user: { id: 999 } }))
      .get('/search/people')
      .query({ q: '(555) 123-4567' });

    expect(res.statusCode).toBe(200);
    expect(res.body.items[0].kind).toBe('contact');
    expect(res.body.items[0].phone).toBe('5551234567');
    expect(res.body.items.some((item) => item.kind === 'sms_thread')).toBe(true);
  });
});
