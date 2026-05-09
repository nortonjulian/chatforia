import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { readsRouter } from '../routes/reads.js';

function makeApp({ prisma, user } = {}) {
  const app = express();

  app.use((req, _res, next) => {
    req.prisma = prisma;
    next();
  });

  app.use((req, _res, next) => {
    req.user = user;
    next();
  });

  app.use(readsRouter);

  return app;
}

function makePrisma() {
  return {
    chatRoomUser: {
      findUnique: jest.fn(),
    },
    messageRead: {
      findMany: jest.fn(),
    },
  };
}

describe('GET /rooms/:roomId/reads', () => {
  test('403 when not a member', async () => {
    const prisma = makePrisma();

    prisma.chatRoomUser.findUnique.mockResolvedValueOnce(null);

    const app = makeApp({ prisma, user: { id: 7 } });

    const res = await request(app).get('/rooms/123/reads?sinceMessageId=0');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'FORBIDDEN' });

    expect(prisma.chatRoomUser.findUnique).toHaveBeenCalledWith({
      where: {
        roomId_userId: {
          roomId: '123',
          userId: 7,
        },
      },
      select: {
        userId: true,
      },
    });

    expect(prisma.messageRead.findMany).not.toHaveBeenCalled();
  });

  test('returns reads and maps readAt to ISO strings', async () => {
    const prisma = makePrisma();

    prisma.chatRoomUser.findUnique.mockResolvedValueOnce({ userId: 7 });

    prisma.messageRead.findMany.mockResolvedValueOnce([
      {
        messageId: 11,
        userId: 7,
        readAt: new Date('2026-02-14T20:00:00.000Z'),
      },
      {
        messageId: 12,
        userId: 8,
        readAt: new Date('2026-02-14T20:01:00.000Z'),
      },
    ]);

    const app = makeApp({ prisma, user: { id: 7 } });

    const res = await request(app).get('/rooms/123/reads?sinceMessageId=10');

    expect(res.status).toBe(200);

    expect(res.body).toEqual({
      roomId: '123',
      sinceMessageId: 10,
      reads: [
        {
          messageId: 11,
          userId: 7,
          readAt: '2026-02-14T20:00:00.000Z',
        },
        {
          messageId: 12,
          userId: 8,
          readAt: '2026-02-14T20:01:00.000Z',
        },
      ],
    });

    expect(prisma.chatRoomUser.findUnique).toHaveBeenCalledWith({
      where: {
        roomId_userId: {
          roomId: '123',
          userId: 7,
        },
      },
      select: {
        userId: true,
      },
    });

    expect(prisma.messageRead.findMany).toHaveBeenCalledWith({
      where: {
        message: {
          roomId: '123',
          id: {
            gt: 10,
          },
        },
      },
      select: {
        messageId: true,
        userId: true,
        readAt: true,
      },
      orderBy: [
        {
          messageId: 'asc',
        },
        {
          readAt: 'asc',
        },
      ],
      take: 5000,
    });
  });

  test('defaults sinceMessageId to 0 when missing', async () => {
    const prisma = makePrisma();

    prisma.chatRoomUser.findUnique.mockResolvedValueOnce({ userId: 7 });
    prisma.messageRead.findMany.mockResolvedValueOnce([]);

    const app = makeApp({ prisma, user: { id: 7 } });

    const res = await request(app).get('/rooms/123/reads');

    expect(res.status).toBe(200);

    expect(res.body).toEqual({
      roomId: '123',
      sinceMessageId: 0,
      reads: [],
    });

    expect(prisma.messageRead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          message: {
            roomId: '123',
            id: {
              gt: 0,
            },
          },
        },
      })
    );
  });

  test('500 when prisma throws', async () => {
    const prisma = makePrisma();

    prisma.chatRoomUser.findUnique.mockRejectedValueOnce(new Error('db down'));

    const app = makeApp({ prisma, user: { id: 7 } });

    const res = await request(app).get('/rooms/123/reads?sinceMessageId=10');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'SERVER_ERROR' });
  });

  test('500 when req.user missing', async () => {
    const prisma = makePrisma();

    prisma.chatRoomUser.findUnique.mockResolvedValueOnce({ userId: 7 });
    prisma.messageRead.findMany.mockResolvedValueOnce([]);

    const app = makeApp({ prisma, user: undefined });

    const res = await request(app).get('/rooms/123/reads?sinceMessageId=10');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'SERVER_ERROR' });
  });
});