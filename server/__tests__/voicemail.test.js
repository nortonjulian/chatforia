/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// ---- Shared Prisma mock ----
const prismaMock = {
  voicemail: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
  },
};

// ESM-safe mocks: must be registered before importing the modules
jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: prismaMock,
}));

const fetchTwilioMediaMock = jest.fn();

jest.unstable_mockModule('../utils/twilioMediaProxy.js', () => ({
  __esModule: true,
  fetchTwilioMedia: fetchTwilioMediaMock,
}));

jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: (req, _res, next) => {
    // Simulate a logged-in user with string id to exercise Number()
    req.user = { id: '123' };
    next();
  },
}));

// Now import the router AFTER mocks are in place
const { default: voicemailRouter } = await import('../routes/voicemail.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/voicemail', voicemailRouter);
  return app;
}

describe('voicemail routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/voicemail returns caller identity for app voicemails', async () => {
    const app = makeApp();

    const fakeVoicemails = [
      {
        id: 'alias-vm',
        userId: 123,
        deleted: false,
        fromNumber: '+18187914303',
        createdAt: new Date('2024-05-05T10:00:00Z'),
        relatedCall: {
          callerId: 456,
          calleeId: 123,
          caller: {
            id: 456,
            displayName: 'Julian Norton',
            username: 'julian',
            contactsSaved: [
              {
                alias: 'Julian',
              },
            ],
          },
        },
      },
      {
        id: 'display-name-vm',
        userId: 123,
        deleted: false,
        fromNumber: '+18187914304',
        createdAt: new Date('2024-05-04T10:00:00Z'),
        relatedCall: {
          callerId: 457,
          calleeId: 123,
          caller: {
            id: 457,
            displayName: 'Alice Smith',
            username: 'alice',
            contactsSaved: [],
          },
        },
      },
      {
        id: 'username-vm',
        userId: 123,
        deleted: false,
        fromNumber: null,
        createdAt: new Date('2024-05-03T10:00:00Z'),
        relatedCall: {
          callerId: 458,
          calleeId: 123,
          caller: {
            id: 458,
            displayName: null,
            username: 'onlyusername',
            contactsSaved: [],
          },
        },
      },
      {
        id: 'external-vm',
        userId: 123,
        deleted: false,
        fromNumber: '+13235550100',
        createdAt: new Date('2024-05-02T10:00:00Z'),
        relatedCall: null,
      },
      {
        id: 'wrong-callee-vm',
        userId: 123,
        deleted: false,
        fromNumber: '+13235550101',
        createdAt: new Date('2024-05-01T10:00:00Z'),
        relatedCall: {
          callerId: 999,
          calleeId: 999,
          caller: {
            id: 999,
            displayName: 'Private Caller',
            username: 'privatecaller',
            contactsSaved: [],
          },
        },
      },
    ];

    prismaMock.voicemail.findMany.mockResolvedValueOnce(
      fakeVoicemails,
    );

    const res = await request(app)
      .get('/api/voicemail')
      .expect(200);

    expect(prismaMock.voicemail.findMany).toHaveBeenCalledWith({
      where: {
        userId: 123,
        deleted: false,
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        relatedCall: {
          select: {
            callerId: true,
            calleeId: true,
            caller: {
              select: {
                id: true,
                displayName: true,
                username: true,
                contactsSaved: {
                  where: {
                    ownerId: 123,
                  },
                  select: {
                    alias: true,
                  },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });

    expect(res.body.voicemails).toHaveLength(5);

    expect(res.body.voicemails[0]).toEqual(
      expect.objectContaining({
        id: 'alias-vm',
        callerUserId: 456,
        displayName: 'Julian',
        username: 'julian',
      }),
    );

    expect(res.body.voicemails[1]).toEqual(
      expect.objectContaining({
        id: 'display-name-vm',
        callerUserId: 457,
        displayName: 'Alice Smith',
        username: 'alice',
      }),
    );

    expect(res.body.voicemails[2]).toEqual(
      expect.objectContaining({
        id: 'username-vm',
        callerUserId: 458,
        displayName: null,
        username: 'onlyusername',
      }),
    );

    expect(res.body.voicemails[3]).toEqual(
      expect.objectContaining({
        id: 'external-vm',
        callerUserId: null,
        displayName: null,
        username: null,
        fromNumber: '+13235550100',
      }),
    );

    expect(res.body.voicemails[4]).toEqual(
      expect.objectContaining({
        id: 'wrong-callee-vm',
        callerUserId: null,
        displayName: null,
        username: null,
      }),
    );

    expect(res.body.voicemails[0]).not.toHaveProperty(
      'relatedCall',
    );
  });

  test('GET /api/voicemail/:id/audio securely proxies Twilio audio', async () => {
    const app = makeApp();
    const audioBytes = Buffer.from([1, 2, 3, 4]);

    prismaMock.voicemail.findFirst.mockResolvedValueOnce({
      audioUrl: 'https://api.twilio.com/recording.mp3',
    });

    fetchTwilioMediaMock.mockResolvedValueOnce({
      headers: {
        get: jest.fn((name) => {
          if (name === 'content-type') return 'audio/mpeg';
          if (name === 'content-length') {
            return String(audioBytes.length);
          }
          return null;
        }),
      },
      body: null,
      arrayBuffer: jest.fn().mockResolvedValue(
        audioBytes.buffer.slice(
          audioBytes.byteOffset,
          audioBytes.byteOffset + audioBytes.byteLength,
        ),
      ),
    });

    const res = await request(app)
      .get('/api/voicemail/vm-audio/audio')
      .expect(200);

    expect(prismaMock.voicemail.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'vm-audio',
        userId: 123,
        deleted: false,
      },
      select: {
        audioUrl: true,
      },
    });

    expect(fetchTwilioMediaMock).toHaveBeenCalledWith(
      'https://api.twilio.com/recording.mp3',
    );

    expect(res.headers['content-type']).toMatch(/^audio\/mpeg/);
    expect(Buffer.from(res.body)).toEqual(audioBytes);
  });

  test('GET /api/voicemail/:id/audio rejects another user or missing audio', async () => {
    const app = makeApp();

    prismaMock.voicemail.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/api/voicemail/missing/audio')
      .expect(404);

    expect(res.body).toEqual({
      error: 'Voicemail audio not found',
    });

    expect(fetchTwilioMediaMock).not.toHaveBeenCalled();
  });

  test('PATCH /api/voicemail/:id/read marks voicemail as read/unread (success)', async () => {
    const app = makeApp();

    prismaMock.voicemail.updateMany.mockResolvedValueOnce({ count: 1 });

    const res = await request(app)
      .patch('/api/voicemail/vm123/read')
      .send({ isRead: false })
      .expect(200);

    expect(prismaMock.voicemail.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'vm123',
        userId: 123,
        deleted: false,
      },
      data: {
        isRead: false,
      },
    });

    expect(res.body).toEqual({ success: true });
  });

  test('PATCH /api/voicemail/:id/read returns 404 when nothing updated', async () => {
    const app = makeApp();

    prismaMock.voicemail.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await request(app)
      .patch('/api/voicemail/does-not-exist/read')
      .send({ isRead: true })
      .expect(404);

    expect(res.body).toEqual({ error: 'Voicemail not found' });
  });

  test('DELETE /api/voicemail/:id soft-deletes voicemail (success)', async () => {
    const app = makeApp();

    prismaMock.voicemail.updateMany.mockResolvedValueOnce({ count: 1 });

    const res = await request(app)
      .delete('/api/voicemail/vm-del-1')
      .expect(200);

    expect(prismaMock.voicemail.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'vm-del-1',
        userId: 123,
        deleted: false,
      },
      data: {
        deleted: true,
        deletedAt: expect.any(Date),
      },
    });

    expect(res.body).toEqual({ success: true });
  });

  test('DELETE /api/voicemail/:id returns 404 when nothing to delete', async () => {
    const app = makeApp();

    prismaMock.voicemail.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await request(app)
      .delete('/api/voicemail/missing')
      .expect(404);

    expect(res.body).toEqual({ error: 'Voicemail not found' });
  });
});
