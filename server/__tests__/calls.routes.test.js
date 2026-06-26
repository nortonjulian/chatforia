/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
  call: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findMany: jest.fn(),
  },
  callParticipant: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
  },
};

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: mockPrisma,
}));

const emitToUserMock = jest.fn();

await jest.unstable_mockModule('../services/socketBus.js', () => ({
  __esModule: true,
  emitToUser: emitToUserMock,
}));

await jest.unstable_mockModule('../services/pushService.js', () => ({
  __esModule: true,
  sendPushToUser: jest.fn(),
  sendVoipCallPushToUser: jest.fn(),
}));

await jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: (req, _res, next) => {
    req.user = { id: 10, username: 'caller', role: 'USER' };
    next();
  },
}));

const callsModule = await import('../routes/calls.js');
const callsRouter = callsModule.default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/calls', callsRouter);

  app.use((err, _req, res, _next) => {
    return res.status(500).json({
      error: err?.message || 'Internal Server Error',
    });
  });

  return app;
}

describe('calls routes', () => {
  let app;

  beforeEach(() => {
    app = makeApp();

    jest.clearAllMocks();

    mockPrisma.user.findUnique.mockReset();

    mockPrisma.call.create.mockReset();
    mockPrisma.call.findUnique.mockReset();
    mockPrisma.call.update.mockReset();
    mockPrisma.call.delete.mockReset();
    mockPrisma.call.findMany.mockReset();

    mockPrisma.callParticipant.findUnique.mockReset();
    mockPrisma.callParticipant.updateMany.mockReset();
    mockPrisma.callParticipant.update.mockReset();
    mockPrisma.callParticipant.upsert.mockReset();
  });

  describe('POST /calls/invite', () => {
    test('400 when calleeId is missing', async () => {
      const res = await request(app).post('/calls/invite').send({});

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'calleeId required' });
    });

    test('404 when callee not found', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({
          id: 10,
          username: 'caller',
          displayName: 'Caller',
          avatarUrl: null,
        })
        .mockResolvedValueOnce(null);

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
          displayName: 'Caller',
          avatarUrl: 'caller.png',
        })
        .mockResolvedValueOnce({
          id: 20,
          username: 'callee',
          displayName: 'Callee',
          avatarUrl: 'callee.png',
        });

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
      expect(res.body).toEqual({
        callId: 123,
        resolvedCallId: 123,
      });

      expect(mockPrisma.call.create).toHaveBeenCalledWith({
        data: {
          callerId: 10,
          calleeId: 20,
          roomId: null,
          mode: 'AUDIO',
          status: 'RINGING',
          offerSdp: 'fake-sdp',
          twilioCallSid: null,
          participants: {
            create: [
              {
                userId: 10,
                role: 'HOST',
                status: 'JOINED',
                joinedAt: expect.any(Date),
              },
              {
                userId: 20,
                role: 'MEMBER',
                status: 'RINGING',
              },
            ],
          },
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
        callerId: 10,
        callerName: 'Caller',
        fromUser: {
          id: 10,
          username: 'caller',
          displayName: 'Caller',
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

  describe('POST /calls/answer', () => {
    test('400 when callId is missing', async () => {
      const res = await request(app).post('/calls/answer').send({});

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'callId required' });
    });

    test('404 when call not found', async () => {
      mockPrisma.call.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/calls/answer')
        .send({ callId: 1, answer: { type: 'answer', sdp: 'sdp' } });

      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'Call not found' });
    });

    test('403 when caller tries to answer', async () => {
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
        calleeId: 10,
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
        calleeId: 10,
        status: 'RINGING',
      });

      mockPrisma.call.update.mockResolvedValue({
        id: 1,
        callerId: 20,
        calleeId: 10,
        mode: 'AUDIO',
        status: 'ACTIVE',
        startedAt: now,
      });

      mockPrisma.callParticipant.updateMany.mockResolvedValue({
        count: 1,
      });

      const answer = { type: 'answer', sdp: 'answer-sdp' };

      const res = await request(app)
        .post('/calls/answer')
        .send({ callId: 1, answer });

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true });

      expect(mockPrisma.call.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          status: 'ACTIVE',
          answerSdp: 'answer-sdp',
          startedAt: expect.any(Date),
          endReason: null,
        },
        select: {
          id: true,
          callerId: true,
          calleeId: true,
          mode: true,
          status: true,
          startedAt: true,
        },
      });

      expect(mockPrisma.callParticipant.updateMany).toHaveBeenCalledWith({
        where: {
          callId: 1,
          userId: 10,
        },
        data: {
          status: 'JOINED',
          joinedAt: expect.any(Date),
          leftAt: null,
        },
      });

      expect(emitToUserMock).toHaveBeenCalledWith(20, 'call:answer', {
        callId: 1,
        answer,
        startedAt: now,
      });
    });
  });

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

      mockPrisma.callParticipant.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/calls/candidate')
        .send({
          callId: 1,
          toUserId: 99,
          candidate: { candidate: 'xyz' },
        });

      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({ error: 'Not a participant' });

      expect(mockPrisma.callParticipant.findUnique).toHaveBeenCalledWith({
        where: {
          callId_userId: {
            callId: 1,
            userId: 10,
          },
        },
      });
    });

    test('200 and emits call:candidate when user is participant', async () => {
      mockPrisma.call.findUnique.mockResolvedValue({
        id: 1,
        callerId: 10,
        calleeId: 20,
      });

      const candidate = {
        candidate: 'xyz',
        sdpMid: '0',
        sdpMLineIndex: 0,
      };

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
        fromUserId: 10,
        candidate,
      });
    });
  });

  describe('POST /calls/end', () => {
    test('400 when callId missing', async () => {
      const res = await request(app).post('/calls/end').send({});

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'callId required' });
    });

    test('404 when call not found', async () => {
      mockPrisma.call.findUnique.mockResolvedValue(null);

      const res = await request(app).post('/calls/end').send({ callId: 1 });

      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'Call not found' });
    });

    test('403 when user is not a participant', async () => {
      mockPrisma.call.findUnique.mockResolvedValue({
        id: 1,
        callerId: 99,
        calleeId: 98,
        participants: [],
      });

      mockPrisma.callParticipant.findUnique.mockResolvedValue(null);

      const res = await request(app).post('/calls/end').send({ callId: 1 });

      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({ error: 'Not a participant' });

      expect(mockPrisma.callParticipant.findUnique).toHaveBeenCalledWith({
        where: {
          callId_userId: {
            callId: 1,
            userId: 10,
          },
        },
      });
    });

    test('200 on declined, emits call:ended with DECLINED', async () => {
      const now = new Date('2025-01-03T00:00:00.000Z');

      mockPrisma.call.findUnique.mockResolvedValue({
        id: 1,
        callerId: 10,
        calleeId: 20,
        mode: 'AUDIO',
        participants: [{ userId: 10 }, { userId: 20 }],
      });

      mockPrisma.call.update.mockResolvedValue({
        id: 1,
        callerId: 10,
        calleeId: 20,
        status: 'DECLINED',
        endedAt: now,
        durationSec: undefined,
        endReason: 'declined',
      });

      const res = await request(app)
        .post('/calls/end')
        .send({ callId: 1, reason: 'declined' });

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true });

      expect(mockPrisma.call.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: { participants: true },
      });

      expect(mockPrisma.call.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          status: 'DECLINED',
          endedAt: expect.any(Date),
          durationSec: undefined,
          endReason: 'declined',
        },
        select: {
          id: true,
          callerId: true,
          calleeId: true,
          status: true,
          endedAt: true,
          durationSec: true,
          endReason: true,
        },
      });

      expect(emitToUserMock).toHaveBeenCalledWith(20, 'call:ended', {
        callId: 1,
        status: 'DECLINED',
        endedAt: now,
        durationSec: undefined,
        reason: 'declined',
      });
    });

    test('200 on hangup, emits call:ended with ENDED', async () => {
      const now = new Date('2025-01-04T00:00:00.000Z');

      mockPrisma.call.findUnique.mockResolvedValue({
        id: 1,
        callerId: 30,
        calleeId: 10,
        mode: 'AUDIO',
        participants: [{ userId: 30 }, { userId: 10 }],
      });

      mockPrisma.call.update.mockResolvedValue({
        id: 1,
        callerId: 30,
        calleeId: 10,
        status: 'ENDED',
        endedAt: now,
        durationSec: undefined,
        endReason: null,
      });

      const res = await request(app).post('/calls/end').send({ callId: 1 });

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true });

      expect(mockPrisma.call.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: { participants: true },
      });

      expect(mockPrisma.call.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          status: 'ENDED',
          endedAt: expect.any(Date),
          durationSec: undefined,
          endReason: null,
        },
        select: {
          id: true,
          callerId: true,
          calleeId: true,
          status: true,
          endedAt: true,
          durationSec: true,
          endReason: true,
        },
      });

      expect(emitToUserMock).toHaveBeenCalledWith(30, 'call:ended', {
        callId: 1,
        status: 'ENDED',
        endedAt: now,
        durationSec: undefined,
        reason: null,
      });
    });
  });
});