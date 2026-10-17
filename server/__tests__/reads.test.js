import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { readsRouter } from '../routes/reads.js';

function harness({ member = true, user = { id: 7 } } = {}) {
  const prisma = {
    participant: { findUnique: jest.fn().mockResolvedValue(member ? { userId: 7 } : null) },
    messageRead: { findMany: jest.fn().mockResolvedValue([]) },
    message: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const app = express();
  app.use((req, _res, next) => { req.prisma = prisma; req.user = user; next(); });
  app.use(readsRouter);
  return { prisma, get: (path = '/rooms/123/reads') => request(app).get(path) };
}

describe('GET /rooms/:roomId/reads', () => {
  test('rejects unauthenticated requests', async () => {
    const h = harness({ user: null });
    expect((await h.get()).status).toBe(401);
    expect(h.prisma.participant.findUnique).not.toHaveBeenCalled();
  });
  test.each(['/rooms/abc/reads', '/rooms/0/reads', '/rooms/123/reads?sinceMessageId=-1'])
  ('validates numeric boundaries: %s', async (path) => {
    const h = harness();
    expect((await h.get(path)).status).toBe(400);
    expect(h.prisma.messageRead.findMany).not.toHaveBeenCalled();
  });
  test('uses current Participant schema and rejects nonmembers before reading', async () => {
    const h = harness({ member: false });
    expect((await h.get()).status).toBe(403);
    expect(h.prisma.participant.findUnique).toHaveBeenCalledWith({
      where: { chatRoomId_userId: { chatRoomId: 123, userId: 7 } }, select: { userId: true },
    });
    expect(h.prisma.messageRead.findMany).not.toHaveBeenCalled();
  });
  test('filters each reader/message pair and preserves ISO response format', async () => {
    const h = harness();
    const readAt = new Date('2026-10-17T18:00:00.000Z');
    h.prisma.messageRead.findMany.mockResolvedValue([
      { messageId: 11, userId: 8, readAt },
      { messageId: 11, userId: 9, readAt },
      { messageId: 12, userId: 8, readAt },
    ]);
    h.prisma.message.findMany.mockResolvedValue([{ id: 11, readBy: [{ id: 8 }] }, { id: 12, readBy: [] }]);
    const res = await h.get('/rooms/123/reads?sinceMessageId=10');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ roomId: '123', sinceMessageId: 10, reads: [
      { messageId: 11, userId: 8, readAt: readAt.toISOString() },
    ] });
    expect(h.prisma.messageRead.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { message: {
        chatRoomId: 123, id: { gt: 10 }, deletedForAll: false,
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
      } },
    }));
    expect(h.prisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: { id: true, readBy: { select: { id: true } } },
    }));
  });
  test('returns an empty list when no shared receipts exist', async () => {
    const h = harness();
    expect((await h.get()).body.reads).toEqual([]);
  });
  test('database errors return 500', async () => {
    const h = harness();
    h.prisma.participant.findUnique.mockRejectedValue(new Error('database unavailable'));
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try { expect((await h.get()).status).toBe(500); }
    finally { log.mockRestore(); }
  });
});
