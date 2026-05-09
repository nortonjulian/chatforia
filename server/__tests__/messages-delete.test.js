import { makeAgent, resetDb } from './helpers/testServer.js';
import prisma from '../utils/prismaClient.js';

const ENDPOINTS = {
  register: '/auth/register',
  login: '/auth/login',
  sendMessage: '/messages',
  deleteMessage: (id) => `/messages/${id}`,
  createRoom: '/rooms',
};

describe('Messages: delete (sender vs admin)', () => {
  let agentUser;
  let agentAdmin;

  let roomId;
  let messageId;

  let danaId;
  let adminId;

  beforeAll(() => {
    agentUser = makeAgent().agent;
    agentAdmin = makeAgent().agent;
  });

  beforeEach(async () => {
    await resetDb();

    // ---- USER ----
    await agentUser
      .post(ENDPOINTS.register)
      .send({
        email: 'dana@example.com',
        password: 'Test12345!',
        username: 'dana',
      })
      .expect(201);

    await prisma.user.updateMany({
      where: { email: 'dana@example.com' },
      data: {
        emailVerifiedAt: new Date(),
      },
    });

    const dana = await prisma.user.findUnique({
      where: { email: 'dana@example.com' },
      select: { id: true },
    });

    danaId = dana.id;

    await agentUser
      .post(ENDPOINTS.login)
      .send({
        email: 'dana@example.com',
        password: 'Test12345!',
      })
      .expect(200);

    // ---- ADMIN ----
    await agentAdmin
      .post(ENDPOINTS.register)
      .send({
        email: 'admin@example.com',
        password: 'Test12345!',
        username: 'admin',
      })
      .expect(201);

    await prisma.user.updateMany({
      where: { email: 'admin@example.com' },
      data: {
        role: 'ADMIN',
        emailVerifiedAt: new Date(),
      },
    });

    const admin = await prisma.user.findUnique({
      where: { email: 'admin@example.com' },
      select: { id: true },
    });

    adminId = admin.id;

    await agentAdmin
      .post(ENDPOINTS.login)
      .send({
        email: 'admin@example.com',
        password: 'Test12345!',
      })
      .expect(200);

    // ---- CREATE ROOM USING TEST ROUTE ----
    const roomRes = await agentUser
      .post(ENDPOINTS.createRoom)
      .send({
        name: 'Room C',
        isGroup: true,
      });

    if (![200, 201].includes(roomRes.status)) {
      throw new Error(
        `Unexpected /rooms status ${roomRes.status} ${JSON.stringify(roomRes.body)}`
      );
    }

    roomId = roomRes.body.id || roomRes.body.room?.id;

    if (!roomId) {
      throw new Error('Room ID missing');
    }

    // ---- ADD PARTICIPANTS ----
    await agentUser
      .post(`/rooms/${roomId}/participants`)
      .send({ userId: danaId })
      .expect((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(
            `Failed adding sender participant: ${res.status}`
          );
        }
      });

    await agentUser
      .post(`/rooms/${roomId}/participants`)
      .send({ userId: adminId })
      .expect((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(
            `Failed adding admin participant: ${res.status}`
          );
        }
      });

    // ---- CREATE INITIAL MESSAGE ----
    const m = await agentUser
      .post(ENDPOINTS.sendMessage)
      .send({
        chatRoomId: roomId,
        content: 'to delete',
        kind: 'TEXT',
      });

    if (![200, 201].includes(m.status)) {
      throw new Error(
        `Unexpected /messages status ${m.status} ${JSON.stringify(m.body)}`
      );
    }

    messageId = m.body.message?.id || m.body.id;

    if (!messageId) {
      throw new Error(
        `Message ID missing from response: ${JSON.stringify(m.body)}`
      );
    }
  });

  test('sender can delete own message', async () => {
    await agentUser
      .delete(ENDPOINTS.deleteMessage(messageId))
      .expect(200);
  });

  test('admin can delete any message', async () => {
    const m = await agentUser
      .post(ENDPOINTS.sendMessage)
      .send({
        chatRoomId: roomId,
        content: 'admin will delete',
        kind: 'TEXT',
      });

    if (![200, 201].includes(m.status)) {
      throw new Error(
        `Unexpected /messages status ${m.status} ${JSON.stringify(m.body)}`
      );
    }

    const id = m.body.message?.id || m.body.id;

    if (!id) {
      throw new Error(
        `Message ID missing from response: ${JSON.stringify(m.body)}`
      );
    }

    await agentAdmin
      .delete(ENDPOINTS.deleteMessage(id))
      .expect(200);
  });
});