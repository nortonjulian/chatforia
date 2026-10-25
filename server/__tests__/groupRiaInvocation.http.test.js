import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const validMembers = () => [
  {
    userId: 10, allowAIBot: true,
    riaGroupConsentedAt: new Date(),
    user: { strictE2EE: false },
  },
  {
    userId: 11, allowAIBot: true,
    riaGroupConsentedAt: new Date(),
    user: { strictE2EE: false },
  },
  {
    userId: 99, allowAIBot: false,
    riaGroupConsentedAt: null,
    user: { strictE2EE: false },
  },
];

const sendPush = jest.fn(async () => ({ ok: true }));
const invokeRia = jest.fn(async () => {});
const emitUserUpsert = jest.fn();

const db = {
  chatRoom: {
    findUnique: jest.fn(),
  },
  message: {
    findFirst: jest.fn(),
  },
  participant: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
};

const createMessage = jest.fn();
const shapeMessage = jest.fn();

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  default: db,
}));

await jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 10, role: 'MEMBER' };
    next();
  },
}));

await jest.unstable_mockModule('../middleware/uploads.js', () => ({
  uploadMedia: {
    array: () => (_req, _res, next) => next(),
  },
  uploadDirs: { ROOT: '/tmp/group-ria-contract-http' },
}));

await jest.unstable_mockModule('../services/messageService.js', () => ({
  createMessageService: createMessage,
  shapeMessageForUser: shapeMessage,
}));

await jest.unstable_mockModule('../services/userBlockService.js', () => ({
  assertDirectRoomAllowed: jest.fn(async () => {}),
  assertDirectUsersAllowed: jest.fn(async () => {}),
  isBlockedEitherWay: jest.fn(async () => false),
}));

await jest.unstable_mockModule('../services/translation/translateMessage.js', () => ({
  maybeTranslateForTarget: jest.fn(async () => null),
}));

await jest.unstable_mockModule('../services/pushService.js', () => ({
  sendPushToUser: sendPush,
}));

await jest.unstable_mockModule('../services/badgeSync.js', () => ({
  syncBadgeToUserDevices: jest.fn(async () => {}),
}));

await jest.unstable_mockModule('../services/readReceiptService.js', () => ({
  recordMessageReads: jest.fn(async () => {}),
}));

await jest.unstable_mockModule('../services/socketBus.js', () => ({
  getIo: () => null,
  emitMessageUpsert: jest.fn(),
  emitMessageUpsertToUser: emitUserUpsert,
  emitMessageAck: jest.fn(),
  emitToUser: jest.fn(),
}));

await jest.unstable_mockModule('../services/botAssistant.js', () => ({
  maybeInvokeForiaBot: invokeRia,
}));

// Exercise the production dispatch condition while keeping all
// external dependencies mocked and the feature local to this test.
const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'ria-http-dispatch-local-qa';
let messagesRouter;
try {
  messagesRouter = (await import('../routes/messages.js')).default;
} finally {
  process.env.NODE_ENV = originalNodeEnv;
}

const app = express();
app.use(express.json());
app.use('/messages', messagesRouter);
app.use((err, _req, res, _next) => {
  res.status(500).json({ error: err?.code || 'HTTP_TEST_ERROR' });
});

const validBody = () => ({
  chatRoomId: 42,
  clientMessageId: 'ria-v1:abcdef1234567890',
  content: '@Ria hello',
  riaInvocation: {
    version: 1,
    acknowledgePlaintext: true,
  },
});

beforeEach(() => {
  jest.clearAllMocks();

  process.env.GROUP_RIA_ENABLED = 'true';
  process.env.FORIA_BOT_USER_ID = '99';
  process.env.OPENAI_API_KEY = 'mock-key-never-used';

  db.chatRoom.findUnique.mockResolvedValue({
    isGroup: true,
    allowForiaBot: true,
    aiAssistantMode: 'MENTION',
    participants: validMembers(),
  });

  db.message.findFirst.mockResolvedValue(null);
  db.participant.findFirst.mockResolvedValue({ id: 1 });
  db.participant.findMany.mockResolvedValue([]);
  db.participant.updateMany.mockResolvedValue({ count: 3 });
  db.user.findUnique.mockResolvedValue({
    username: 'ria_http_qa',
    strictE2EE: false,
  });

  createMessage.mockImplementation(async (params) => ({
    id: 500,
    chatRoomId: params.chatRoomId,
    senderId: params.senderId,
    clientMessageId: params.clientMessageId,
    rawContent: params.content,
    createdAt: new Date(),
  }));

  shapeMessage.mockResolvedValue({
    id: 500,
    chatRoomId: 42,
    senderId: 10,
    rawContent: '@Ria hello',
  });
});

