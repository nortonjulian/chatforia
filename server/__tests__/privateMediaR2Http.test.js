/** @jest-environment node */
import { jest, describe, test, expect, beforeEach, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { Readable } from 'node:stream';

const state = {
  member: true, deleted: false, expired: false,
  mediaRef: 'https://cdn.chatforia.com/uploads/u1/voice.webm',
};
const sendR2 = jest.fn(async command => {
  const { Bucket, Key, Range } = command.input;
  if (Bucket !== 'test-private-bucket' || ![
    'uploads/u1/voice.webm',
    'uploads/u1/2026/10/26/voice.webm',
  ].includes(Key)) {
    throw new Error('Unexpected R2 object key');
  }
  if (Range === 'bytes=0-3') {
    return {
      ContentType: 'audio/webm;codecs=opus',
      ContentLength: 4,
      ContentRange: 'bytes 0-3/10',
      Body: Readable.from(['0123']),
    };
  }
  return { ContentType: 'audio/webm;codecs=opus', ContentLength: 10, Body: Readable.from(['0123456789']) };
});
const db = {
  messageAttachment: { findUnique: jest.fn(async () => ({
    id: 12,
    url: state.mediaRef,
    thumbUrl: null,
    deletedAt: null,
    message: {
      id: 15, chatRoomId: 9, senderId: 1,
      createdAt: new Date('2026-01-01'),
      expiresAt: state.expired ? new Date('2025-01-01') : null,
      deletedForAll: state.deleted,
      deletedBySender: false, deletions: [],
    },
  })) },
  participant: { findUnique: jest.fn(async ({ where }) =>
    state.member && Number(where.chatRoomId_userId.userId) === 2
      ? { id: 10, clearedAt: null }
      : null) },
  threadState: { findUnique: jest.fn(async () => null) },
};
await jest.unstable_mockModule('../utils/prismaClient.js', () => ({ __esModule: true, default: db }));
await jest.unstable_mockModule('../utils/r2.js', () => ({ __esModule: true, r2: { send: sendR2 } }));
await jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: (req, res, next) => {
    const id = Number(req.get('x-test-user-id'));
    if (!Number.isSafeInteger(id) || id <= 0) return res.sendStatus(401);
    req.user = { id, role: 'USER' };
    return next();
  },
}));
const { default: router } = await import('../routes/privateMedia.js');
const app = express();
app.use('/private-media', router);
const originalBucket = process.env.R2_BUCKET;
beforeAll(() => { process.env.R2_BUCKET = 'test-private-bucket'; });
afterAll(() => {
  if (originalBucket === undefined) delete process.env.R2_BUCKET;
  else process.env.R2_BUCKET = originalBucket;
});
beforeEach(() => {
  state.member = true; state.deleted = false; state.expired = false;
  state.mediaRef = 'https://cdn.chatforia.com/uploads/u1/voice.webm';
  sendR2.mockClear();
});
const issue = (viewerId = 2) => request(app)
  .get('/private-media/message/12').set('x-test-user-id', String(viewerId));

describe('R2 downstream cancellation cleanup', () => {
  test('destroys upstream R2 body after HTTP client disconnect', async () => {
    const { PassThrough } = await import('node:stream');
    const { createServer, get } = await import('node:http');

    const upstream = new PassThrough();

    sendR2.mockImplementationOnce(async () => ({
      ContentType: 'audio/webm',
      Body: upstream,
    }));

    const server = createServer(app);

    try {
      await new Promise(resolve =>
        server.listen(0, '127.0.0.1', resolve)
      );

      const grant = await issue();
      expect(grant.status).toBe(200);

      const address = server.address();

      await new Promise((resolve, reject) => {
        let settled = false;

        const succeed = () => {
          if (settled) return;
          settled = true;
          resolve();
        };

        const fail = error => {
          if (settled) return;
          settled = true;
          reject(error);
        };

        const req = get(
          `http://127.0.0.1:${address.port}${grant.body.url}`,
          response => {
            response.once('data', () => {
              response.destroy();
              succeed();
            });

            response.once('error', error => {
              if (response.destroyed) succeed();
              else fail(error);
            });
          }
        );

        req.once('error', error => {
          if (req.destroyed) succeed();
          else fail(error);
        });

        // The request must reach the mocked R2 client before bytes
        // are written, otherwise a stream timing race can hide the bug.
        const checkReady = () => {
          if (sendR2.mock.calls.length > 0) {
            upstream.write('partial-media');
          } else {
            setImmediate(checkReady);
          }
        };

        checkReady();
      });

      // Client-side destruction is asynchronous. Wait for the
      // upstream stream's actual close event, with a bounded timeout.
      await new Promise((resolve, reject) => {
        if (upstream.destroyed) return resolve();

        const timeout = setTimeout(() => {
          upstream.off('close', onClose);
          reject(new Error(
            'R2 upstream was not destroyed after client disconnect'
          ));
        }, 1500);

        const onClose = () => {
          clearTimeout(timeout);
          resolve();
        };

        upstream.once('close', onClose);
      });

      expect(upstream.destroyed).toBe(true);
    } finally {
      upstream.destroy();
      await new Promise(resolve => server.close(resolve));
    }
  }, 10000);
});

