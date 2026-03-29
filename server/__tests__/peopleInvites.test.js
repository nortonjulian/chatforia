import request from 'supertest';
import express from 'express';
import router from '../routes/peopleInvites.js';

const mockFindUnique = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();

jest.mock('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: {
    peopleInvite: {
      findUnique: (...args) => mockFindUnique(...args),
      create: (...args) => mockCreate(...args),
      update: (...args) => mockUpdate(...args),
    },
  },
}));

jest.mock('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: (req, _res, next) => {
    req.user = { id: 'user-123' };
    next();
  },
}));

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/people-invites', router);
  return app;
}

describe('peopleInvites routes', () => {
  let app;

  beforeEach(() => {
    app = makeApp();
    jest.clearAllMocks();
    process.env.APP_BASE_URL = 'https://chatforia.com';
  });

  describe('POST /people-invites', () => {
    it('creates an invite with normalized phone and returns url', async () => {
      mockFindUnique.mockResolvedValueOnce(null);
      mockCreate.mockResolvedValueOnce({
        id: 'invite-1',
        code: 'abc123xyz0',
        inviterUserId: 'user-123',
        targetPhone: '+17195551234',
        targetEmail: 'test@example.com',
        channel: 'sms',
      });

      const res = await request(app)
        .post('/people-invites')
        .send({
          targetPhone: '(719) 555-1234',
          targetEmail: ' Test@Example.com ',
          channel: 'sms',
        });

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.url).toBe('https://chatforia.com/i/abc123xyz0');

      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          code: expect.any(String),
          inviterUserId: 'user-123',
          targetPhone: '+17195551234',
          targetEmail: 'test@example.com',
          channel: 'sms',
        },
      });
    });

    it('defaults channel to share_link when blank', async () => {
      mockFindUnique.mockResolvedValueOnce(null);
      mockCreate.mockResolvedValueOnce({
        id: 'invite-2',
        code: 'defaultchan',
        inviterUserId: 'user-123',
        targetPhone: null,
        targetEmail: null,
        channel: 'share_link',
      });

      const res = await request(app)
        .post('/people-invites')
        .send({
          channel: '   ',
        });

      expect(res.status).toBe(201);
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          inviterUserId: 'user-123',
          targetPhone: null,
          targetEmail: null,
          channel: 'share_link',
        }),
      });
    });

    it('returns 500 if unable to generate a unique code after 5 tries', async () => {
      mockFindUnique.mockResolvedValue({ id: 'existing-invite' });

      const res = await request(app)
        .post('/people-invites')
        .send({ targetPhone: '7195551234' });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to generate invite code.' });
      expect(mockFindUnique).toHaveBeenCalledTimes(5);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('returns 500 if prisma create throws', async () => {
      mockFindUnique.mockResolvedValueOnce(null);
      mockCreate.mockRejectedValueOnce(new Error('db failed'));

      const res = await request(app)
        .post('/people-invites')
        .send({ targetPhone: '7195551234' });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to create invite.' });
    });
  });

  describe('GET /people-invites/:code', () => {
    it('returns invite preview when found', async () => {
      const expiresAt = new Date('2026-04-01T00:00:00.000Z');

      mockFindUnique.mockResolvedValueOnce({
        id: 'invite-1',
        code: 'preview123',
        status: 'pending',
        targetPhone: '+17195551234',
        targetEmail: 'friend@example.com',
        expiresAt,
        inviterUser: {
          id: 'inviter-1',
          username: 'julian',
          avatarUrl: 'https://cdn.test/avatar.png',
        },
      });

      const res = await request(app).get('/people-invites/preview123');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        invite: {
          code: 'preview123',
          status: 'pending',
          targetPhone: '+17195551234',
          targetEmail: 'friend@example.com',
          inviterUser: {
            id: 'inviter-1',
            username: 'julian',
            avatarUrl: 'https://cdn.test/avatar.png',
          },
          expiresAt: expiresAt.toISOString(),
        },
      });
    });

    it('returns expired status when invite is pending and expiresAt is in the past', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'invite-1',
        code: 'expired123',
        status: 'pending',
        targetPhone: null,
        targetEmail: null,
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
        inviterUser: {
          id: 'inviter-1',
          username: 'julian',
          avatarUrl: null,
        },
      });

      const res = await request(app).get('/people-invites/expired123');

      expect(res.status).toBe(200);
      expect(res.body.invite.status).toBe('expired');
    });

    it('returns 404 when invite does not exist', async () => {
      mockFindUnique.mockResolvedValueOnce(null);

      const res = await request(app).get('/people-invites/missing');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Invite not found.' });
    });

    it('returns 500 when prisma lookup fails', async () => {
      mockFindUnique.mockRejectedValueOnce(new Error('db failed'));

      const res = await request(app).get('/people-invites/oops');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to load invite.' });
    });
  });

  describe('POST /people-invites/:code/redeem', () => {
    it('redeems a valid invite', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'invite-1',
        code: 'redeem123',
        inviterUserId: 'someone-else',
        status: 'pending',
        expiresAt: new Date('2026-04-10T00:00:00.000Z'),
      });

      mockUpdate.mockResolvedValueOnce({
        id: 'invite-1',
        code: 'redeem123',
        inviterUserId: 'someone-else',
        acceptedByUserId: 'user-123',
        status: 'accepted',
      });

      const res = await request(app).post('/people-invites/redeem123/redeem');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.invite.status).toBe('accepted');

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'invite-1' },
        data: {
          status: 'accepted',
          acceptedByUserId: 'user-123',
        },
      });
    });

    it('returns 404 when invite is missing', async () => {
      mockFindUnique.mockResolvedValueOnce(null);

      const res = await request(app).post('/people-invites/missing/redeem');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Invite not found.' });
    });

    it('returns 400 when user tries to redeem own invite', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'invite-1',
        code: 'self123',
        inviterUserId: 'user-123',
        status: 'pending',
        expiresAt: null,
      });

      const res = await request(app).post('/people-invites/self123/redeem');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'You cannot redeem your own invite.' });
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('returns 409 when invite already accepted', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'invite-1',
        code: 'accepted123',
        inviterUserId: 'other-user',
        status: 'accepted',
        expiresAt: null,
      });

      const res = await request(app).post('/people-invites/accepted123/redeem');

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'Invite already accepted.' });
    });

    it('returns 410 when invite is revoked', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'invite-1',
        code: 'revoked123',
        inviterUserId: 'other-user',
        status: 'revoked',
        expiresAt: null,
      });

      const res = await request(app).post('/people-invites/revoked123/redeem');

      expect(res.status).toBe(410);
      expect(res.body).toEqual({ error: 'Invite revoked.' });
    });

    it('returns 410 when invite is expired', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'invite-1',
        code: 'expired123',
        inviterUserId: 'other-user',
        status: 'pending',
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
      });

      const res = await request(app).post('/people-invites/expired123/redeem');

      expect(res.status).toBe(410);
      expect(res.body).toEqual({ error: 'Invite expired.' });
    });

    it('returns 500 when prisma update throws', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'invite-1',
        code: 'redeem500',
        inviterUserId: 'other-user',
        status: 'pending',
        expiresAt: null,
      });

      mockUpdate.mockRejectedValueOnce(new Error('db failed'));

      const res = await request(app).post('/people-invites/redeem500/redeem');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to redeem invite.' });
    });
  });
});