describe('Group Ria actual HTTP authorization', () => {
  test('feature OFF rejects before DB access or persistence', async () => {
    process.env.GROUP_RIA_ENABLED = 'false';

    const res = await request(app)
      .post('/messages')
      .send(validBody());

    expect(res.status).toBe(404);
    expect(db.chatRoom.findUnique).not.toHaveBeenCalled();
    expect(createMessage).not.toHaveBeenCalled();
  });

  test('missing acknowledgment rejects before persistence', async () => {
    const body = validBody();
    body.riaInvocation.acknowledgePlaintext = false;

    const res = await request(app)
      .post('/messages')
      .send(body);

    expect(res.status).toBe(400);
    expect(createMessage).not.toHaveBeenCalled();
  });

  test('mixed plaintext and encrypted data is rejected', async () => {
    const res = await request(app)
      .post('/messages')
      .send({
        ...validBody(),
        encryptedPayloads: {},
      });

    expect(res.status).toBe(400);
    expect(createMessage).not.toHaveBeenCalled();
  });

  test('reserved Ria client ID without intent is rejected', async () => {
    const body = validBody();
    delete body.riaInvocation;

    const res = await request(app)
      .post('/messages')
      .send(body);

    expect(res.status).toBe(400);
    expect(createMessage).not.toHaveBeenCalled();
  });

  test('revoked consent rejects before persistence', async () => {
    const members = validMembers();
    members[0].riaGroupConsentedAt = null;

    db.chatRoom.findUnique.mockResolvedValue({
      isGroup: true,
      allowForiaBot: true,
      aiAssistantMode: 'MENTION',
      participants: members,
    });

    const res = await request(app)
      .post('/messages')
      .send(validBody());

    expect(res.status).toBe(403);
    expect(createMessage).not.toHaveBeenCalled();
  });

  test('Strict-E2EE group rejects before persistence', async () => {
    const members = validMembers();
    members[1].user.strictE2EE = true;

    db.chatRoom.findUnique.mockResolvedValue({
      isGroup: true,
      allowForiaBot: true,
      aiAssistantMode: 'MENTION',
      participants: members,
    });

    const res = await request(app)
      .post('/messages')
      .send(validBody());

    expect(res.status).toBe(403);
    expect(createMessage).not.toHaveBeenCalled();
  });

  // CONSENT REVOCATION RACE REGRESSION
  test('rejects if consent changes after preflight but before persistence', async () => {
    const participants = validMembers();

    db.chatRoom.findUnique.mockImplementation(async () => ({
      isGroup: true,
      allowForiaBot: true,
      aiAssistantMode: 'MENTION',
      participants,
    }));

    // The ordinary message route checks membership after the
    // initial Ria authorization. Simulate consent changing there.
    db.participant.findFirst.mockImplementation(async () => {
      participants[0].allowAIBot = false;
      participants[0].riaGroupConsentedAt = null;
      return { id: 1 };
    });

    const res = await request(app)
      .post('/messages')
      .send(validBody());

    expect(res.status).toBe(403);
    expect(createMessage).not.toHaveBeenCalled();
  });

  // RETRY SIDE EFFECT REGRESSION
  test('valid retry does not repeat push or socket upserts', async () => {
    db.participant.findMany.mockResolvedValue([
      { userId: 10 },
      { userId: 11 },
    ]);

    let attempts = 0;

    createMessage.mockImplementation(async (params) => ({
      id: 500,
      chatRoomId: params.chatRoomId,
      senderId: params.senderId,
      clientMessageId: params.clientMessageId,
      rawContent: params.content,
      createdAt: new Date(),
      groupRiaWasRetry: attempts++ > 0,
    }));

    const first = await request(app)
      .post('/messages')
      .send(validBody());

    expect(first.status).toBe(201);
    expect(invokeRia).toHaveBeenCalledTimes(1);
    expect(sendPush).toHaveBeenCalledTimes(1);
    // Explicit AI plaintext must not be copied into push previews.
    expect(sendPush.mock.calls[0][1].alert.body).toBe('New message');
    expect(emitUserUpsert).toHaveBeenCalledTimes(2);

    sendPush.mockClear();
    emitUserUpsert.mockClear();

    const retry = await request(app)
      .post('/messages')
      .send(validBody());

    expect(retry.status).toBe(201);
    expect(retry.body.message.id).toBe(first.body.message.id);

    expect(createMessage).toHaveBeenCalledTimes(2);
    expect(sendPush).not.toHaveBeenCalled();
    expect(emitUserUpsert).not.toHaveBeenCalled();
    // Retrying must not dispatch the AI invocation again.
    expect(invokeRia).toHaveBeenCalledTimes(1);
  });

  test('same invocation ID with different plaintext returns 409', async () => {
    db.message.findFirst.mockResolvedValue({
      rawContent: '@Ria different message',
      contentCiphertext: null,
      keys: [],
      payloads: [],
    });

    const res = await request(app)
      .post('/messages')
      .send(validBody());

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('RIA_IDEMPOTENCY_CONFLICT');
    expect(createMessage).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
    expect(emitUserUpsert).not.toHaveBeenCalled();
  });

  // RIA SOCKET FAILURE REGRESSION
  test('socket delivery failure does not suppress Ria dispatch', async () => {
    db.participant.findMany.mockResolvedValue([
      { userId: 10 },
      { userId: 11 },
    ]);

    emitUserUpsert.mockRejectedValueOnce(
      new Error('Simulated QA socket delivery failure')
    );

    const response = await request(app)
      .post('/messages')
      .send(validBody());

    // Socket delivery currently fails the HTTP response.
    expect(response.status).toBe(500);

    // The source message was already persisted.
    expect(createMessage).toHaveBeenCalledTimes(1);

    // Ria must still be dispatched exactly once.
    expect(invokeRia).toHaveBeenCalledTimes(1);
  });

  test('valid explicit invocation reaches message persistence', async () => {
    const res = await request(app)
      .post('/messages')
      .send(validBody());

    expect(res.status).toBe(201);
    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        senderId: 10,
        chatRoomId: 42,
        content: '@Ria hello',
      })
    );
  });
});
