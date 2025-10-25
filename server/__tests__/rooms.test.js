/**
 * @jest-environment node
 */
import request from 'supertest';
import prisma from '../utils/prismaClient.js';
import app from '../app.js';

const ENDPOINTS = {
  register: '/auth/register',
  login: '/auth/login',
  me: '/auth/me',

  // rooms.js creates rooms under /rooms in non-prod
  createRoom: '/rooms',

  // rooms.js also mounts invite/join/leave under the SAME router,
  // so they are actually /rooms/group-invites/... etc.
  createInvite: (roomId) => `/rooms/group-invites/${roomId}`,
  joinWithCode: (code) => `/rooms/group-invites/${code}/join`,
  leaveRoom: (roomId) => `/rooms/chatrooms/${roomId}/leave`,

  // promote handler is also inside rooms.js, but we added an alias
  // /chatrooms/:id/participants/:userId/promote so we can keep this one:
  promote: (roomId, userId) => `/chatrooms/${roomId}/participants/${userId}/promote`,
};

describe('Rooms: create/join/leave and permissions', () => {
  let ownerAgent;
  let memberAgent;
  let roomId;
  let ownerId;
  let memberId;

  beforeEach(async () => {
    // clean DB
    try { await prisma.participant.deleteMany({}); } catch {}
    try { await prisma.chatRoom.deleteMany({}); } catch {}
    try { await prisma.user.deleteMany({}); } catch {}

    ownerAgent = request.agent(app);
    memberAgent = request.agent(app);

    // --- owner registration/login ---
    const ownerEmail = `owner_${Date.now()}@example.com`;
    const ownerPass = 'Test12345!';
    const ownerUsername = 'owner';

    await ownerAgent
      .post(ENDPOINTS.register)
      .send({ email: ownerEmail, password: ownerPass, username: ownerUsername })
      .then((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(`Unexpected /auth/register (owner) ${res.status}`);
        }
      });

    await ownerAgent
      .post(ENDPOINTS.login)
      .send({ identifier: ownerEmail, password: ownerPass })
      .then((res) => {
        if (res.status !== 200) {
          throw new Error(`Unexpected /auth/login (owner) ${res.status}`);
        }
      });

    // grab ownerId
    const ownerMe = await ownerAgent.get(ENDPOINTS.me).expect(200);
    ownerId = ownerMe.body?.user?.id;
    if (!ownerId) throw new Error('ownerId missing');
    expect(ownerId).toBeDefined();

    // --- member registration/login ---
    const memberEmail = `eve_${Date.now()}@example.com`;
    const memberPass = 'Test12345!';
    const memberUsername = 'eve';

    await memberAgent
      .post(ENDPOINTS.register)
      .send({ email: memberEmail, password: memberPass, username: memberUsername })
      .then((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(`Unexpected /auth/register (member) ${res.status}`);
        }
      });

    await memberAgent
      .post(ENDPOINTS.login)
      .send({ identifier: memberEmail, password: memberPass })
      .then((res) => {
        if (res.status !== 200) {
          throw new Error(`Unexpected /auth/login (member) ${res.status}`);
        }
      });

    const memberMe = await memberAgent.get(ENDPOINTS.me).expect(200);
    memberId = memberMe.body?.user?.id;
    if (!memberId) throw new Error('memberId missing');
    expect(memberId).toBeDefined();

    // --- owner creates room ---
    const createRes = await ownerAgent
      .post(ENDPOINTS.createRoom)
      .send({ name: 'Room D', isGroup: true })
      .then((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(`Unexpected create room status ${res.status}`);
        }
        return res;
      });

    roomId = createRes.body.id || createRes.body.room?.id;
    if (!roomId) throw new Error('roomId missing from create room response');
    expect(roomId).toBeDefined();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('owner can promote to admin', async () => {
    // Ensure member is actually in participants before promotion.
    const memberIdNum =
      typeof memberId === 'string' && /^\d+$/.test(memberId) ? Number(memberId) : memberId;

    await prisma.participant
      .upsert({
        where: { chatRoomId_userId: { chatRoomId: roomId, userId: memberIdNum } },
        update: { role: 'MEMBER' },
        create: { chatRoomId: roomId, userId: memberIdNum, role: 'MEMBER' },
      })
      .catch(async () => {
        // fallback for schema using (userId, chatRoomId)
        await prisma.participant.upsert({
          where: { userId_chatRoomId: { userId: memberIdNum, chatRoomId: roomId } },
          update: { role: 'MEMBER' },
          create: { chatRoomId: roomId, userId: memberIdNum, role: 'MEMBER' },
        });
      });

    // Owner promotes MEMBER to ADMIN
    await ownerAgent.post(ENDPOINTS.promote(roomId, memberId)).expect(200);

    // Verify in DB
    const after =
      (await prisma.participant
        .findUnique({
          where: { chatRoomId_userId: { chatRoomId: roomId, userId: memberIdNum } },
          select: { role: true },
        })
        .catch(async () => {
          return prisma.participant.findUnique({
            where: { userId_chatRoomId: { userId: memberIdNum, chatRoomId: roomId } },
            select: { role: true },
          });
        })) || null;

    expect(after?.role).toBe('ADMIN');
  });

  test('invite code join / leave', async () => {
    // owner creates invite
    const invite = await ownerAgent.post(ENDPOINTS.createInvite(roomId)).expect(201);
    const code = invite.body.code;
    expect(code).toBeDefined();

    // member joins using that code
    await memberAgent.post(ENDPOINTS.joinWithCode(code)).expect(200);

    // member leaves the room
    await memberAgent.post(ENDPOINTS.leaveRoom(roomId)).expect(200);
  });
});