describe('R2 pending-request cancellation', () => {
  test('aborts the R2 request when the client disconnects before headers', async () => {
    const { createServer, get } = await import('node:http');

    let signal;
    let notifyStarted;
    const started = new Promise(resolve => { notifyStarted = resolve; });

    sendR2.mockImplementationOnce((_command, options) => {
      signal = options?.abortSignal;
      notifyStarted();

      // Simulate R2 taking time to return its response.
      // Reject only when the server aborts the SDK request.
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('R2 request aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    });

    const server = createServer(app);
    let req;

    try {
      await new Promise(resolve =>
        server.listen(0, '127.0.0.1', resolve)
      );

      const grant = await issue();
      expect(grant.status).toBe(200);

      const address = server.address();

      req = get(
        `http://127.0.0.1:${address.port}${grant.body.url}`
      );

      req.on('error', () => {
        // Expected when disconnecting before receiving headers.
      });

      await started;
      expect(signal).toBeDefined();
      expect(signal.aborted).toBe(false);

      req.destroy();

      await new Promise((resolve, reject) => {
        if (signal.aborted) return resolve();

        const timeout = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          reject(new Error(
            'Pending R2 request did not receive cancellation'
          ));
        }, 1500);

        const onAbort = () => {
          clearTimeout(timeout);
          resolve();
        };

        signal.addEventListener('abort', onAbort, { once: true });
      });

      expect(signal.aborted).toBe(true);
    } finally {
      req?.destroy();
      await new Promise(resolve => server.close(resolve));
    }
  }, 10000);
});

describe('authorized R2 message media streaming over HTTP', () => {
  test('owner-room participant receives private cloud audio through API, not public CDN', async () => {
    expect((await issue(3)).status).toBe(404);
    expect((await request(app).get('/private-media/message/12')).status).toBe(401);
    const grant = await issue();
    expect(grant.status).toBe(200);
    expect(grant.body.url).toMatch(/^\/private-media\/file\?token=/);
    const result = await request(app).get(grant.body.url);
    expect(result.status).toBe(200);
    expect(result.headers['content-type']).toContain('audio/webm');
    expect(result.headers['cache-control']).toContain('no-store');
    expect(result.body.toString('utf8')).toBe('0123456789');
    expect(sendR2).toHaveBeenCalledTimes(1);
    expect(sendR2.mock.calls[0][0].input.Key).toBe('uploads/u1/voice.webm');
  });

  test('new nested R2 object keys stream only for authorized participants', async () => {
    state.mediaRef = 'uploads/u1/2026/10/26/voice.webm';

    // A bare storage key must never make an upload publicly downloadable.
    expect((await issue(3)).status).toBe(404);
    expect(sendR2).not.toHaveBeenCalled();

    const grant = await issue(2);
    expect(grant.status).toBe(200);
    expect(grant.body.url).toMatch(/^\/private-media\/file\?token=/);

    const download = await request(app).get(grant.body.url);
    expect(download.status).toBe(200);
    expect(download.body.toString('utf8')).toBe('0123456789');
    expect(sendR2).toHaveBeenCalledTimes(1);
    expect(sendR2.mock.calls[0][0].input.Key).toBe(state.mediaRef);

    // Issued URLs are not permanent access: revocation is checked on use.
    state.member = false;
    const revoked = await request(app).get(grant.body.url);
    expect(revoked.status).toBe(404);
    expect(sendR2).toHaveBeenCalledTimes(1);
  });

  test('a player Range request yields 206 and partial content, invalid range fails closed', async () => {
    const grant = await issue();
    const ranged = await request(app).get(grant.body.url).set('Range', 'bytes=0-3');
    expect(ranged.status).toBe(206);
    expect(ranged.body.toString('utf8')).toBe('0123');
    expect(ranged.headers['content-range']).toBe('bytes 0-3/10');
    expect(sendR2.mock.calls[0][0].input.Range).toBe('bytes=0-3');
    const denied = await request(app).get(grant.body.url).set('Range', 'bytes=0-1,4-5');
    expect(denied.status).toBe(416);
    expect(sendR2).toHaveBeenCalledTimes(1);
  });

  test('download capability is revoked on membership removal, deletion or expiry', async () => {
    for (const key of ['member', 'deleted', 'expired']) {
      state.member = true; state.deleted = false; state.expired = false;
      const grant = await issue();
      expect(grant.status).toBe(200);
      if (key === 'member') state.member = false;
      else state[key] = true;
      const denied = await request(app).get(grant.body.url);
      expect(denied.status).toBe(404);
      expect(sendR2).not.toHaveBeenCalled();
    }
  });

  test('unconfigured cloud bucket never falls back to a public CDN URL', async () => {
    const grant = await issue();
    delete process.env.R2_BUCKET;
    try {
      const response = await request(app).get(grant.body.url);
      expect(response.status).toBe(503);
      expect(sendR2).not.toHaveBeenCalled();
    } finally {
      process.env.R2_BUCKET = 'test-private-bucket';
    }
  });
});
