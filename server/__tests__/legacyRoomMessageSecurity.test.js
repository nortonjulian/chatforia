import { jest, test, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const findMember = jest.fn();
const findUser = jest.fn();
const findUniqueMessage = jest.fn();
const findFirstMessage = jest.fn();
const createMessage = jest.fn();

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  default: {
    participant: { findFirst: findMember },
    user: { findUnique: findUser },
    message: {
      findUnique: findUniqueMessage,
      findFirst: findFirstMessage,
      create: createMessage,
    },
  },
}));

await jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 7 };
    next();
  },
}));

await jest.unstable_mockModule('../routes/chatrooms.js', () => ({
  default: express.Router(),
}));

await jest.unstable_mockModule('../services/messageService.js', () => ({
  shapeMessageForUser: jest.fn(async (id) => ({ id })),
}));

await jest.unstable_mockModule('../services/socketBus.js', () => ({
  emitMessageUpsert: jest.fn(async () => {}),
}));

await jest.unstable_mockModule('../services/userBlockService.js', () => ({
  assertDirectRoomAllowed: jest.fn(async () => {}),
  assertDirectUsersAllowed: jest.fn(async () => {}),
}));

const { default: roomsRouter } =
  await import('../routes/rooms.js');

const app = express();
app.use(express.json());
app.use('/rooms', roomsRouter);
app.use((err, _req, res, _next) => {
  res.status(err?.output?.statusCode || 500).json({
    error: err?.message || 'Request failed',
  });
});

beforeEach(() => {
  jest.clearAllMocks();

  findMember.mockResolvedValue({ id: 1 });
  findUser.mockResolvedValue({ id: 7, strictE2EE: false });
  findFirstMessage.mockResolvedValue(null);

  createMessage.mockImplementation(async ({ data }) => ({
    ...data,
    id: 555,
    createdAt: new Date(),
    sender: { id: 7, username: 'test_sender' },
  }));
});

// LEGACY SECURITY REGRESSION COVERAGE

test('nonmember cannot create a legacy message', async () => {
  findMember.mockResolvedValue(null);

  const response = await request(app)
    .post('/rooms/42/messages')
    .send({ rawContent: 'Unauthorized message' });

  expect(response.status).toBe(403);
  expect(createMessage).not.toHaveBeenCalled();
});

test('reserved Group Ria invocation ID is rejected', async () => {
  const response = await request(app)
    .post('/rooms/42/messages')
    .send({
      rawContent: '@Ria hello',
      clientMessageId: 'ria-v1:abcdef1234567890',
    });

  expect(response.status).toBe(400);
  expect(createMessage).not.toHaveBeenCalled();
});

test('same client ID with different text returns 409', async () => {
  findFirstMessage.mockResolvedValue({
    id: 100,
    rawContent: 'Original message',
    contentCiphertext: '',
    isAutoReply: false,
  });

  const response = await request(app)
    .post('/rooms/42/messages')
    .send({
      rawContent: 'Different message',
      clientMessageId: 'legacy-conflict-123',
    });

  expect(response.status).toBe(409);
  expect(createMessage).not.toHaveBeenCalled();
});

test('valid replay returns original message without another insert', async () => {
  findFirstMessage.mockResolvedValue({
    id: 100,
    chatRoomId: 42,
    senderId: 7,
    rawContent: 'Original message',
    clientMessageId: 'legacy-replay-123',
    contentCiphertext: '',
    isAutoReply: false,
    sender: { id: 7, username: 'test_sender' },
    createdAt: new Date(),
  });

  const response = await request(app)
    .post('/rooms/42/messages')
    .send({
      rawContent: 'Original message',
      clientMessageId: 'legacy-replay-123',
    });

  expect(response.status).toBe(200);
  expect(response.body.message.id).toBe(100);
  expect(createMessage).not.toHaveBeenCalled();
});

test('encrypted record cannot be reused as plaintext', async () => {
  findFirstMessage.mockResolvedValue({
    id: 100,
    rawContent: 'Original message',
    contentCiphertext: { ciphertext: 'encrypted' },
    isAutoReply: false,
  });

  const response = await request(app)
    .post('/rooms/42/messages')
    .send({
      rawContent: 'Original message',
      clientMessageId: 'legacy-encrypted-123',
    });

  expect(response.status).toBe(409);
  expect(createMessage).not.toHaveBeenCalled();
});

test('Strict-E2EE sender cannot use legacy plaintext endpoint', async () => {
  findUser.mockResolvedValue({
    id: 7,
    strictE2EE: true,
  });

  const response = await request(app)
    .post('/rooms/42/messages')
    .send({ rawContent: 'Private plaintext' });

  expect(response.status).toBe(400);
  expect(createMessage).not.toHaveBeenCalled();
});

test('retry lookup uses room, sender, and client message ID', async () => {
  // A global clientMessageId-only findUnique is incompatible
  // with the actual compound-unique Prisma schema.
  findUniqueMessage.mockImplementation(() => {
    throw new Error('Unsupported global clientMessageId lookup');
  });

  const response = await request(app)
    .post('/rooms/42/messages')
    .send({
      rawContent: 'Ordinary legacy message',
      clientMessageId: 'legacy-test-123',
    });

  expect(response.status).toBe(200);

  expect(findFirstMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        chatRoomId: 42,
        senderId: 7,
        clientMessageId: 'legacy-test-123',
      },
    })
  );

  expect(findUniqueMessage).not.toHaveBeenCalled();
  expect(createMessage).toHaveBeenCalledTimes(1);
});
