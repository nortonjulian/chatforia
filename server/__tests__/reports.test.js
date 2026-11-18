import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const mockMessageFindFirst = jest.fn();
const mockFindFirst = jest.fn();
const mockFindMany = jest.fn();
const mockCreate = jest.fn();
const mockUserBlockUpsert = jest.fn();
const mockUserFindUnique = jest.fn();

let mockAuthUserId = '123';

await jest.unstable_mockModule('@prisma/client', () => {
  const instance = {
    message: {
      findFirst: mockMessageFindFirst,
      findMany: mockFindMany,
    },
    report: {
      findFirst: mockFindFirst,
      create: mockCreate,
    },
    userBlock: { upsert: mockUserBlockUpsert },
    user: { findUnique: mockUserFindUnique },
  };
  instance.$transaction = jest.fn(async (fn) => fn(instance));
  const PrismaClient = jest.fn(() => instance);

  return {
    __esModule: true,
    default: { PrismaClient },
    PrismaClient,
  };
});

await jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: (req, _res, next) => {
    req.user = { id: mockAuthUserId };
    next();
  },
}));

const { default: router } = await import('../routes/reports.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/reports', router);
  return app;
}

describe('reports routes', () => {
  let app;

  beforeEach(() => {
    mockAuthUserId = '123';
    app = makeApp();
    jest.clearAllMocks();
  });

  describe('POST /reports/users/:userId', () => {
    it('rejects invalid and self targets before storage effects', async () => {
      const invalid = await request(app).post('/reports/users/nope').send({ reason: 'harassment' });
      const self = await request(app).post('/reports/users/123').send({ reason: 'harassment' });
      expect(invalid.status).toBe(400);
      expect(self.status).toBe(400);
      expect(mockUserFindUnique).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('rejects missing users and duplicate open reports', async () => {
      mockUserFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 999 });
      mockFindFirst.mockResolvedValueOnce({ id: 8 });
      expect((await request(app).post('/reports/users/999').send({ reason: 'other' })).status).toBe(404);
      expect((await request(app).post('/reports/users/999').send({ reason: 'other' })).status).toBe(409);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('queues a bounded account report without exposing private account data', async () => {
      mockUserFindUnique.mockResolvedValueOnce({ id: 999 });
      mockFindFirst.mockResolvedValueOnce(null);
      mockCreate.mockResolvedValueOnce({ id: 81 });
      const res = await request(app).post('/reports/users/999').send({
        reason: 'sexual_content', details: `  ${'a'.repeat(2100)}  `,
      });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true, reportId: 81 });
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          reporterId: 123, reportedUserId: 999,
          reason: 'NUDITY', details: 'a'.repeat(2000),
          evidence: { source: 'user_profile' }, status: 'OPEN',
        }),
        select: { id: true },
      });
    });
  });

  describe('POST /reports', () => {
    it('returns 401 when authenticated user id is invalid', async () => {
      mockAuthUserId = 'abc';

      const res = await request(app).post('/reports').send({
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
      mockMessageFindFirst.mockResolvedValueOnce(null);

      const res = await request(app).post('/reports').send({
        messageId: 42,
        reason: 'harassment',
      });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Message not found' });

      expect(mockMessageFindFirst).toHaveBeenCalledWith({
        where: {
          id: 42,
          chatRoom: { participants: { some: { userId: 123 } } },
        },
        select: {
          id: true,
          senderId: true,
          chatRoomId: true,
          rawContent: true,
          translatedContent: true,
          createdAt: true,
          attachments: {
            where: { deletedAt: null },
            select: { id: true, kind: true, url: true, thumbUrl: true, mimeType: true },
          },
          sender: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });
    });

    it('rejects a message outside the reporter’s rooms before context, report, or block effects', async () => {
      mockMessageFindFirst.mockResolvedValueOnce(null);

      const res = await request(app).post('/reports').send({
        messageId: 42,
        reason: 'sexual_content',
        blockAfterReport: true,
      });

      expect(res.status).toBe(404);
      expect(mockMessageFindFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          id: 42,
          chatRoom: { participants: { some: { userId: 123 } } },
        },
      }));
      expect(mockFindMany).not.toHaveBeenCalled();
      expect(mockFindFirst).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockUserBlockUpsert).not.toHaveBeenCalled();
    });

    it('returns 400 when user tries to report their own message', async () => {
      mockMessageFindFirst.mockResolvedValueOnce({
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
      mockMessageFindFirst.mockResolvedValueOnce({
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

      mockMessageFindFirst.mockResolvedValueOnce({
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
            select: { id: true, username: true },
          },
          reportedUser: {
            select: { id: true, username: true, isBanned: true },
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

      mockMessageFindFirst.mockResolvedValueOnce({
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
      mockMessageFindFirst.mockResolvedValueOnce({
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

    it('records the reported media references for moderator review without extra context', async () => {
      const attachments = [{
        id: 7, kind: 'IMAGE', url: 'media/private-image',
        thumbUrl: 'thumbs/private-image', mimeType: 'image/jpeg',
      }];
      mockMessageFindFirst.mockResolvedValueOnce({
        id: 42,
        senderId: 999,
        chatRoomId: 55,
        rawContent: '',
        translatedContent: null,
        attachments,
        createdAt: new Date('2026-03-29T12:00:00Z'),
        sender: { id: 999, username: 'other-user' },
      });
      mockFindFirst.mockResolvedValueOnce(null);
      mockCreate.mockResolvedValueOnce({ id: 77 });

      const res = await request(app).post('/reports').send({
        messageId: 42,
        reason: 'sexual_content',
        contextCount: 0,
      });

      expect(res.status).toBe(201);
      expect(mockFindMany).not.toHaveBeenCalled();
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          reason: 'NUDITY',
          evidence: { reportedAttachments: attachments },
        }),
      }));
    });

    it('labels bounded recipient-submitted plaintext as unverified report evidence', async () => {
      mockMessageFindFirst.mockResolvedValueOnce({
        id: 42, senderId: 999, chatRoomId: 55,
        rawContent: '', translatedContent: null, attachments: [],
        createdAt: new Date('2026-03-29T12:00:00Z'),
        sender: { id: 999, username: 'other-user' },
      });
      mockFindFirst.mockResolvedValueOnce(null);
      mockCreate.mockResolvedValueOnce({ id: 77 });

      const res = await request(app).post('/reports').send({
        messageId: 42, reason: 'harassment', contextCount: 0,
        reportedContent: `  ${'a'.repeat(4200)}  `,
      });

      expect(res.status).toBe(201);
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          decryptedContent: 'a'.repeat(4000),
          evidence: { contentSource: 'reporter_submission' },
        }),
      }));
    });

    it('falls back to translatedContent when rawContent is missing', async () => {
      mockMessageFindFirst.mockResolvedValueOnce({
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
      mockMessageFindFirst.mockResolvedValueOnce({
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

      mockMessageFindFirst.mockResolvedValueOnce({
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
      mockMessageFindFirst.mockRejectedValueOnce(new Error('db failed'));

      const res = await request(app).post('/reports').send({
        messageId: 42,
        reason: 'harassment',
      });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to submit report' });
    });
  });
});
