import express from 'express';
import Boom from '@hapi/boom';
import prisma from '../utils/prismaClient.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { emitToUser } from '../services/socketBus.js';

const router = express.Router();

router.post('/start', requireAuth, asyncHandler(async (req, res) => {
  const callerId = Number(req.user.id);
  const calleeId = Number(req.body?.calleeId);
  const chatRoomId = req.body?.chatRoomId ? Number(req.body.chatRoomId) : null;

  if (!Number.isFinite(calleeId) || calleeId <= 0) {
    throw Boom.badRequest('calleeId is required');
  }

  if (calleeId === callerId) {
    throw Boom.badRequest('Cannot video call yourself');
  }

  const callee = await prisma.user.findUnique({
    where: { id: calleeId },
    select: { id: true, username: true, displayName: true },
  });

  if (!callee) throw Boom.notFound('User not found');

  const call = await prisma.call.create({
    data: {
      callerId,
      calleeId,
      roomId: chatRoomId,
      mode: 'VIDEO',
      status: 'RINGING',
    },
    select: {
      id: true,
      callerId: true,
      calleeId: true,
      roomId: true,
      createdAt: true,
    },
  });

  const roomName = `call_${call.id}`;

  emitToUser(calleeId, 'video:incoming', {
    callId: call.id,
    roomName,
    callerId,
    callerName: req.user.displayName || req.user.username || 'Chatforia user',
    chatRoomId,
    createdAt: call.createdAt,
  });

  res.json({
    ok: true,
    callId: call.id,
    roomName,
  });
}));

router.post('/end', requireAuth, asyncHandler(async (req, res) => {
  const callId = Number(req.body?.callId);

  if (!Number.isFinite(callId)) {
    throw Boom.badRequest('callId is required');
  }

  const call = await prisma.call.findFirst({
    where: {
      id: callId,
      OR: [
        { callerId: req.user.id },
        { calleeId: req.user.id },
      ],
    },
    select: {
      id: true,
      callerId: true,
      calleeId: true,
    },
  });

  if (!call) throw Boom.notFound('Call not found');

  const updated = await prisma.call.update({
    where: { id: call.id },
    data: {
      status: 'ENDED',
      endedAt: new Date(),
      endReason: 'video_ended',
    },
    select: {
      id: true,
      callerId: true,
      calleeId: true,
      status: true,
      endedAt: true,
    },
  });

  emitToUser(updated.callerId, 'video:ended', {
    callId: updated.id,
    status: updated.status,
    endedAt: updated.endedAt,
  });

  if (updated.calleeId) {
    emitToUser(updated.calleeId, 'video:ended', {
      callId: updated.id,
      status: updated.status,
      endedAt: updated.endedAt,
    });
  }

  res.json({ ok: true });
}));

export default router;