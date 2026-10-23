import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const mockPrisma = {
  user: { findUnique: jest.fn() },
  userBlock: { findFirst: jest.fn() },
  call: { create: jest.fn() },
};
const emitToUser = jest.fn();
const sendVoipCallPushToUser = jest.fn();
const sendPushToUser = jest.fn();

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({ default: mockPrisma }));
await jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 10, username: 'caller' };
    next();
  },
}));
await jest.unstable_mockModule('../routes/videoCaptions.js', () => ({
  default: express.Router(),
}));
await jest.unstable_mockModule('../services/socketBus.js', () => ({ emitToUser }));
await jest.unstable_mockModule('../services/pushService.js', () => ({
  sendVoipCallPushToUser,
  sendPushToUser,
}));

const { default: router } = await import('../routes/video.js');
function app() {
  const server = express();
  server.use(express.json());
  server.use('/video', router);
  server.use('/api/video', router);
  server.use((err, _req, res, _next) =>
    res.status(err?.output?.statusCode || err?.statusCode || 500)
      .json({ error: err.message })
  );
  return server;
}

beforeEach(() => {
  jest.resetAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue({
    id: 20, username: 'callee', displayName: 'Callee',
  });
  mockPrisma.userBlock.findFirst.mockResolvedValue(null);
  mockPrisma.call.create.mockResolvedValue({
    id: 42, callerId: 10, calleeId: 20, roomId: null,
    createdAt: new Date('2026-10-23T00:00:00Z'),
  });
  sendVoipCallPushToUser.mockResolvedValue(undefined);
  sendPushToUser.mockResolvedValue(undefined);
});

test('video /start rejects a blocked pair without creating or notifying', async () => {
  mockPrisma.userBlock.findFirst.mockResolvedValueOnce({ id: 7 });
  const res = await request(app()).post('/video/start').send({ calleeId: 20 });
  expect(res.statusCode).toBe(403);
  expect(mockPrisma.userBlock.findFirst).toHaveBeenCalledWith({
    where: { OR: [
      { blockerId: 10, blockedId: 20 },
      { blockerId: 20, blockedId: 10 },
    ] },
    select: { id: true },
  });
  expect(mockPrisma.call.create).not.toHaveBeenCalled();
  expect(emitToUser).not.toHaveBeenCalled();
  expect(sendVoipCallPushToUser).not.toHaveBeenCalled();
  expect(sendPushToUser).not.toHaveBeenCalled();
});

test('video /start preserves existing call behavior for unblocked users', async () => {
  const res = await request(app()).post('/video/start').send({ calleeId: 20 });
  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({ ok: true, callId: 42, roomName: 'call_42' });
  expect(mockPrisma.call.create).toHaveBeenCalledTimes(1);
  expect(emitToUser).toHaveBeenCalledWith(20, 'video:incoming', expect.any(Object));
});

test('alternate /api/video mount rejects the same blocked pair', async () => {
  mockPrisma.userBlock.findFirst.mockResolvedValueOnce({ id: 8 });
  const res = await request(app()).post('/api/video/start').send({ calleeId: 20 });
  expect(res.statusCode).toBe(403);
  expect(mockPrisma.call.create).not.toHaveBeenCalled();
});
