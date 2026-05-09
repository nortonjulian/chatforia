/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const mockFindMany = jest.fn();
const mockCount = jest.fn();

await jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: (req, _res, next) => {
    req.user = { id: 'admin-1', role: 'ADMIN' };
    next();
  },
  requireAdmin: (_req, _res, next) => next(),
}));

await jest.unstable_mockModule('@prisma/client', () => {
  const PrismaClient = jest.fn(() => ({
    voiceLog: {
      findMany: mockFindMany,
      count: mockCount,
    },
  }));

  return {
    __esModule: true,
    default: { PrismaClient },
    PrismaClient,
  };
});

const { default: router } = await import('../routes/adminVoiceLogs.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin/voice-logs', router);
  return app;
}

describe('GET /admin/voice-logs', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    mockFindMany.mockReset();
    mockCount.mockReset();
  });

  it('returns voice logs with default pagination and no filters', async () => {
    const fakeLogs = [
      {
        id: 'log-1',
        from: '+15551111111',
        to: '+14442223333',
        direction: 'outbound',
        status: 'COMPLETED',
        timestamp: new Date('2025-01-01T00:00:00.000Z'),
      },
    ];

    mockFindMany.mockResolvedValue(fakeLogs);
    mockCount.mockResolvedValue(1);

    const res = await request(app).get('/admin/voice-logs');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: expect.any(Array),
      total: 1,
    });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe('log-1');

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { timestamp: 'desc' },
      take: 50,
      skip: 0,
    });

    expect(mockCount).toHaveBeenCalledTimes(1);
    expect(mockCount).toHaveBeenCalledWith({ where: {} });
  });

  it('applies status, direction, and phone filters', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const res = await request(app).get(
      '/admin/voice-logs?status=completed&direction=OUTBOUND&phone=555',
    );

    expect(res.status).toBe(200);

    const where = {
      status: 'COMPLETED',
      direction: 'outbound',
      OR: [
        { from: { contains: '555', mode: 'insensitive' } },
        { to: { contains: '555', mode: 'insensitive' } },
      ],
    };

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(mockFindMany).toHaveBeenCalledWith({
      where,
      orderBy: { timestamp: 'desc' },
      take: 50,
      skip: 0,
    });

    expect(mockCount).toHaveBeenCalledTimes(1);
    expect(mockCount).toHaveBeenCalledWith({ where });
  });

  it('caps the "take" parameter at 200 and respects "skip"', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const res = await request(app).get('/admin/voice-logs?take=500&skip=10');

    expect(res.status).toBe(200);

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { timestamp: 'desc' },
      take: 200,
      skip: 10,
    });

    expect(mockCount).toHaveBeenCalledTimes(1);
    expect(mockCount).toHaveBeenCalledWith({ where: {} });
  });

  it('returns 500 and error payload when Prisma throws', async () => {
    mockFindMany.mockRejectedValue(new Error('DB exploded'));
    mockCount.mockResolvedValue(0);

    const res = await request(app).get('/admin/voice-logs');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: 'Failed to fetch voice logs',
    });
  });
});