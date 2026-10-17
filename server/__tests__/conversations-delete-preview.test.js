import request from 'supertest';
import { makeAgent, resetDb } from './helpers/testServer.js';
import prisma from '../utils/prismaClient.js';

const app = makeAgent().app;

const ENDPOINTS = {
  register: '/auth/register',
  createRoom: '/rooms',
  sendMessage: '/messages',
  conversations: '/conversations',
  deleteMessage: (id, scope) =>
    `/messages/${id}${scope ? `?scope=${scope}` : ''}`,
};

function asUser(testRequest, userId) {
  return testRequest.set('x-test-user-id', String(userId));
}

describe('Conversations: deleted-message preview fallback', () => {
  let senderId;
  let recipientId;
  let roomId;

  async function registerUser({
    email,
    username,
    password = 'Test12345!',
  }) {
    await request(app)
      .post(ENDPOINTS.register)
      .send({
        email,
        password,
        username,
      })
      .expect(201);

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) {
      throw new Error(`Registered user not found: ${email}`);
    }

    return user.id;
  }

  async function sendMessage(content) {
    const response = await asUser(
      request(app).post(ENDPOINTS.sendMessage),
      senderId
    ).send({
      chatRoomId: roomId,
      content,
      kind: 'TEXT',
    });

    if (![200, 201].includes(response.status)) {
      throw new Error(
        `Unexpected /messages status ${response.status} ${JSON.stringify(response.body)}`
      );
    }

    const id =
      response.body.message?.id ||
      response.body.id;

    if (!id) {
      throw new Error(
        `Message ID missing from response: ${JSON.stringify(response.body)}`
      );
    }

    return id;
  }

  async function conversationFor(userId) {
    const response = await asUser(
      request(app).get(ENDPOINTS.conversations),
      userId
    ).expect(200);

    const conversations =
      response.body.conversations ||
      response.body.items ||
      [];

    return conversations.find(
      (conversation) =>
        conversation.kind === 'chat' &&
        Number(conversation.id) === Number(roomId)
    );
  }

  beforeEach(async () => {
    await resetDb();

    senderId = await registerUser({
      email: 'preview-sender@example.com',
      username: 'preview_sender',
    });

    recipientId = await registerUser({
      email: 'preview-recipient@example.com',
      username: 'preview_recipient',
    });

    expect(senderId).not.toBe(recipientId);

    const roomResponse = await asUser(
      request(app).post(ENDPOINTS.createRoom),
      senderId
    ).send({
      name: 'Preview Test Room',
      isGroup: true,
    });

    if (![200, 201].includes(roomResponse.status)) {
      throw new Error(
        `Unexpected /rooms status ${roomResponse.status} ${JSON.stringify(roomResponse.body)}`
      );
    }

    roomId =
      roomResponse.body.id ||
      roomResponse.body.room?.id;

    if (!roomId) {
      throw new Error('Room ID missing');
    }

    await asUser(
      request(app).post(`/rooms/${roomId}/participants`),
      senderId
    )
      .send({ userId: senderId })
      .expect((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(`Failed adding sender: ${res.status}`);
        }
      });

    await asUser(
      request(app).post(`/rooms/${roomId}/participants`),
      senderId
    )
      .send({ userId: recipientId })
      .expect((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(`Failed adding recipient: ${res.status}`);
        }
      });
  });

  test('delete for everyone falls back to previous visible message', async () => {
    const previousId =
      await sendMessage('previous visible message');

    const latestId =
      await sendMessage('latest message');

    const before =
      await conversationFor(senderId);

    expect(before?.last?.messageId).toBe(latestId);
    expect(before?.last?.text).toBe('latest message');

    await asUser(
      request(app).delete(
        ENDPOINTS.deleteMessage(latestId, 'all')
      ),
      senderId
    ).expect(200);

    const after =
      await conversationFor(senderId);

    expect(after?.last?.messageId).toBe(previousId);
    expect(after?.last?.text).toBe('previous visible message');
    expect(after?.last?.text).not.toBe('(deleted)');
  });

  test('delete for me falls back only for the deleting user', async () => {
    const previousId =
      await sendMessage('previous visible message');

    const latestId =
      await sendMessage('sender-only deleted message');

    await asUser(
      request(app).delete(
        ENDPOINTS.deleteMessage(latestId, 'me')
      ),
      senderId
    ).expect(200);

    const senderConversation =
      await conversationFor(senderId);

    expect(senderConversation?.last?.messageId)
      .toBe(previousId);

    expect(senderConversation?.last?.text)
      .toBe('previous visible message');

    const recipientConversation =
      await conversationFor(recipientId);

    expect(recipientConversation?.last?.messageId)
      .toBe(latestId);

    expect(recipientConversation?.last?.text)
      .toBe('sender-only deleted message');
  });

  test('legacy deletedBySender hides message only from its sender', async () => {
    const previousId =
      await sendMessage('previous visible message');

    const latestId =
      await sendMessage('legacy sender-deleted message');

    await prisma.message.update({
      where: { id: latestId },
      data: {
        deletedBySender: true,
      },
    });

    const senderConversation =
      await conversationFor(senderId);

    expect(senderConversation?.last?.messageId)
      .toBe(previousId);

    expect(senderConversation?.last?.text)
      .toBe('previous visible message');

    const recipientConversation =
      await conversationFor(recipientId);

    expect(recipientConversation?.last?.messageId)
      .toBe(latestId);

    expect(recipientConversation?.last?.text)
      .toBe('legacy sender-deleted message');
  });

  test('empty SMS threads disappear and return when a new MMS arrives', async () => {
    const thread = await prisma.smsThread.create({
      data: {
        userId: senderId,
        contactPhone: '+12025550101',
      },
    });

    const otherThread = await prisma.smsThread.create({
      data: {
        userId: recipientId,
        contactPhone: '+12025550102',
      },
    });

    async function addMessage(threadId, overrides = {}) {
      return prisma.smsMessage.create({
        data: {
          threadId,
          direction: 'in',
          fromNumber: '+12025550101',
          toNumber: '+12025550103',
          body: 'SMS test message',
          ...overrides,
        },
      });
    }

    async function smsConversationIDs(userId) {
      const response = await asUser(
        request(app).get(ENDPOINTS.conversations),
        userId
      ).expect(200);

      return (response.body.items || response.body.conversations || [])
        .filter(item => item.kind === 'sms')
        .map(item => Number(item.id));
    }

    await addMessage(otherThread.id);

    // Empty threads stay out of the list.
    expect(await smsConversationIDs(senderId)).not.toContain(thread.id);

    const first = await addMessage(thread.id);
    const second = await addMessage(thread.id);

    expect(await smsConversationIDs(senderId)).toContain(thread.id);

    // Deleting one message preserves a thread with another message.
    await asUser(
      request(app).delete(`/sms/messages/${first.id}`),
      senderId
    ).expect(200);

    expect(await smsConversationIDs(senderId)).toContain(thread.id);

    // Deleting the final message hides the thread without deleting its record.
    await asUser(
      request(app).delete(`/sms/messages/${second.id}`),
      senderId
    ).expect(200);

    expect(await smsConversationIDs(senderId)).not.toContain(thread.id);
    expect(await prisma.smsThread.findUnique({
      where: { id: thread.id },
    })).not.toBeNull();

    // A new attachment-only message makes the thread visible again.
    await addMessage(thread.id, {
      body: '',
      mediaUrls: ['https://example.com/photo.jpg'],
    });

    expect(await smsConversationIDs(senderId)).toContain(thread.id);

    // Each account sees only its own SMS threads.
    expect(await smsConversationIDs(senderId)).not.toContain(otherThread.id);
    expect(await smsConversationIDs(recipientId)).toContain(otherThread.id);
    expect(await smsConversationIDs(recipientId)).not.toContain(thread.id);
  });

});
