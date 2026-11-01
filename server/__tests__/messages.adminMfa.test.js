/** @jest-environment node */
import { jest, beforeEach, test, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const db = {
  message: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  participant: {
    findFirst: jest.fn(),
  },
  messageKey: {
    deleteMany: jest.fn(),
  },
  messagePayload: {
    deleteMany: jest.fn(),
  },
};

let identity = {
  id: 20,
  role: 'ADMIN',
  twoFactorEnabled: true,
  mfaVerified: false,
};

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  default: db,
}));

await jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.user = {
      id: identity.id,
      role: identity.role,
      twoFactorEnabled: identity.twoFactorEnabled,
    };
    req.auth = { mfaVerified: identity.mfaVerified };
    next();
  },
}));

await jest.unstable_mockModule('../middleware/uploads.js', () => ({
  uploadMedia: {
    array: () => (_req, _res, next) => next(),
  },
  uploadDirs: { ROOT: '/tmp/chatforia-admin-mfa-http' },
}));

await jest.unstable_mockModule('../services/socketBus.js', () => ({
  getIo: () => null,
  emitMessageUpsert: jest.fn(async () => {}),
  emitMessageUpsertToUser: jest.fn(),
  emitMessageAck: jest.fn(),
  emitToUser: jest.fn(),
}));

await jest.unstable_mockModule('../services/messageService.js', () => ({
  createMessageService: jest.fn(),
  shapeMessageForUser: jest.fn(),
}));

await jest.unstable_mockModule('../services/userBlockService.js', () => ({
  assertDirectRoomAllowed: jest.fn(),
  assertDirectUsersAllowed: jest.fn(),
  isBlockedEitherWay: jest.fn(),
}));

await jest.unstable_mockModule('../services/translation/translateMessage.js', () => ({
  maybeTranslateForTarget: jest.fn(),
}));

await jest.unstable_mockModule('../services/pushService.js', () => ({
  sendPushToUser: jest.fn(),
}));

await jest.unstable_mockModule('../services/badgeSync.js', () => ({
  syncBadgeToUserDevices: jest.fn(),
}));

await jest.unstable_mockModule('../services/readReceiptService.js', () => ({
  recordMessageReads: jest.fn(),
}));

const originalEnv = process.env.NODE_ENV;
let messagesRouter;

try {
  process.env.NODE_ENV = 'admin-mfa-http-qa';
  messagesRouter = (await import('../routes/messages.js')).default;
} finally {
  process.env.NODE_ENV = originalEnv;
}

const app = express();
app.use(express.json());
app.use('/messages', messagesRouter);

app.use((error, _req, res, _next) => {
  res.status(error?.output?.statusCode || 500).json({
    error: error?.message || 'Request failed',
  });
});

beforeEach(() => {
  jest.clearAllMocks();

  identity = {
    id: 20,
    role: 'ADMIN',
    twoFactorEnabled: true,
    mfaVerified: false,
  };

  db.message.findUnique.mockResolvedValue({
    id: 100,
    chatRoomId: 50,
    senderId: 10,
    deletedForAll: false,
    createdAt: new Date(),
  });

  db.participant.findFirst.mockResolvedValue(null);
  db.message.update.mockResolvedValue({});
  db.messageKey.deleteMany.mockResolvedValue({ count: 0 });
  db.messagePayload.deleteMany.mockResolvedValue({ count: 0 });
});

const deleteForEveryone = () =>
  request(app).delete('/messages/100?scope=all');

test('unverified global admin cannot delete another user message', async () => {
  const res = await deleteForEveryone();

  expect(res.status).toBe(403);
  expect(db.message.update).not.toHaveBeenCalled();
  expect(db.messageKey.deleteMany).not.toHaveBeenCalled();
  expect(db.messagePayload.deleteMany).not.toHaveBeenCalled();
});

test('verified global admin can delete another user message', async () => {
  identity.mfaVerified = true;

  const res = await deleteForEveryone();

  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    success: true,
    scope: 'all',
  });
  expect(db.message.update).toHaveBeenCalledTimes(1);
});

test('ordinary sender retains delete-for-everyone permission', async () => {
  identity = {
    id: 10,
    role: 'USER',
    twoFactorEnabled: false,
    mfaVerified: false,
  };

  db.participant.findFirst.mockResolvedValue({ id: 1 });

  const res = await deleteForEveryone();

  expect(res.status).toBe(200);
  expect(db.message.update).toHaveBeenCalledTimes(1);
});

test('ordinary member cannot delete another user message for everyone', async () => {
  identity = {
    id: 30,
    role: 'USER',
    twoFactorEnabled: false,
    mfaVerified: false,
  };

  db.participant.findFirst.mockResolvedValue({ id: 2 });

  const res = await deleteForEveryone();

  expect(res.status).toBe(403);
  expect(db.message.update).not.toHaveBeenCalled();
});
