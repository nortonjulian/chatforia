import express from 'express';
import asyncHandler from 'express-async-handler';
import prisma from '../utils/prismaClient.js';
import { emitToUser } from '../services/socketBus.js';
import { requireAuth } from '../middleware/auth.js';
import { sendPushToUser, sendVoipCallPushToUser } from '../services/pushService.js';

const router = express.Router();
router.use(requireAuth);

async function ensureParticipant(call, userId) {
  if (!call) return false;

  if (call.callerId === userId || call.calleeId === userId) return true;

  const participant = await prisma.callParticipant.findUnique({
    where: {
      callId_userId: {
        callId: call.id,
        userId,
      },
    },
  });

  return Boolean(participant);
}

const MAX_CALL_PARTICIPANTS = 3;

function participantSelect() {
  return {
    id: true,
    userId: true,
    role: true,
    status: true,
    joinedAt: true,
    leftAt: true,
    user: {
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
      },
    },
  };
}

/**
 * POST /calls/invite
 * { calleeId, mode: 'AUDIO'|'VIDEO', roomId?, offer:{type,sdp}, twilioCallSid? }
 */
router.post('/invite', asyncHandler(async (req, res) => {
  const callerId = Number(req.user.id);
  const { calleeId, mode = 'AUDIO', roomId, offer, twilioCallSid } = req.body || {};

  if (!calleeId) {
    return res.status(400).json({ error: 'calleeId required' });
  }

  if (!['AUDIO', 'VIDEO'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode' });
  }

  const [caller, callee] = await Promise.all([
    prisma.user.findUnique({
      where: { id: callerId },
      select: { id: true, username: true, displayName: true, avatarUrl: true },
    }),
    prisma.user.findUnique({
      where: { id: Number(calleeId) },
      select: { id: true, username: true, displayName: true, avatarUrl: true },
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
      offerSdp: offer?.sdp ?? null,
      twilioCallSid: twilioCallSid ?? null,
      participants: {
        create: [
          {
            userId: callerId,
            role: 'HOST',
            status: 'JOINED',
            joinedAt: new Date(),
          },
          {
            userId: Number(calleeId),
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

  const roomName = `call_${call.id}`;

  const callerName =
  caller?.displayName || caller?.username || 'Chatforia user';

if (mode === 'VIDEO') {
  const webIncomingPayload = {
    callId: call.id,
    roomName,
    callerId,
    callerName,
    fromUser: caller,
    mode: 'VIDEO',
    offer: offer ?? null,
    roomId: call.roomId ?? null,
    chatRoomId: call.roomId ?? null,
    createdAt: call.createdAt,
  };

  emitToUser(callee.id, 'video:incoming', webIncomingPayload);
  emitToUser(callee.id, 'call:incoming', webIncomingPayload);

  try {
    await sendVoipCallPushToUser(callee.id, {
      callId: call.id,
      callerId,
      callerName,
      mode: 'VIDEO',
      roomName,
      chatRoomId: call.roomId ?? '',
    });
  } catch (err) {
    console.warn('[calls] failed to send iOS video VoIP call push', err?.message || err);
  }

  try {
    await sendPushToUser(callee.id, {
      alert: {
        title: 'Incoming video call',
        body: `${callerName} is calling`,
      },
      sound: 'default',
      data: {
        type: 'call_incoming',
        callId: call.id,
        callerId,
        callerName,
        mode: 'VIDEO',
        roomName,
        chatRoomId: call.roomId ?? '',
      },
    });
  } catch (err) {
    console.warn('[calls] failed to send video call push', err?.message || err);
  }
  } else {
    emitToUser(callee.id, 'call:incoming', {
      callId: call.id,
      callerId,
      callerName,
      fromUser: caller,
      mode,
      offer: offer ?? null,
      roomId: call.roomId ?? null,
      createdAt: call.createdAt,
    });

    try {
      await sendVoipCallPushToUser(callee.id, {
        callId: call.id,
        callerId,
        callerName,
        mode: 'AUDIO',
        roomName,
        chatRoomId: call.roomId ?? '',
      });
    } catch (err) {
      console.warn('[calls] failed to send iOS VoIP call push', err?.message || err);
    }

    try {
      await sendPushToUser(callee.id, {
        alert: {
          title: 'Incoming call',
          body: `${callerName} is calling`,
        },
        sound: 'default',
        data: {
          type: 'call_incoming',
          callId: call.id,
          callerId,
          callerName,
          mode: 'AUDIO',
          roomId: call.roomId ?? '',
        },
      });
    } catch (err) {
      console.warn('[calls] failed to send audio call push', err?.message || err);
    }
  }

  res.status(201).json({
    callId: call.id,
    resolvedCallId: call.id,
  });
}));


/**
 * POST /calls/start-external
 * { phoneNumber, mode?: 'AUDIO', roomId?, twilioCallSid? }
 */
router.post('/start-external', asyncHandler(async (req, res) => {
  const callerId = Number(req.user.id);
  const { phoneNumber, mode = 'AUDIO', roomId, twilioCallSid } = req.body || {};

  if (!phoneNumber) {
    return res.status(400).json({ error: 'phoneNumber required' });
  }

  if (mode !== 'AUDIO') {
    return res.status(400).json({ error: 'External calls only support AUDIO' });
  }

  const call = await prisma.call.create({
    data: {
      callerId,
      calleeId: null,
      roomId: roomId ?? null,
      mode: 'AUDIO',
      status: 'INITIATED',
      externalPhone: phoneNumber,
      twilioCallSid: twilioCallSid ?? null,
      participants: {
        create: [
          {
            userId: callerId,
            role: 'HOST',
            status: 'JOINED',
            joinedAt: new Date(),
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
      externalPhone: true,
      twilioCallSid: true,
      createdAt: true,
    },
  });

  res.status(201).json({
    callId: call.id,
    resolvedCallId: call.id,
    call,
  });
}));

/**
 * POST /calls/answer
 * { callId, answer:{type,sdp} }
 */
router.post('/answer', asyncHandler(async (req, res) => {
  const userId = Number(req.user.id);
  const { callId, answer } = req.body || {};

  if (!callId) {
    return res.status(400).json({ error: 'callId required' });
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
      answerSdp: answer?.sdp ?? null,
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

  await prisma.callParticipant.updateMany({
    where: {
      callId: call.id,
      userId,
    },
    data: {
      status: 'JOINED',
      joinedAt: new Date(),
      leftAt: null,
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
  if (!(await ensureParticipant(call, userId))) {
    return res.status(403).json({ error: 'Not a participant' });
  }

  emitToUser(Number(toUserId), 'call:candidate', {
    callId: Number(callId),
    fromUserId: userId,
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

  const call = await prisma.call.findUnique({
    where: { id: Number(callId) },
    include: { participants: true },
  });

  if (!call) return res.status(404).json({ error: 'Call not found' });
  if (!(await ensureParticipant(call, userId))) {
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

  const notifyIds = new Set();

  if (updated.callerId && updated.callerId !== userId) notifyIds.add(updated.callerId);
  if (updated.calleeId && updated.calleeId !== userId) notifyIds.add(updated.calleeId);

  for (const p of call.participants || []) {
    if (p.userId !== userId) notifyIds.add(p.userId);
  }

  for (const id of notifyIds) {
    emitToUser(id, 'call:ended', {
      callId: updated.id,
      status: updated.status,
      endedAt: updated.endedAt,
      durationSec: updated.durationSec,
      reason: updated.endReason,
    });
  }

  if (call.mode === 'VIDEO') {
    for (const id of notifyIds) {
      emitToUser(id, 'video:ended', {
        callId: updated.id,
        status: updated.status,
        endedAt: updated.endedAt,
        durationSec: updated.durationSec,
        reason: updated.endReason,
      });
    }
  }

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

  const call = await prisma.call.findUnique({
    where: { id: callId },
    include: { participants: true },
  });

  if (!call) return res.status(404).json({ error: 'Call not found' });

  if (!(await ensureParticipant(call, userId))) {
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
    select: {
      id: true,
      callerId: true,
      calleeId: true,
      mode: true,
      status: true,
      startedAt: true,
      endedAt: true,
      durationSec: true,
      endReason: true,
      twilioCallSid: true,
    },
  });

  const terminalStatuses = new Set([
    'ENDED',
    'DECLINED',
    'MISSED',
    'FAILED',
  ]);

  const updatedStatus = String(updated.status || '').toUpperCase();

  if (terminalStatuses.has(updatedStatus)) {
    const notifyIds = new Set();

    if (updated.callerId && updated.callerId !== userId) {
      notifyIds.add(updated.callerId);
    }

    if (updated.calleeId && updated.calleeId !== userId) {
      notifyIds.add(updated.calleeId);
    }

    for (const p of call.participants || []) {
      if (p.userId && p.userId !== userId) {
        notifyIds.add(p.userId);
      }
    }

    for (const id of notifyIds) {
      emitToUser(id, 'call:ended', {
        callId: updated.id,
        status: updated.status,
        endedAt: updated.endedAt,
        durationSec: updated.durationSec,
        reason: updated.endReason,
      });
    }

    if (updated.mode === 'VIDEO') {
      for (const id of notifyIds) {
        emitToUser(id, 'video:ended', {
          callId: updated.id,
          status: updated.status,
          endedAt: updated.endedAt,
          durationSec: updated.durationSec,
          reason: updated.endReason,
        });
      }
    }

    console.log('[calls/status] emitted call ended', {
      callId: updated.id,
      status: updated.status,
      endedBy: userId,
      notified: Array.from(notifyIds),
    });
  }

  res.json({ call: updated });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const userId = Number(req.user.id);
  const callId = Number(req.params.id);

  const call = await prisma.call.findUnique({
    where: { id: callId },
  });

  if (!call) {
    return res.status(404).json({ error: 'Call not found' });
  }

  if (!(await ensureParticipant(call, userId))) {
    return res.status(403).json({ error: 'Not a participant' });
  }

  await prisma.call.delete({
    where: { id: callId },
  });

  res.json({ ok: true });
}));

router.post('/:id/add-participant', asyncHandler(async (req, res) => {
  const userId = Number(req.user.id);
  const callId = Number(req.params.id);
  const { userId: addedUserId, offer } = req.body || {};

  if (!addedUserId) {
    return res.status(400).json({ error: 'userId required' });
  }

  if (!offer?.sdp) {
    return res.status(400).json({ error: 'offer.sdp required' });
  }

  const call = await prisma.call.findUnique({
    where: { id: callId },
    include: {
      participants: {
        select: participantSelect(),
      },
    },
  });

  if (!call) return res.status(404).json({ error: 'Call not found' });

  if (!(await ensureParticipant(call, userId))) {
    return res.status(403).json({ error: 'Not a participant' });
  }

  if (call.mode !== 'AUDIO') {
    return res.status(409).json({ error: 'Three-way calling is audio-only for now' });
  }

  if (!['ACTIVE', 'RINGING', 'INITIATED'].includes(call.status)) {
    return res.status(409).json({ error: `Cannot add participant in status ${call.status}` });
  }

  const activeCount = call.participants.filter((p) =>
    ['RINGING', 'JOINED'].includes(p.status)
  ).length;

  if (activeCount >= MAX_CALL_PARTICIPANTS) {
    return res.status(409).json({ error: 'Call is already at the 3-person limit' });
  }

  const addedUser = await prisma.user.findUnique({
    where: { id: Number(addedUserId) },
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
    },
  });

  if (!addedUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  const existing = await prisma.callParticipant.findUnique({
    where: {
      callId_userId: {
        callId,
        userId: Number(addedUserId),
      },
    },
  });

  if (existing && ['RINGING', 'JOINED'].includes(existing.status)) {
    return res.status(409).json({ error: 'User is already in this call' });
  }

  const participant = await prisma.callParticipant.upsert({
    where: {
      callId_userId: {
        callId,
        userId: Number(addedUserId),
      },
    },
    update: {
      status: 'RINGING',
      leftAt: null,
      joinedAt: null,
    },
    create: {
      callId,
      userId: Number(addedUserId),
      role: 'MEMBER',
      status: 'RINGING',
    },
    select: participantSelect(),
  });

  const inviter = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
    },
  });

  emitToUser(Number(addedUserId), 'call:participant-invite', {
    callId,
    fromUser: inviter,
    mode: 'AUDIO',
    offer,
    participants: call.participants.map((p) => ({
      userId: p.userId,
      status: p.status,
      role: p.role,
      user: p.user,
    })),
    createdAt: new Date(),
  });

  emitToUser(call.callerId, 'call:participant-ringing', {
    callId,
    participant,
  });

  if (call.calleeId && call.calleeId !== call.callerId) {
    emitToUser(call.calleeId, 'call:participant-ringing', {
      callId,
      participant,
    });
  }

  res.status(201).json({ participant });
}));

router.post('/:id/answer-participant', asyncHandler(async (req, res) => {
  const userId = Number(req.user.id);
  const callId = Number(req.params.id);
  const { answer, toUserId } = req.body || {};

  if (!answer?.sdp) {
    return res.status(400).json({ error: 'answer.sdp required' });
  }

  const call = await prisma.call.findUnique({
    where: { id: callId },
    include: {
      participants: true,
    },
  });

  if (!call) return res.status(404).json({ error: 'Call not found' });

  const participant = await prisma.callParticipant.findUnique({
    where: {
      callId_userId: {
        callId,
        userId,
      },
    },
    select: participantSelect(),
  });

  if (!participant) {
    return res.status(403).json({ error: 'Not an invited participant' });
  }

  const updated = await prisma.callParticipant.update({
    where: {
      callId_userId: {
        callId,
        userId,
      },
    },
    data: {
      status: 'JOINED',
      joinedAt: new Date(),
      leftAt: null,
    },
    select: participantSelect(),
  });

  const hostUserId = Number(toUserId || call.callerId);

  emitToUser(hostUserId, 'call:participant-answer', {
    callId,
    fromUserId: userId,
    participant: updated,
    answer,
  });

  const notifyIds = call.participants
    .map((p) => p.userId)
    .filter((id) => id !== userId && id !== hostUserId);

  for (const id of notifyIds) {
    emitToUser(id, 'call:participant-joined', {
      callId,
      participant: updated,
    });
  }

  for (const id of notifyIds) {
  emitToUser(id, 'call:participant-offer-needed', {
    callId,
    participant: updated,
  });
}

  res.json({ ok: true, participant: updated });
}));

router.post('/:id/participant-offer', asyncHandler(async (req, res) => {
  const userId = Number(req.user.id);
  const callId = Number(req.params.id);
  const { toUserId, offer } = req.body || {};

  if (!toUserId || !offer?.sdp) {
    return res.status(400).json({ error: 'toUserId and offer.sdp required' });
  }

  const call = await prisma.call.findUnique({
    where: { id: callId },
    include: { participants: true },
  });

  if (!call) return res.status(404).json({ error: 'Call not found' });

  const targetParticipant = await prisma.callParticipant.findUnique({
    where: {
      callId_userId: {
        callId,
        userId: Number(toUserId),
      },
    },
  });

  if (
    !targetParticipant ||
    !['RINGING', 'JOINED'].includes(targetParticipant.status)
  ) {
    return res.status(403).json({
      error: 'Target participant is not available',
    });
  }

  const fromUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, displayName: true, avatarUrl: true },
  });

  emitToUser(Number(toUserId), 'call:participant-offer', {
    callId,
    fromUser,
    offer,
  });

  res.json({ ok: true });
}));

router.post('/:id/decline-participant', asyncHandler(async (req, res) => {
  const userId = Number(req.user.id);
  const callId = Number(req.params.id);

  const call = await prisma.call.findUnique({
    where: { id: callId },
    include: { participants: true },
  });

  if (!call) return res.status(404).json({ error: 'Call not found' });

  const updated = await prisma.callParticipant.update({
    where: {
      callId_userId: {
        callId,
        userId,
      },
    },
    data: {
      status: 'DECLINED',
      leftAt: new Date(),
    },
    select: participantSelect(),
  });

  for (const p of call.participants) {
    if (p.userId !== userId) {
      emitToUser(p.userId, 'call:participant-declined', {
        callId,
        participant: updated,
      });
    }
  }

  res.json({ ok: true });
}));

router.post('/:id/leave-participant', asyncHandler(async (req, res) => {
  const userId = Number(req.user.id);
  const callId = Number(req.params.id);

  const call = await prisma.call.findUnique({
    where: { id: callId },
    include: { participants: true },
  });

  if (!call) return res.status(404).json({ error: 'Call not found' });

  const updated = await prisma.callParticipant.update({
    where: {
      callId_userId: {
        callId,
        userId,
      },
    },
    data: {
      status: 'LEFT',
      leftAt: new Date(),
    },
    select: participantSelect(),
  });

  for (const p of call.participants) {
    if (p.userId !== userId) {
      emitToUser(p.userId, 'call:participant-left', {
        callId,
        participant: updated,
      });
    }
  }

  res.json({ ok: true });
}));

/**
 * GET /calls/history
 * Returns recent calls where the user is caller or callee
 */
router.get('/history', asyncHandler(async (req, res) => {
  const userId = Number(req.user.id);

  const requestedLimit = Number.parseInt(String(req.query.limit || ''), 10);
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 100)
      : 50;

  const cursorId = req.query.cursor
    ? Number.parseInt(String(req.query.cursor), 10)
    : null;

  const query = {
    where: {
      OR: [
        { callerId: userId },
        { calleeId: userId },
        {
          participants: {
            some: {
              userId,
            },
          },
        },
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
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
    take: limit + 1,
  };

  if (Number.isInteger(cursorId) && cursorId > 0) {
    query.cursor = { id: cursorId };
    query.skip = 1;
  }

  const rows = await prisma.call.findMany(query);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

  const enriched = items.map((call) => {
    const isOutgoing = call.callerId === userId;
    const otherUser = isOutgoing ? call.callee : call.caller;

    return {
      ...call,
      direction: isOutgoing ? 'OUTGOING' : 'INCOMING',
      displayName:
        otherUser?.displayName ||
        otherUser?.username ||
        call.externalPhone ||
        null,

      otherUserId: otherUser?.id ?? null,
      otherUsername: otherUser?.username ?? null,
      otherDisplayName: otherUser?.displayName ?? null,
      phoneNumber: call.externalPhone || null,

      hasVoicemail: call.voicemails.length > 0,
      voicemailId: call.voicemails[0]?.id ?? null,
    };
  });

  res.json({
    items: enriched,
    nextCursor,
  });
}));

export default router;