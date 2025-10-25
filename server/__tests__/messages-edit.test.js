/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import prisma from '../utils/prismaClient.js';
import app from '../app.js';

const ENDPOINTS = {
  register: '/auth/register',
  login: '/auth/login',
  createRoom: '/chatrooms',
  sendMessage: '/messages',
  editMessage: (id) => `/messages/${id}`,
};

describe('Messages: edit rules', () => {
  let agent;
  let roomId;
  let messageId;
  let bearer;

  beforeEach(async () => {
    // wipe DB between tests (children first to avoid FK issues)
    try { await prisma.message.deleteMany({}); } catch {}
    try { await prisma.chatRoom.deleteMany({}); } catch {}
    try { await prisma.user.deleteMany({}); } catch {}

    agent = request.agent(app);

    const email = 'chris@example.com';
    const password = 'Test12345!';
    const username = 'chris';

    // Register (allow 200 or 201)
    await agent
      .post(ENDPOINTS.register)
      .send({ email, password, username })
      .then((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(`Unexpected /auth/register status ${res.status}`);
        }
      });

    // Login (200 expected)
    await agent
      .post(ENDPOINTS.login)
      .send({ identifier: email, password })
      .then((res) => {
        if (res.status !== 200) {
          throw new Error(`Unexpected /auth/login status ${res.status}`);
        }
      });

    // Bearer token for auth-protected routes
    const tok = await agent.get('/auth/token').expect(200);
    bearer = `Bearer ${tok.body.token}`;

    // Create chat room (allow 200 or 201)
    const roomRes = await agent
      .post(ENDPOINTS.createRoom)
      .set('Authorization', bearer)
      .send({ name: 'Room B', isGroup: false })
      .then((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(`Unexpected /chatrooms status ${res.status}`);
        }
        return res;
      });

    roomId = roomRes.body.id || roomRes.body.room?.id;
    if (!roomId) throw new Error('Room ID missing from /chatrooms response');

    // Send initial message (allow 200 or 201)
    const msgRes = await agent
      .post(ENDPOINTS.sendMessage)
      .set('Authorization', bearer)
      .send({ chatRoomId: roomId, content: 'first', kind: 'TEXT' })
      .then((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(`Unexpected /messages status ${res.status}`);
        }
        return res;
      });

    messageId = msgRes.body.id || msgRes.body.message?.id;
    if (!messageId) throw new Error('Message ID missing from /messages response');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('can edit before anyone else reads', async () => {
    // Sender edits their own message immediately:
    const editRes = await agent
      .patch(ENDPOINTS.editMessage(messageId))
      .set('Authorization', bearer)
      .send({ content: 'edited' });

    // Implementation might return 200 with body, or 204 no content.
    expect([200, 204].includes(editRes.status)).toBe(true);

    // If we *did* get a body back, and it includes rawContent, make sure it matches the new text.
    if (editRes.status === 200 && Object.prototype.hasOwnProperty.call(editRes.body, 'rawContent')) {
      expect(editRes.body.rawContent).toBe('edited');
    }
  });

  test.skip('cannot edit after someone else has read it', async () => {
    // Intent (not wired yet in test fixtures):
    // 1. User A sends message.
    // 2. User B joins same room, marks message read via PATCH /messages/:id/read.
    // 3. User A tries to edit.
    // 4. Expect 403/409 (edit locked once viewed).
    //
    // We skip because we don't yet:
    // - create user B,
    // - add B to the same chat room,
    // - call /messages/:id/read as B.
    //
    // This test is our contract: messages are only editable pre-read.
  });
});
