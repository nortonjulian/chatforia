/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const mockPrisma = {
  $transaction: jest.fn(),
  $executeRaw: jest.fn(),
  user: {
    findUnique: jest.fn(),
  },
  call: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
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

    mockPrisma.$transaction
      .mockReset()
      .mockImplementation(async (callback) =>
        callback(mockPrisma)
      );

    mockPrisma.$executeRaw
      .mockReset()
      .mockResolvedValue(undefined);

    mockPrisma.user.findUnique.mockReset();

    mockPrisma.call.create.mockReset();
    mockPrisma.call.findFirst
      .mockReset()
      .mockResolvedValue(null);
    mockPrisma.call.findUnique.mockReset();
    mockPrisma.call.update.mockReset();
    mockPrisma.call.updateMany
      .mockReset()
      .mockResolvedValue({
        count: 0,
      });
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

      expect(
        mockPrisma.$executeRaw
      ).toHaveBeenCalledTimes(1);

      const [
        sqlParts,
        lowUserId,
        highUserId,
      ] = mockPrisma.$executeRaw.mock.calls[0];

      expect(
        sqlParts.join('?')
      ).toMatch(
        /pg_advisory_xact_lock\s*\(\s*CAST\(\? AS integer\),\s*CAST\(\? AS integer\)\s*\)/
      );

      expect(lowUserId).toBe(10);
      expect(highUserId).toBe(20);

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
      expect(res.body).toEqual({
        error: 'Call not found',
        code: 'CALL_NOT_FOUND',
      });
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
      expect(res.body).toEqual({
        error: 'Only callee can answer',
        code: 'ONLY_CALLEE_CAN_ANSWER',
      });
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
      expect(res.body).toEqual({
        error: 'Cannot answer in status ENDED',
        code: 'CALL_NOT_ANSWERABLE',
        callId: 1,
        status: 'ENDED',
      });
    });

    test('409 CALL_ANSWERED_ELSEWHERE when another device already won the answer race', async () => {
      const startedAt =
        new Date('2025-01-02T00:00:00.000Z');

      /*
       * First lookup is the request's initial RINGING state.
       * The atomic claim then loses (count: 0), and its authoritative
       * re-read shows another device already moved the call ACTIVE.
       */
      mockPrisma.call.findUnique
        .mockResolvedValueOnce({
          id: 1,
          callerId: 20,
          calleeId: 10,
          mode: 'AUDIO',
          status: 'RINGING',
        })
        .mockResolvedValueOnce({
          id: 1,
          callerId: 20,
          calleeId: 10,
          mode: 'AUDIO',
          status: 'ACTIVE',
          startedAt,
        });

      mockPrisma.call.updateMany.mockResolvedValue({
        count: 0,
      });

      const res = await request(app)
        .post('/calls/answer')
        .send({
          callId: 1,
          answer: {
            type: 'answer',
            sdp: 'losing-answer-sdp',
          },
        });

      expect(res.statusCode).toBe(409);

      expect(res.body).toEqual({
        error: 'This call was answered on another device.',
        code: 'CALL_ANSWERED_ELSEWHERE',
        callId: 1,
        status: 'ACTIVE',
      });

      expect(
        mockPrisma.call.updateMany
      ).toHaveBeenCalledWith({
        where: {
          id: 1,
          status: {
            in: ['RINGING', 'INITIATED'],
          },
        },
        data: {
          status: 'ACTIVE',
          answerSdp: 'losing-answer-sdp',
          startedAt: expect.any(Date),
          endReason: null,
        },
      });

      /*
       * Losing devices must not become joined participants and must not
       * emit a second answer event that could disturb the winner.
       */
      expect(
        mockPrisma.callParticipant.updateMany
      ).not.toHaveBeenCalled();

      expect(
        emitToUserMock
      ).not.toHaveBeenCalled();
    });

    test('200 on success, emits call:answer to caller', async () => {
      const now = new Date('2025-01-02T00:00:00.000Z');

      mockPrisma.call.findUnique.mockResolvedValue({
        id: 1,
        callerId: 20,
        calleeId: 10,
        status: 'RINGING',
      });

      mockPrisma.call.updateMany.mockResolvedValue({
        count: 1,
      });

      mockPrisma.call.findUnique
        .mockResolvedValueOnce({
          id: 1,
          callerId: 20,
          calleeId: 10,
          mode: 'AUDIO',
          status: 'RINGING',
        })
        .mockResolvedValueOnce({
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
      expect(res.body).toEqual({
        ok: true,
        callId: 1,
        status: 'ACTIVE',
      });

      expect(mockPrisma.call.updateMany).toHaveBeenCalledWith({
        where: {
          id: 1,
          status: {
            in: ['RINGING', 'INITIATED'],
          },
        },
        data: {
          status: 'ACTIVE',
          answerSdp: 'answer-sdp',
          startedAt: expect.any(Date),
          endReason: null,
        },
      });

      expect(mockPrisma.call.findUnique).toHaveBeenNthCalledWith(
        2,
        {
          where: {
            id: 1,
          },
          select: {
            id: true,
            callerId: true,
            calleeId: true,
            mode: true,
            status: true,
            startedAt: true,
          },
        }
      );

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

      mockPrisma.call.findUnique
        .mockResolvedValueOnce({
          id: 1,
          callerId: 10,
          calleeId: 20,
          mode: 'AUDIO',
          status: 'RINGING',
          participants: [{ userId: 10 }, { userId: 20 }],
        })
        .mockResolvedValueOnce({
          id: 1,
          callerId: 10,
          calleeId: 20,
          status: 'DECLINED',
          endedAt: now,
          durationSec: undefined,
          endReason: 'declined',
        });

      mockPrisma.call.updateMany.mockResolvedValue({ count: 1 });

      const res = await request(app)
        .post('/calls/end')
        .send({ callId: 1, reason: 'declined' });

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true });

      expect(mockPrisma.call.updateMany).toHaveBeenCalledWith({
        where: {
          id: 1,
          status: { notIn: ['ENDED', 'DECLINED', 'MISSED', 'FAILED'] },
        },
        data: {
          status: 'DECLINED',
          endedAt: expect.any(Date),
          durationSec: undefined,
          endReason: 'declined',
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

      mockPrisma.call.findUnique
        .mockResolvedValueOnce({
          id: 1,
          callerId: 30,
          calleeId: 10,
          mode: 'AUDIO',
          status: 'ACTIVE',
          participants: [{ userId: 30 }, { userId: 10 }],
        })
        .mockResolvedValueOnce({
          id: 1,
          callerId: 30,
          calleeId: 10,
          status: 'ENDED',
          endedAt: now,
          durationSec: undefined,
          endReason: null,
        });

      mockPrisma.call.updateMany.mockResolvedValue({ count: 1 });

      const res = await request(app).post('/calls/end').send({ callId: 1 });

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true });

      expect(mockPrisma.call.updateMany).toHaveBeenCalledWith({
        where: {
          id: 1,
          status: { notIn: ['ENDED', 'DECLINED', 'MISSED', 'FAILED'] },
        },
        data: {
          status: 'ENDED',
          endedAt: expect.any(Date),
          durationSec: undefined,
          endReason: null,
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

    test('does not overwrite or re-emit when another terminal update already won', async () => {
      mockPrisma.call.findUnique.mockResolvedValue({
        id: 1,
        callerId: 10,
        calleeId: 20,
        mode: 'VIDEO',
        status: 'ENDED',
        participants: [{ userId: 10 }, { userId: 20 }],
      });

      mockPrisma.call.updateMany.mockResolvedValue({ count: 0 });

      const res = await request(app)
        .post('/calls/end')
        .send({
          callId: 1,
          reason: 'hangup',
          durationSec: 999,
        });

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(emitToUserMock).not.toHaveBeenCalled();
      expect(mockPrisma.call.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe('PATCH /calls/:id/status', () => {
    test('a stale remote-ended acknowledgement cannot terminate an active call', async () => {
      const startedAt =
        new Date('2025-01-05T00:00:00.000Z');

      const activeCall = {
        id: 1,
        callerId: 20,
        calleeId: 10,
        mode: 'AUDIO',
        status: 'ACTIVE',
        startedAt,
        endedAt: null,
        durationSec: null,
        endReason: null,
        twilioCallSid: null,
      };

      mockPrisma.call.findUnique
        .mockResolvedValueOnce({
          ...activeCall,
          participants: [
            { userId: 20 },
            { userId: 10 },
          ],
        })
        .mockResolvedValueOnce(activeCall);

      const res = await request(app)
        .patch('/calls/1/status')
        .send({
          status: 'ENDED',
          endedAt:
            '2025-01-05T00:00:00.250Z',
          durationSec: null,
          endReason: 'remote_ended',
        });

      expect(res.statusCode).toBe(200);

      expect(res.body.call).toMatchObject({
        id: 1,
        status: 'ACTIVE',
        endedAt: null,
        endReason: null,
      });

      expect(
        mockPrisma.call.updateMany
      ).not.toHaveBeenCalled();

      expect(
        emitToUserMock
      ).not.toHaveBeenCalled();
    });
  });
});
