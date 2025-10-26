import { makeAgent, resetDb } from './helpers/testServer.js';
import prisma from '../utils/prismaClient.js';

const ENDPOINTS = {
  register: '/auth/register',
  login: '/auth/login',
  createRoom: '/chatrooms',
  sendMessage: '/messages',
  deleteMessage: (id) => `/messages/${id}`,
};

describe('Messages: delete (sender vs admin)', () => {
  let agentUser, agentAdmin;
  let roomId, messageId;

  // Agents are just HTTP handles; safe to create once.
  beforeAll(() => {
    agentUser = makeAgent().agent;
    agentAdmin = makeAgent().agent;
  });

  //
  // IMPORTANT:
  // Our global jest.setup.js already wipes the DB in beforeEach.
  // resetDb() should ideally either be a no-op now or just sanity-reset the same DB.
  // We'll keep it in place, but if weirdness persists we can remove it.
  //
  beforeEach(async () => {
    // Ensure clean slate at the start of THIS test
    await resetDb();

    //
    // 1. Create and log in normal user
    //
    await agentUser
      .post(ENDPOINTS.register)
      .send({
        email: 'dana@example.com',
        password: 'Test12345!',
        username: 'dana',
      })
      .expect(201);

    await agentUser
      .post(ENDPOINTS.login)
      .send({ email: 'dana@example.com', password: 'Test12345!' })
      .expect(200);

    //
    // 2. Create admin user and promote to ADMIN
    //
    await agentAdmin
      .post(ENDPOINTS.register)
      .send({
        email: 'admin@example.com',
        password: 'Test12345!',
        username: 'admin',
      })
      .expect(201);

    // Force ADMIN role on that account. We use updateMany so we don't crash
    // if timing or lookup is weird. This guarantees at least one row is ADMIN.
    await prisma.user.updateMany({
      where: { email: 'admin@example.com' },
      data: { role: 'ADMIN' },
    });

    await agentAdmin
      .post(ENDPOINTS.login)
      .send({ email: 'admin@example.com', password: 'Test12345!' })
      .expect(200);

    //
    // 3. User creates a group room
    //
    const r = await agentUser
      .post(ENDPOINTS.createRoom)
      .send({ name: 'Room C', isGroup: true })
      .expect(201);

    roomId = r.body.id || r.body.room?.id;

    //
    // 4. User sends an initial message into that room; stash its id
    //
    const m = await agentUser
      .post(ENDPOINTS.sendMessage)
      .send({
        chatRoomId: roomId,
        content: 'to delete',
        kind: 'TEXT',
      })
      .expect(201);

    messageId = m.body.id || m.body.message?.id;
  });

  test('sender can delete own message', async () => {
    await agentUser
      .delete(ENDPOINTS.deleteMessage(messageId))
      .expect(200);
  });

  test('admin can delete any message', async () => {
    // Create a new message as the normal user
    const m = await agentUser
      .post(ENDPOINTS.sendMessage)
      .send({
        chatRoomId: roomId,
        content: 'admin will delete',
        kind: 'TEXT',
      })
      .expect(201);

    const id = m.body.id || m.body.message?.id;

    // Admin should be able to delete it
    await agentAdmin
      .delete(ENDPOINTS.deleteMessage(id))
      .expect(200);
  });
});
