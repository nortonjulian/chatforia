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
    updateMany: jest.fn(),
  },
};

// ESM-safe mocks: must be registered before importing the modules
jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: prismaMock,
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

    test('GET /api/voicemail returns current user voicemails (non-deleted, newest first)', async () => {
    const app = makeApp();
    const fakeVoicemails = [
      { id: 'v2', userId: 123, deleted: false, createdAt: new Date('2024-02-01') },
      { id: 'v1', userId: 123, deleted: false, createdAt: new Date('2024-01-01') },
    ];

    prismaMock.voicemail.findMany.mockResolvedValueOnce(fakeVoicemails);

    const res = await request(app).get('/api/voicemail').expect(200);

    expect(prismaMock.voicemail.findMany).toHaveBeenCalledWith({
      where: {
        userId: 123, // Number('123')
        deleted: false,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Dates are serialized to ISO strings in JSON, so check shape instead of strict deep equality
    expect(res.body.voicemails).toHaveLength(2);

    expect(res.body.voicemails[0]).toEqual(
      expect.objectContaining({
        id: 'v2',
        userId: 123,
        deleted: false,
        createdAt: fakeVoicemails[0].createdAt.toISOString(),
      })
    );

    expect(res.body.voicemails[1]).toEqual(
      expect.objectContaining({
        id: 'v1',
        userId: 123,
        deleted: false,
        createdAt: fakeVoicemails[1].createdAt.toISOString(),
      })
    );
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
