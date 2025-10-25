/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import request from 'supertest';
import prisma from '../utils/prismaClient.js';

// ---- Mocks for heavy deps in the /messages route ----
// Must be declared BEFORE importing app so that when the router module is loaded,
// it sees the mocked versions.

jest.mock('../utils/antivirus.js', () => {
  return {
    __esModule: true,
    scanFile: jest.fn(async (_filepath) => {
      // pretend AV says file is clean
      return { ok: true };
    }),
  };
});

jest.mock('../utils/thumbnailer.js', () => {
  return {
    __esModule: true,
    ensureThumb: jest.fn(async (_filepath, relName) => {
      // pretend we generated a thumbnail and return a faux path
      return { rel: `thumbs/${relName}` };
    }),
  };
});

// Now that heavy stuff is mocked, we can bring in the real app.
import app from '../app.js';

const ENDPOINTS = {
  register: '/auth/register',
  login: '/auth/login',
  token: '/auth/token',
  createRoom: '/chatrooms',
  sendMessage: '/messages',
  react: (id) => `/messages/${id}/reactions`,
  unreact: (id, emoji) => `/messages/${id}/reactions/${encodeURIComponent(emoji)}`,
};

describe('Messages: create + reactions', () => {
  let agent;
  let bearer;
  let roomId;
  let tmpMediaPath; // we'll create a real temp file to upload

  beforeEach(async () => {
    // wipe DB to avoid FK issues between runs
    try { await prisma.message.deleteMany({}); } catch {}
    try { await prisma.chatRoom.deleteMany({}); } catch {}
    try { await prisma.user.deleteMany({}); } catch {}

    agent = request.agent(app);

    // create a tiny "image" file in tmp just so multer has bytes to read
    tmpMediaPath = path.join(os.tmpdir(), `test-img-${Date.now()}.jpg`);
    fs.writeFileSync(tmpMediaPath, 'fake image bytes');

    const email = 'bob@example.com';
    const password = 'Test12345!';
    const username = 'bob';

    // Register (allow 200 or 201)
    await agent
      .post(ENDPOINTS.register)
      .send({ email, password, username })
      .then((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(`Unexpected /auth/register status ${res.status}`);
        }
      });

    // Login (should be 200, sets cookie on agent)
    await agent
      .post(ENDPOINTS.login)
      .send({ identifier: email, password })
      .then((res) => {
        if (res.status !== 200) {
          throw new Error(`Unexpected /auth/login status ${res.status}`);
        }
      });

    // Grab bearer auth for Authorization header
    const tok = await agent.get(ENDPOINTS.token).expect(200);
    bearer = `Bearer ${tok.body.token}`;

    // Create chat room (allow 200 or 201)
    const r = await agent
      .post(ENDPOINTS.createRoom)
      .set('Authorization', bearer)
      .send({ name: 'Room A', isGroup: true })
      .then((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(`Unexpected /chatrooms status ${res.status}`);
        }
        return res;
      });

    roomId = r.body.id || r.body.room?.id;
    if (!roomId) {
      throw new Error('Room ID missing from /chatrooms response');
    }
  });

  afterEach(() => {
    // cleanup the temp media file if it still exists
    try {
      if (tmpMediaPath && fs.existsSync(tmpMediaPath)) {
        fs.unlinkSync(tmpMediaPath);
      }
    } catch {}
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('create text message and add/remove reaction', async () => {
    // Create a plain text message
    const m = await agent
      .post(ENDPOINTS.sendMessage)
      .set('Authorization', bearer)
      .send({ chatRoomId: roomId, content: 'hello', kind: 'TEXT' })
      .then((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(`Unexpected /messages status ${res.status}`);
        }
        return res;
      });

    const messageId = m.body.id || m.body.message?.id;
    expect(messageId).toBeDefined();

    // React 👍
    const addReactRes = await agent
      .post(ENDPOINTS.react(messageId))
      .set('Authorization', bearer)
      .send({ emoji: '👍' });

    expect(addReactRes.status).toBe(200);
    // In test mode, the in-memory reaction path returns { ok: true, op: 'added', ... }
    // Let's assert ok if present:
    if ('ok' in addReactRes.body) {
      expect(addReactRes.body.ok).toBe(true);
    }

    // Remove 👍
    const delReactRes = await agent
      .delete(ENDPOINTS.unreact(messageId, '👍'))
      .set('Authorization', bearer);

    expect(delReactRes.status).toBe(200);
    if ('ok' in delReactRes.body) {
      expect(delReactRes.body.ok).toBe(true);
    }
  });

  test('create media message (multipart upload) returns 201 and attachment info', async () => {
    // We’re simulating: user sends an image in Room A.
    //
    // The /messages route expects multipart/form-data with:
    //   - files[] (handled by uploadMedia.array('files', 10))
    //   - plus regular fields like chatRoomId, kind, content, attachmentsMeta, etc.
    //
    // For attachmentsMeta, we'll describe width/height/etc for index 0.
    // The route will:
    //   - run mocked scanFile() which always says ok
    //   - run mocked ensureThumb() which gives us a fake thumb rel
    //   - build uploaded[0] with kind 'IMAGE'
    //   - respond 201 with shaped.attachments[0].url signed via /files?token=...

    const attachmentsMeta = [
      {
        idx: 0,
        width: 320,
        height: 240,
        caption: 'test pic',
        kind: 'IMAGE',
      },
    ];

    const res = await agent
      .post(ENDPOINTS.sendMessage)
      .set('Authorization', bearer)
      .field('chatRoomId', String(roomId))
      .field('kind', 'IMAGE')
      .field('content', 'photo message')
      .field('attachmentsMeta', JSON.stringify(attachmentsMeta))
      // IMPORTANT: the field name 'files' MUST match uploadMedia.array('files', 10)
      .attach('files', tmpMediaPath, { filename: 'photo.jpg', contentType: 'image/jpeg' });

    // Expect success (201 in your route, but allow 200 just in case your app tweaks)
    expect([200, 201].includes(res.status)).toBe(true);

    // The response body is built as `shaped` in the route.
    // We expect:
    // - an id of the created message
    // - attachments array with at least one entry
    // - kind IMAGE
    // - url rewritten to /files?token=...
    expect(res.body).toBeDefined();

    const createdId = res.body.id;
    expect(createdId).toBeDefined();

    const atts = res.body.attachments || [];
    expect(Array.isArray(atts)).toBe(true);
    expect(atts.length).toBeGreaterThanOrEqual(1);

    const first = atts[0];
    expect(first.kind).toBe('IMAGE');
    expect(typeof first.url).toBe('string');
    expect(first.url.startsWith('/files?token=')).toBe(true);

    // Optional sanity on thumbnail mock:
    // Our mock ensureThumb() returns { rel: "thumbs/<relName>" }
    // That gets stored in uploaded._thumb but we don't directly expose _thumb
    // in the final shaped attachment (we only expose mapped props).
    // So we won't assert _thumb unless you choose to expose it later.

    // Also check server echoed dimensions & caption from attachmentsMeta
    // (Your route maps width/height/caption etc into attachment)
    expect(first.width).toBe(320);
    expect(first.height).toBe(240);
    expect(first.caption).toBe('test pic');
  });
});
