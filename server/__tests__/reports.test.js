import request from 'supertest';
import express from 'express';

const mockFindUnique = jest.fn();
const mockFindFirst = jest.fn();
const mockFindMany = jest.fn();
const mockCreate = jest.fn();

jest.mock('@prisma/client', () => {
  const PrismaClient = jest.fn(() => ({
    message: {
      findUnique: mockFindUnique,
      findMany: mockFindMany,
    },
    report: {
      findFirst: mockFindFirst,
      create: mockCreate,
    },
  }));

  return {
    __esModule: true,
    default: { PrismaClient },
    PrismaClient,
  };
});

jest.mock('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: (req, _res, next) => {
    req.user = { id: '123' };
    next();
  },
}));

import router from '../routes/reports.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/reports', router);
  return app;
}

describe('reports routes', () => {
  let app;

  beforeEach(() => {
    app = makeApp();
    jest.clearAllMocks();
  });

  describe('POST /reports', () => {
    it('returns 401 when authenticated user id is invalid', async () => {
      jest.resetModules();

      jest.doMock('../middleware/auth.js', () => ({
        __esModule: true,
        requireAuth: (req, _res, next) => {
          req.user = { id: 'abc' };
          next();
        },
      }));

      const { default: freshRouter } = await import('../routes/reports.js');

      const freshApp = express();
      freshApp.use(express.json());
      freshApp.use('/reports', freshRouter);

      const res = await request(freshApp).post('/reports').send({
        messageId: 10,
        reason: 'harassment',
      });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid authenticated user' });
    });

    it('returns 400 when messageId is invalid', async () => {
      const res = await request(app).post('/reports').send({
        messageId: 'nope',
        reason: 'harassment',
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Valid messageId is required' });
    });

    it('returns 404 when message is not found', async () => {
      mockFindUnique.mockResolvedValueOnce(null);

      const res = await request(app).post('/reports').send({
        messageId: 42,
        reason: 'harassment',
      });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Message not found' });

      expect(mockFindUnique).toHaveBeenCalledWith({
        where: { id: 42 },
        select: {
          id: true,
          senderId: true,
          chatRoomId: true,
          rawContent: true,
          translatedContent: true,
          createdAt: true,
          sender: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });
    });

    it('returns 400 when user tries to report their own message', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 42,
        senderId: 123,
        chatRoomId: 55,
        rawContent: 'hello',
        translatedContent: null,
        createdAt: new Date('2026-03-29T12:00:00Z'),
        sender: { id: 123, username: 'julian' },
      });

      const res = await request(app).post('/reports').send({
        messageId: 42,
        reason: 'harassment',
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'You cannot report your own message' });
    });

    it('returns 409 when there is already an open report for the same message by the same reporter', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 42,
        senderId: 999,
        chatRoomId: 55,
        rawContent: 'hello',
        translatedContent: null,
        createdAt: new Date('2026-03-29T12:00:00Z'),
        sender: { id: 999, username: 'other-user' },
      });

      mockFindFirst.mockResolvedValueOnce({ id: 1 });

      const res = await request(app).post('/reports').send({
        messageId: 42,
        reason: 'harassment',
      });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'You already reported this message' });

      expect(mockFindFirst).toHaveBeenCalledWith({
        where: {
          messageId: 42,
          reporterId: 123,
          status: 'OPEN',
        },
        select: { id: true },
      });
    });

    it('creates a report with normalized reason, trimmed details, evidence, and blockApplied', async () => {
      const messageCreatedAt = new Date('2026-03-29T12:00:00Z');

      mockFindUnique.mockResolvedValueOnce({
        id: 42,
        senderId: 999,
        chatRoomId: 55,
        rawContent: 'reported message',
        translatedContent: 'translated reported message',
        createdAt: messageCreatedAt,
        sender: { id: 999, username: 'other-user' },
      });

      mockFindFirst.mockResolvedValueOnce(null);

      mockFindMany.mockResolvedValueOnce([
        {
          id: 42,
          senderId: 999,
          rawContent: 'reported message',
          translatedContent: null,
          createdAt: new Date('2026-03-29T11:59:00Z'),
          sender: { username: 'other-user' },
        },
        {
          id: 41,
          senderId: 321,
          rawContent: 'prior context',
          translatedContent: null,
          createdAt: new Date('2026-03-29T11:58:00Z'),
          sender: { username: 'context-user' },
        },
      ]);

      mockCreate.mockResolvedValueOnce({
        id: 77,
        messageId: 42,
        reporterId: 123,
        reportedUserId: 999,
        chatRoomId: 55,
        decryptedContent: 'reported message',
        reason: 'HARASSMENT',
        details: 'some details',
        evidence: {
          contextCount: 2,
          contextMessages: [
            {
              id: 41,
              senderId: 321,
              username: 'context-user',
              text: 'prior context',
              createdAt: new Date('2026-03-29T11:58:00Z'),
            },
            {
              id: 42,
              senderId: 999,
              username: 'other-user',
              text: 'reported message',
              createdAt: new Date('2026-03-29T11:59:00Z'),
            },
          ],
        },
        blockApplied: true,
        status: 'OPEN',
        reporter: { id: 123, username: 'reporter', email: 'r@test.com' },
        reportedUser: {
          id: 999,
          username: 'other-user',
          email: 'o@test.com',
          isBanned: false,
        },
        message: {
          id: 42,
          rawContent: 'reported message',
          translatedContent: 'translated reported message',
          chatRoomId: 55,
          createdAt: messageCreatedAt,
          sender: { id: 999, username: 'other-user', isBanned: false },
        },
      });

      const res = await request(app).post('/reports').send({
        messageId: 42,
        reason: 'harassment',
        details: '   some details   ',
        contextCount: 2,
        blockAfterReport: true,
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.report.id).toBe(77);

      expect(mockFindMany).toHaveBeenCalledWith({
        where: {
          chatRoomId: 55,
          createdAt: {
            lte: messageCreatedAt,
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 3,
        select: {
          id: true,
          senderId: true,
          rawContent: true,
          translatedContent: true,
          createdAt: true,
          sender: {
            select: {
              username: true,
            },
          },
        },
      });

      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          messageId: 42,
          reporterId: 123,
          reportedUserId: 999,
          chatRoomId: 55,
          decryptedContent: 'reported message',
          reason: 'HARASSMENT',
          details: 'some details',
          evidence: {
            contextCount: 2,
            contextMessages: [
              {
                id: 41,
                senderId: 321,
                username: 'context-user',
                text: 'prior context',
                createdAt: new Date('2026-03-29T11:58:00Z'),
              },
              {
                id: 42,
                senderId: 999,
                username: 'other-user',
                text: 'reported message',
                createdAt: new Date('2026-03-29T11:59:00Z'),
              },
            ],
          },
          blockApplied: true,
          status: 'OPEN',
        },
        include: {
          reporter: {
            select: { id: true, username: true, email: true },
          },
          reportedUser: {
            select: { id: true, username: true, email: true, isBanned: true },
          },
          message: {
            select: {
              id: true,
              rawContent: true,
              translatedContent: true,
              chatRoomId: true,
              createdAt: true,
              sender: {
                select: { id: true, username: true, isBanned: true },
              },
            },
          },
        },
      });
    });

    it('clamps contextCount to 20', async () => {
      const messageCreatedAt = new Date('2026-03-29T12:00:00Z');

      mockFindUnique.mockResolvedValueOnce({
        id: 42,
        senderId: 999,
        chatRoomId: 55,
        rawContent: 'reported message',
        translatedContent: null,
        createdAt: messageCreatedAt,
        sender: { id: 999, username: 'other-user' },
      });

      mockFindFirst.mockResolvedValueOnce(null);
      mockFindMany.mockResolvedValueOnce([]);
      mockCreate.mockResolvedValueOnce({ id: 77 });

      const res = await request(app).post('/reports').send({
        messageId: 42,
        reason: 'hate',
        contextCount: 999,
      });

      expect(res.status).toBe(201);
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 21,
        })
      );
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reason: 'HATE',
            evidence: {
              contextCount: 20,
              contextMessages: [],
            },
          }),
        })
      );
    });

    it('does not fetch context when parsedContextCount is 0', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 42,
        senderId: 999,
        chatRoomId: 55,
        rawContent: 'reported message',
        translatedContent: null,
        createdAt: new Date('2026-03-29T12:00:00Z'),
        sender: { id: 999, username: 'other-user' },
      });

      mockFindFirst.mockResolvedValueOnce(null);
      mockCreate.mockResolvedValueOnce({ id: 77 });

      const res = await request(app).post('/reports').send({
        messageId: 42,
        reason: 'spam_scam',
        contextCount: 0,
      });

      expect(res.status).toBe(201);
      expect(mockFindMany).not.toHaveBeenCalled();
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            evidence: null,
            reason: 'SCAM',
          }),
        })
      );
    });

    it('falls back to translatedContent when rawContent is missing', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 42,
        senderId: 999,
        chatRoomId: null,
        rawContent: null,
        translatedContent: 'translated only',
        createdAt: new Date('2026-03-29T12:00:00Z'),
        sender: { id: 999, username: 'other-user' },
      });

      mockFindFirst.mockResolvedValueOnce(null);
      mockCreate.mockResolvedValueOnce({ id: 77 });

      const res = await request(app).post('/reports').send({
        messageId: 42,
        reason: 'sexual_content',
      });

      expect(res.status).toBe(201);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            decryptedContent: 'translated only',
            reason: 'NUDITY',
          }),
        })
      );
    });

    it('falls back to placeholder text when both raw and translated content are missing', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 42,
        senderId: 999,
        chatRoomId: null,
        rawContent: null,
        translatedContent: null,
        createdAt: new Date('2026-03-29T12:00:00Z'),
        sender: { id: 999, username: 'other-user' },
      });

      mockFindFirst.mockResolvedValueOnce(null);
      mockCreate.mockResolvedValueOnce({ id: 77 });

      const res = await request(app).post('/reports').send({
        messageId: 42,
        reason: 'unknown_reason',
      });

      expect(res.status).toBe(201);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            decryptedContent: '[Encrypted or unavailable content]',
            reason: 'OTHER',
          }),
        })
      );
    });

    it('truncates details to 2000 chars', async () => {
      const longDetails = 'a'.repeat(2500);

      mockFindUnique.mockResolvedValueOnce({
        id: 42,
        senderId: 999,
        chatRoomId: null,
        rawContent: 'reported message',
        translatedContent: null,
        createdAt: new Date('2026-03-29T12:00:00Z'),
        sender: { id: 999, username: 'other-user' },
      });

      mockFindFirst.mockResolvedValueOnce(null);
      mockCreate.mockResolvedValueOnce({ id: 77 });

      const res = await request(app).post('/reports').send({
        messageId: 42,
        reason: 'other',
        details: longDetails,
      });

      expect(res.status).toBe(201);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            details: 'a'.repeat(2000),
          }),
        })
      );
    });

    it('returns 500 when prisma throws', async () => {
      mockFindUnique.mockRejectedValueOnce(new Error('db failed'));

      const res = await request(app).post('/reports').send({
        messageId: 42,
        reason: 'harassment',
      });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to submit report' });
    });
  });
});