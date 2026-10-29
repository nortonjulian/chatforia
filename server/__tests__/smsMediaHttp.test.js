/** @jest-environment node */
import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { Readable } from 'node:stream';

const state = { messageExists: true, threadOwnerId: 7, urls: ['https://api.twilio.com/fixture'] };
const db = {
  smsMessage: {
    findFirst: jest.fn(async ({ where }) => state.messageExists && where.id === 42
      ? { id: 42, threadId: 19, mediaUrls: state.urls, provider: 'twilio' }
      : null),
  },
  smsThread: {
    findFirst: jest.fn(async ({ where }) => where.id === 19 && where.userId === state.threadOwnerId
      ? { id: 19 }
      : null),
  },
};
const fetchMock = jest.fn(async () =>
  new Response('fixture-image-bytes', {
    status: 200,
    headers: { 'content-type': 'image/jpeg' },
  }));

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true, default: db,
}));
await jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: (req, res, next) => {
    const userId = Number(req.headers['x-test-user-id']);
    if (!Number.isSafeInteger(userId) || userId <= 0) return res.sendStatus(401);
    req.user = { id: userId };
    return next();
  },
}));
await jest.unstable_mockModule('../utils/smsMediaFetch.js', () => ({
  __esModule: true, fetchSMSMedia: fetchMock,
}));
await jest.unstable_mockModule('../services/smsService.js', () => ({
  __esModule: true,
}));
await jest.unstable_mockModule('../services/badgeSync.js', () => ({
  __esModule: true, syncBadgeToUserDevices: jest.fn(),
}));
await jest.unstable_mockModule('../utils/analyticsManager.js', () => ({
  __esModule: true, default: { capture: jest.fn() },
}));

const { default: smsRouter } = await import('../routes/sms.js');
const app = express();
app.use('/sms', smsRouter);
app.use((err, _req, res, _next) => {
  return res.status(err?.output?.statusCode || 500).json({
    error: err?.output?.payload?.error || 'Internal Server Error',
  });
});

beforeEach(() => {
  state.messageExists = true;
  state.threadOwnerId = 7;
  state.urls = ['https://api.twilio.com/fixture'];
  jest.clearAllMocks();
});

const read = (user = 7, url = '/sms/media/42/0') =>
  request(app).get(url).set('x-test-user-id', String(user));

describe('SMS/MMS media HTTP ownership boundary', () => {
  test('unauthenticated request cannot read or fetch an attachment', async () => {
    const response = await request(app).get('/sms/media/42/0');
    expect(response.status).toBe(401);
    expect(db.smsMessage.findFirst).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('authenticated stranger cannot fetch media from another account thread', async () => {
    const denied = await read(8);
    expect(denied.status).toBe(404);
    expect(denied.text).not.toContain('fixture-image-bytes');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.smsThread.findFirst).toHaveBeenCalledWith({
      where: { id: 19, userId: 8 },
      select: { id: true },
    });
  });

  test('guessed nonexistent message ID cannot fetch upstream media', async () => {
    const denied = await read(7, '/sms/media/99/0');
    expect(denied.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.smsThread.findFirst).not.toHaveBeenCalled();
  });

  test('owner can retrieve attachment through authenticated proxy', async () => {
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.body.toString('utf8')).toBe('fixture-image-bytes');
    expect(response.headers['content-type']).toMatch(/^image\/jpeg/);
    expect(response.headers['cache-control']).toContain('private');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(state.urls[0]);
  });

  test('invalid and missing attachment indexes never fetch upstream', async () => {
    for (const path of [
      '/sms/media/not-an-id/0',
      '/sms/media/42/nope',
      '/sms/media/42/-1',
      '/sms/media/42/1',
    ]) {
      const response = await read(7, path);
      expect([400, 404]).toContain(response.status);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('streams an authorized audio attachment with its MIME type', async () => {
    const stream = Readable.from([Buffer.from('voice-note-bytes')]);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({
        'content-type': 'audio/mp4',
        'content-length': '16',
      }),
      body: stream,
    });

    const response = await read();

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch('audio/mp4');
    expect(response.body.toString()).toBe('voice-note-bytes');
  });

  test('returns 502 when the stored-media stream fails before response starts', async () => {
    const stream = new Readable({
      read() {
        this.destroy(new Error('fixture storage interruption'));
      },
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'audio/mp4' }),
      body: stream,
    });

    const response = await read();

    expect(response.status).toBe(502);
    expect(response.text || '').not.toContain('fixture storage interruption');
  });

  test('upstream rejection does not return private bytes', async () => {
    fetchMock.mockResolvedValueOnce(new Response('sensitive upstream error', { status: 403 }));
    const denied = await read();
    expect(denied.status).toBe(502);
    expect(denied.text).not.toContain('sensitive upstream error');
    expect(denied.text).not.toContain('fixture-image-bytes');
  });
});
