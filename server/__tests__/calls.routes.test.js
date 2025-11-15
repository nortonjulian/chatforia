/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// ---------- Mocks ----------

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
  call: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  default: mockPrisma,
}));

const emitToUserMock = jest.fn();
await jest.unstable_mockModule('../services/socketBus.js', () => ({
  emitToUser: emitToUserMock,
}));

// requireAuth middleware: always attach an authenticated user
await jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 10, username: 'caller', role: 'USER' };
    next();
  },
}));

// Import router AFTER mocks
const callsModule = await import('../routes/calls.js');
const callsRouter = callsModule.default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/calls', callsRouter);
  return app;
}

describe('calls routes', () => {
  let app;

  beforeEach(() => {
    app = makeApp();
    jest.clearAllMocks();
  });

  // =============================
  // POST /calls/invite
  // =============================
  describe('POST /calls/invite', () => {
    test('400 when calleeId or offer.sdp missing', async () => {
      let res = await request(app).post('/calls/invite').send({});
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'calleeId and offer.sdp required' });

      res = await request(app)
        .post('/calls/invite')
        .send({ calleeId: 20, offer: {} });
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'calleeId and offer.sdp required' });
    });

    test('404 when callee not found', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({
          id: 10,
          username: 'caller',
          name: 'Caller',
          avatarUrl: null,
        }) // caller
        .mockResolvedValueOnce(null); // callee

      const res = await request(app)
        .post('/calls/invite')
        .send({
          calleeId: 20,
          mode: 'AUDIO',
          offer: { type: 'offer', sdp: 'fake-sdp' },
        });

      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'Callee not found' });
    });

    test('201 and emits call:incoming on success', async () => {
      const now = new Date('2025-01-01T00:00:00.000Z');

      mockPrisma.user.findUnique
        .mockResolvedValueOnce({
          id: 10,
          username: 'caller',
          name: 'Caller',
          avatarUrl: 'caller.png',
        }) // caller
        .mockResolvedValueOnce({
          id: 20,
          username: 'callee',
          name: 'Callee',
          avatarUrl: 'callee.png',
        }); // callee

      mockPrisma.call.create.mockResolvedValue({
        id: 123,
        callerId: 10,
        calleeId: 20,
        mode: 'AUDIO',
        status: 'RINGING',
        roomId: null,
        createdAt: now,
      });

      const body = {
        calleeId: 20,
        mode: 'AUDIO',
        offer: { type: 'offer', sdp: 'fake-sdp' },
      };

      const res = await request(app).post('/calls/invite').send(body);

      expect(res.statusCode).toBe(201);
      expect(res.body).toEqual({ callId: 123 });

      expect(mockPrisma.call.create).toHaveBeenCalledWith({
        data: {
          callerId: 10,
          calleeId: 20,
          roomId: null,
          mode: 'AUDIO',
          status: 'RINGING',
          offerSdp: 'fake-sdp',
        },
        select: {
          id: true,
          callerId: true,
          calleeId: true,
          mode: true,
          status: true,
          roomId: true,
          createdAt: true,
        },
      });

      expect(emitToUserMock).toHaveBeenCalledWith(20, 'call:incoming', {
        callId: 123,
        fromUser: {
          id: 10,
          username: 'caller',
          name: 'Caller',
          avatarUrl: 'caller.png',
        },
        mode: 'AUDIO',
        offer: { type: 'offer', sdp: 'fake-sdp' },
        roomId: null,
        createdAt: now,
      });
    });

    test('400 for invalid mode', async () => {
      const res = await request(app)
        .post('/calls/invite')
        .send({
          calleeId: 20,
          mode: 'TEXT',
          offer: { type: 'offer', sdp: 'fake-sdp' },
        });

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid mode' });
    });
  });

  // =============================
  // POST /calls/answer
  // =============================
  describe('POST /calls/answer', () => {
    test('400 when callId or answer.sdp missing', async () => {
      let res = await request(app).post('/calls/answer').send({});
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'callId and answer.sdp required' });

      res = await request(app)
        .post('/calls/answer')
        .send({ callId: 1, answer: {} });
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'callId and answer.sdp required' });
    });

    test('404 when call not found', async () => {
      mockPrisma.call.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/calls/answer')
        .send({ callId: 1, answer: { type: 'answer', sdp: 'sdp' } });

      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'Call not found' });
    });

    test('403 when caller tries to answer (not callee)', async () => {
      mockPrisma.call.findUnique.mockResolvedValue({
        id: 1,
        callerId: 10,
        calleeId: 20,
        status: 'RINGING',
      });

      const res = await request(app)
        .post('/calls/answer')
        .send({ callId: 1, answer: { type: 'answer', sdp: 'sdp' } });

      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({ error: 'Only callee can answer' });
    });

    test('409 when status not RINGING or INITIATED', async () => {
      mockPrisma.call.findUnique.mockResolvedValue({
        id: 1,
        callerId: 10,
        calleeId: 10, // user is callee
        status: 'ENDED',
      });

      const res = await request(app)
        .post('/calls/answer')
        .send({ callId: 1, answer: { type: 'answer', sdp: 'sdp' } });

      expect(res.statusCode).toBe(409);
      expect(res.body).toEqual({ error: 'Cannot answer in status ENDED' });
    });

    test('200 on success, emits call:answer to caller', async () => {
      const now = new Date('2025-01-02T00:00:00.000Z');

      mockPrisma.call.findUnique.mockResolvedValue({
        id: 1,
        callerId: 20,
        calleeId: 10, // current user is callee
        status: 'RINGING',
      });

      mockPrisma.call.update.mockResolvedValue({
        id: 1,
        callerId: 20,
        calleeId: 10,
        mode: 'AUDIO',
        status: 'ANSWERED',
        startedAt: now,
      });

      const answer = { type: 'answer', sdp: 'answer-sdp' };

      const res = await request(app)
        .post('/calls/answer')
        .send({ callId: 1, answer });

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true });

      expect(mockPrisma.call.update).toHaveBeenCalled();
      expect(emitToUserMock).toHaveBeenCalledWith(20, 'call:answer', {
        callId: 1,
        answer,
        startedAt: now,
      });
    });
  });

  // =============================
  // POST /calls/candidate
  // =============================
  describe('POST /calls/candidate', () => {
    test('400 when required fields missing', async () => {
      const res = await request(app).post('/calls/candidate').send({});
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        error: 'callId,toUserId,candidate required',
      });
    });

    test('403 when user is not a participant', async () => {
      mockPrisma.call.findUnique.mockResolvedValue({
        id: 1,
        callerId: 99,
        calleeId: 98,
      });

      const res = await request(app)
        .post('/calls/candidate')
        .send({
          callId: 1,
          toUserId: 99,
          candidate: { candidate: 'xyz' },
        });

      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({ error: 'Not a participant' });
    });

    test('200 and emits call:candidate when user is participant', async () => {
      mockPrisma.call.findUnique.mockResolvedValue({
        id: 1,
        callerId: 10, // current user
        calleeId: 20,
      });

      const candidate = { candidate: 'xyz', sdpMid: '0', sdpMLineIndex: 0 };

      const res = await request(app)
        .post('/calls/candidate')
        .send({
          callId: 1,
          toUserId: 20,
          candidate,
        });

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true });

      expect(emitToUserMock).toHaveBeenCalledWith(20, 'call:candidate', {
        callId: 1,
        candidate,
      });
    });
  });

  // =============================
  // POST /calls/end
  // =============================
  describe('POST /calls/end', () => {
    test('400 when callId missing', async () => {
      const res = await request(app).post('/calls/end').send({});
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'callId required' });
    });

    test('404 when call not found', async () => {
      mockPrisma.call.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/calls/end')
        .send({ callId: 1 });

      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'Call not found' });
    });

    test('403 when user is not a participant', async () => {
      mockPrisma.call.findUnique.mockResolvedValue({
        id: 1,
        callerId: 99,
        calleeId: 98,
      });

      const res = await request(app)
        .post('/calls/end')
        .send({ callId: 1 });

      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({ error: 'Not a participant' });
    });

    test('200 on rejected, emits call:ended with REJECTED', async () => {
      const now = new Date('2025-01-03T00:00:00.000Z');

      mockPrisma.call.findUnique.mockResolvedValue({
        id: 1,
        callerId: 10, // current user
        calleeId: 20,
      });

      mockPrisma.call.update.mockResolvedValue({
        id: 1,
        callerId: 10,
        calleeId: 20,
        status: 'REJECTED',
        endedAt: now,
      });

      const res = await request(app)
        .post('/calls/end')
        .send({ callId: 1, reason: 'rejected' });

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true });

      // otherId should be calleeId (20)
      expect(emitToUserMock).toHaveBeenCalledWith(20, 'call:ended', {
        callId: 1,
        status: 'REJECTED',
        endedAt: now,
        reason: 'rejected',
      });
    });

    test('200 on hangup, emits call:ended with ENDED', async () => {
      const now = new Date('2025-01-04T00:00:00.000Z');

      mockPrisma.call.findUnique.mockResolvedValue({
        id: 1,
        callerId: 30,
        calleeId: 10, // current user is callee
      });

      mockPrisma.call.update.mockResolvedValue({
        id: 1,
        callerId: 30,
        calleeId: 10,
        status: 'ENDED',
        endedAt: now,
      });

      const res = await request(app)
        .post('/calls/end')
        .send({ callId: 1 }); // no reason -> ENDED

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true });

      // otherId should be callerId (30)
      expect(emitToUserMock).toHaveBeenCalledWith(30, 'call:ended', {
        callId: 1,
        status: 'ENDED',
        endedAt: now,
        reason: undefined,
      });
    });
  });
});
