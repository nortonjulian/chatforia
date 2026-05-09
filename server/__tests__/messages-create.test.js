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
jest.mock('../utils/antivirus.js', () => ({
  __esModule: true,
  scanFile: jest.fn(async () => ({ ok: true })),
}));

jest.mock('../utils/thumbnailer.js', () => ({
  __esModule: true,
  ensureThumb: jest.fn(async (_filepath, relName) => ({
    rel: `thumbs/${relName}`,
  })),
}));

import { createApp } from '../app.js';

const app = createApp();

const ENDPOINTS = {
  register: '/auth/register',
  login: '/auth/login',
  token: '/auth/token',
  createRoom: '/rooms',
  sendMessage: '/messages',
  react: (id) => `/messages/${id}/reactions`,
  unreact: (id, emoji) => `/messages/${id}/reactions/${encodeURIComponent(emoji)}`,
};

describe('Messages: create + reactions', () => {
  let agent;
  let bearer;
  let roomId;
  let tmpMediaPath;

  beforeEach(async () => {
    try { await prisma.messageAttachment.deleteMany({}); } catch {}
    try { await prisma.messageReaction.deleteMany({}); } catch {}
    try { await prisma.messageRead.deleteMany({}); } catch {}
    try { await prisma.messageKey.deleteMany({}); } catch {}
    try { await prisma.messageDeletion.deleteMany({}); } catch {}
    try { await prisma.message.deleteMany({}); } catch {}
    try { await prisma.participant.deleteMany({}); } catch {}
    try { await prisma.chatRoom.deleteMany({}); } catch {}
    try { await prisma.user.deleteMany({}); } catch {}

    agent = request.agent(app);

    tmpMediaPath = path.join(os.tmpdir(), `test-img-${Date.now()}.jpg`);
    fs.writeFileSync(tmpMediaPath, 'fake image bytes');

    const email = 'bob@example.com';
    const password = 'Test12345!';
    const username = 'bob';

    await agent
      .post(ENDPOINTS.register)
      .send({ email, password, username })
      .then((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(`Unexpected /auth/register status ${res.status}`);
        }
      });

    // Email verification gate fix
    await prisma.user.update({
      where: { email },
      data: { emailVerifiedAt: new Date() },
    });

    await agent
      .post(ENDPOINTS.login)
      .send({ identifier: email, password })
      .then((res) => {
        if (res.status !== 200) {
          throw new Error(`Unexpected /auth/login status ${res.status}`);
        }
      });

    const tok = await agent.get(ENDPOINTS.token).expect(200);
    bearer = `Bearer ${tok.body.token}`;

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
    const m = await agent
      .post(ENDPOINTS.sendMessage)
      .set('Authorization', bearer)
      .send({
        chatRoomId: roomId,
        content: 'hello',
        kind: 'TEXT',
      })
      .then((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(`Unexpected /messages status ${res.status}`);
        }
        return res;
      });

    const messageId = m.body.message?.id || m.body.id;
    expect(messageId).toBeDefined();

    const addReactRes = await agent
      .post(ENDPOINTS.react(messageId))
      .set('Authorization', bearer)
      .send({ emoji: '👍' });

    expect(addReactRes.status).toBe(200);

    if ('ok' in addReactRes.body) {
      expect(addReactRes.body.ok).toBe(true);
    }

    const delReactRes = await agent
      .delete(ENDPOINTS.unreact(messageId, '👍'))
      .set('Authorization', bearer);

    expect(delReactRes.status).toBe(200);

    if ('ok' in delReactRes.body) {
      expect(delReactRes.body.ok).toBe(true);
    }
  });

  test('create media message (multipart upload) returns 201 and attachment info', async () => {
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
      .attach('files', tmpMediaPath, {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      });

    if (![200, 201].includes(res.status)) {
      console.log('MEDIA CREATE FAILED:', {
        status: res.status,
        body: res.body,
        text: res.text,
      });
    }

    expect([200, 201].includes(res.status)).toBe(true);

    const payload = res.body.message || res.body;

    const createdId = payload.id;
    expect(createdId).toBeDefined();

    const atts = payload.attachments || [];
    expect(Array.isArray(atts)).toBe(true);
    expect(atts.length).toBeGreaterThanOrEqual(1);

    const first = atts[0];

    expect(first.kind).toBe('IMAGE');
    expect(typeof first.url).toBe('string');

    // Depending on whether shapeMessageForUser signed it already
    expect(
      first.url.startsWith('/files?token=') ||
      first.url.startsWith('media/') ||
      first.url.includes('photo')
    ).toBe(true);

    expect(first.width).toBe(320);
    expect(first.height).toBe(240);
    expect(first.caption).toBe('test pic');
  });
});