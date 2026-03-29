import express from 'express';
import asyncHandler from 'express-async-handler';
import prisma from '../utils/prismaClient.js';
import { emitToUser } from '../services/socketBus.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

function ensureParticipant(call, userId) {
  if (!call) return false;
  return call.callerId === userId || call.calleeId === userId;
}

/**
 * POST /calls/invite
 * { calleeId, mode: 'AUDIO'|'VIDEO', roomId?, offer:{type,sdp}, twilioCallSid? }
 */
router.post('/invite', asyncHandler(async (req, res) => {
  const callerId = Number(req.user.id);
  const { calleeId, mode = 'AUDIO', roomId, offer, twilioCallSid } = req.body || {};

  if (!calleeId || !offer?.sdp) {
    return res.status(400).json({ error: 'calleeId and offer.sdp required' });
  }

  if (!['AUDIO', 'VIDEO'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode' });
  }

  const [caller, callee] = await Promise.all([
    prisma.user.findUnique({
      where: { id: callerId },
      select: { id: true, username: true, name: true, avatarUrl: true },
    }),
    prisma.user.findUnique({
      where: { id: Number(calleeId) },
      select: { id: true, username: true, name: true, avatarUrl: true },
    }),
  ]);

  if (!callee) {
    return res.status(404).json({ error: 'Callee not found' });
  }

  const call = await prisma.call.create({
    data: {
      callerId,
      calleeId: Number(calleeId),
      roomId: roomId ?? null,
      mode,
      status: 'RINGING',
      offerSdp: offer.sdp,
      twilioCallSid: twilioCallSid ?? null,
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

  emitToUser(callee.id, 'call:incoming', {
    callId: call.id,
    fromUser: caller,
    mode,
    offer,
    roomId: call.roomId ?? null,
    createdAt: call.createdAt,
  });

  res.status(201).json({ callId: call.id });
}));

/**
 * POST /calls/answer
 * { callId, answer:{type,sdp} }
 */
router.post('/answer', asyncHandler(async (req, res) => {
  const userId = Number(req.user.id);
  const { callId, answer } = req.body || {};

  if (!callId || !answer?.sdp) {
    return res.status(400).json({ error: 'callId and answer.sdp required' });
  }

  const call = await prisma.call.findUnique({ where: { id: Number(callId) } });
  if (!call) return res.status(404).json({ error: 'Call not found' });
  if (call.calleeId !== userId) return res.status(403).json({ error: 'Only callee can answer' });

  if (!['RINGING', 'INITIATED'].includes(call.status)) {
    return res.status(409).json({ error: `Cannot answer in status ${call.status}` });
  }

  const updated = await prisma.call.update({
    where: { id: call.id },
    data: {
      status: 'ACTIVE',
      answerSdp: answer.sdp,
      startedAt: new Date(),
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

  emitToUser(updated.callerId, 'call:answer', {
    callId: updated.id,
    answer,
    startedAt: updated.startedAt,
  });

  res.json({ ok: true });
}));

/**
 * POST /calls/candidate
 * { callId, toUserId, candidate }
 */
router.post('/candidate', asyncHandler(async (req, res) => {
  const userId = Number(req.user.id);
  const { callId, toUserId, candidate } = req.body || {};

  if (!callId || !toUserId || !candidate) {
    return res.status(400).json({ error: 'callId,toUserId,candidate required' });
  }

  const call = await prisma.call.findUnique({ where: { id: Number(callId) } });
  if (!ensureParticipant(call, userId)) {
    return res.status(403).json({ error: 'Not a participant' });
  }

  emitToUser(Number(toUserId), 'call:candidate', {
    callId: Number(callId),
    candidate,
  });

  res.json({ ok: true });
}));

/**
 * POST /calls/end
 * { callId, reason? }
 *
 * reason examples:
 * - 'declined'
 * - 'missed'
 * - 'failed'
 * - 'hangup'
 * - 'remote_ended'
 */
router.post('/end', asyncHandler(async (req, res) => {
  const userId = Number(req.user.id);
  const { callId, reason, durationSec } = req.body || {};

  if (!callId) {
    return res.status(400).json({ error: 'callId required' });
  }

  const call = await prisma.call.findUnique({ where: { id: Number(callId) } });
  if (!call) return res.status(404).json({ error: 'Call not found' });
  if (!ensureParticipant(call, userId)) {
    return res.status(403).json({ error: 'Not a participant' });
  }

  let status = 'ENDED';
  if (reason === 'declined') status = 'DECLINED';
  else if (reason === 'missed') status = 'MISSED';
  else if (reason === 'failed') status = 'FAILED';

  const endedAt = new Date();

  const updated = await prisma.call.update({
    where: { id: call.id },
    data: {
      status,
      endedAt,
      durationSec: durationSec ?? undefined,
      endReason: reason ?? null,
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

  const otherId = userId === updated.callerId ? updated.calleeId : updated.callerId;

  emitToUser(otherId, 'call:ended', {
    callId: updated.id,
    status: updated.status,
    endedAt: updated.endedAt,
    durationSec: updated.durationSec,
    reason: updated.endReason,
  });

  res.json({ ok: true });
}));

/**
 * PATCH /calls/:id/status
 * Flexible lifecycle patching from app/client or reconciliation jobs
 */
router.patch('/:id/status', asyncHandler(async (req, res) => {
  const userId = Number(req.user.id);
  const callId = Number(req.params.id);

  const {
    status,
    startedAt,
    endedAt,
    durationSec,
    endReason,
    twilioCallSid,
  } = req.body || {};

  const call = await prisma.call.findUnique({ where: { id: callId } });
  if (!call) return res.status(404).json({ error: 'Call not found' });
  if (!ensureParticipant(call, userId)) {
    return res.status(403).json({ error: 'Not a participant' });
  }

  const updated = await prisma.call.update({
    where: { id: callId },
    data: {
      status: status ?? undefined,
      startedAt: startedAt ? new Date(startedAt) : undefined,
      endedAt: endedAt ? new Date(endedAt) : undefined,
      durationSec: durationSec ?? undefined,
      endReason: endReason ?? undefined,
      twilioCallSid: twilioCallSid ?? undefined,
    },
  });

  res.json({ call: updated });
}));

/**
 * GET /calls/history
 * Returns recent calls where the user is caller or callee
 */
router.get('/history', asyncHandler(async (req, res) => {
  const userId = Number(req.user.id);

  const items = await prisma.call.findMany({
    where: {
      OR: [
        { callerId: userId },
        { calleeId: userId },
      ],
    },
    include: {
      caller: {
        select: { id: true, username: true, displayName: true, avatarUrl: true },
      },
      callee: {
        select: { id: true, username: true, displayName: true, avatarUrl: true },
      },
      voicemails: {
        where: {
          deleted: false,
        },
        select: {
          id: true,
          createdAt: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 1,
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const enriched = items.map((call) => ({
    ...call,
    hasVoicemail: call.voicemails.length > 0,
    voicemailId: call.voicemails[0]?.id ?? null,
  }));

  res.json({ items: enriched });
}));

export default router;