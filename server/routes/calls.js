import express from 'express';
import asyncHandler from 'express-async-handler';
import prisma from '../utils/prismaClient.js';
import { emitToUser } from '../services/socketBus.js';
import { requireAuth } from '../middleware/auth.js';
import { sendPushToUser, sendVoipCallPushToUser } from '../services/pushService.js';
import { collectCallLifecycleRecipientIds } from '../utils/callLifecycleRecipients.js';
import { claimCallActive } from '../utils/callAnswerArbitration.js';
import { isVoiceEligibleDevice } from '../services/voiceDeviceService.js';

const router = express.Router();
router.use(requireAuth);

const TERMINAL_CALL_STATUSES = [
  'ENDED',
  'DECLINED',
  'MISSED',
  'FAILED',
];

function isTerminalCallStatus(status) {
  return TERMINAL_CALL_STATUSES.includes(String(status || '').toUpperCase());
}

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

async function resolveEligibleVoiceDevice(
  userId,
  deviceId
) {
  const normalizedDeviceId =
    String(deviceId || '').trim();

  if (!normalizedDeviceId) {
    return null;
  }

  const device = await prisma.device.findUnique({
    where: {
      userId_deviceId: {
        userId: Number(userId),
        deviceId: normalizedDeviceId,
      },
    },
    select: {
      deviceId: true,
      platform: true,
      pairingStatus: true,
      revokedAt: true,
      voiceIdentity: true,
      voiceRegisteredAt: true,
      voiceRegistrationVer: true,
      voicePushEnvironment: true,
    },
  });

  if (!isVoiceEligibleDevice(device, userId)) {
    return null;
  }

  return device;
}

function isNonAuthoritativeActiveCalleeDevice({
  call,
  userId,
  deviceId,
}) {
  if (
    !call ||
    call.status !== 'ACTIVE' ||
    Number(userId) !== Number(call.calleeId) ||
    !call.answeredDeviceId
  ) {
    return false;
  }

  return (
    String(deviceId || '').trim() !==
    String(call.answeredDeviceId).trim()
  );
}

async function notifyAnsweredElsewhere(call) {
  if (!call?.calleeId) return;

  const payload = {
    callId: call.id,
    mode: call.mode,
    status: 'ANSWERED_ELSEWHERE',
    reason: 'answered_elsewhere',
  };

  emitToUser(call.calleeId, 'call:ended', payload);

  if (call.mode === 'VIDEO') {
    emitToUser(call.calleeId, 'video:ended', payload);
  }

  try {
    await sendPushToUser(call.calleeId, {
      contentAvailable: true,
      data: {
        type: 'call_answered_elsewhere',
        callId: call.id,
        mode: call.mode,
        status: 'ANSWERED_ELSEWHERE',
        reason: 'answered_elsewhere',
      },
    });
  } catch (error) {
    console.warn(
      '[calls] failed to send answered-elsewhere push',
      {
        callId: call.id,
        userId: call.calleeId,
        error: error?.message || error,
      }
    );
  }
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

  const targetCalleeId = Number(calleeId);

  if (
    !Number.isInteger(targetCalleeId) ||
    targetCalleeId <= 0
  ) {
    return res.status(400).json({ error: 'Invalid calleeId' });
  }

  if (targetCalleeId === callerId) {
    return res.status(400).json({
      error: 'Cannot call yourself',
    });
  }

  const [caller, callee] = await Promise.all([
    prisma.user.findUnique({
      where: { id: callerId },
      select: { id: true, username: true, displayName: true, avatarUrl: true },
    }),
    prisma.user.findUnique({
      where: { id: targetCalleeId },
      select: { id: true, username: true, displayName: true, avatarUrl: true },
    }),
  ]);

  if (!callee) {
    return res.status(404).json({ error: 'Callee not found' });
  }

  /*
   * Prevent simultaneous reciprocal calls from creating two live
   * database records and two Twilio legs.
   *
   * Both A -> B and B -> A use the same sorted advisory-lock key.
   * PostgreSQL releases the lock automatically when this transaction
   * commits or rolls back.
   */
  const lowUserId = Math.min(callerId, targetCalleeId);
  const highUserId = Math.max(callerId, targetCalleeId);

  const arbitration = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        CAST(${lowUserId} AS integer),
        CAST(${highUserId} AS integer)
      )
    `;

    const pairWhere = {
      OR: [
        {
          callerId,
          calleeId: targetCalleeId,
        },
        {
          callerId: targetCalleeId,
          calleeId: callerId,
        },
      ],
    };

    /*
     * A pre-answer call should never remain live indefinitely.
     * Finalize abandoned INITIATED/RINGING rows before checking
     * whether this user pair already has a current call.
     */
    const staleBefore = new Date(Date.now() - 2 * 60 * 1000);

    const staleCleanup = await tx.call.updateMany({
      where: {
        ...pairWhere,
        status: {
          in: ['INITIATED', 'RINGING'],
        },
        createdAt: {
          lt: staleBefore,
        },
      },
      data: {
        status: 'FAILED',
        endedAt: new Date(),
        endReason: 'stale_ringing_timeout',
      },
    });

    if (staleCleanup.count > 0) {
      console.info(
        '[calls/invite] finalized stale pre-answer calls',
        {
          callerId,
          calleeId: targetCalleeId,
          count: staleCleanup.count,
        }
      );
    }

    const existingCall = await tx.call.findFirst({
      where: {
        ...pairWhere,
        status: {
          in: ['INITIATED', 'RINGING', 'ACTIVE'],
        },
      },
      orderBy: {
        id: 'asc',
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

    if (existingCall) {
      return {
        created: false,
        call: existingCall,
      };
    }

    const createdCall = await tx.call.create({
      data: {
        callerId,
        calleeId: targetCalleeId,
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
              userId: targetCalleeId,
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

    return {
      created: true,
      call: createdCall,
    };
  });

  if (!arbitration.created) {
    const existingCall = arbitration.call;

    console.info(
      '[calls/invite] live call already exists for user pair',
      {
        requestedCallerId: callerId,
        requestedCalleeId: targetCalleeId,
        survivingCallId: existingCall.id,
        survivingCallerId: existingCall.callerId,
        survivingCalleeId: existingCall.calleeId,
        status: existingCall.status,
      }
    );

    return res.status(409).json({
      error: 'CALL_ALREADY_IN_PROGRESS',
      callId: existingCall.id,
      resolvedCallId: existingCall.id,
      callerId: existingCall.callerId,
      calleeId: existingCall.calleeId,
      mode: existingCall.mode,
      status: existingCall.status,
    });
  }

  const call = arbitration.call;

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
      skipApns: true,
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
        skipApns: true,
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

  const numericCallId = Number(callId);

const call = await prisma.call.findUnique({
  where: {
    id: numericCallId,
  },
});

if (!call) {
  return res.status(404).json({
    error: 'Call not found',
    code: 'CALL_NOT_FOUND',
  });
}

if (call.calleeId !== userId) {
  return res.status(403).json({
    error: 'Only callee can answer',
    code: 'ONLY_CALLEE_CAN_ANSWER',
  });
}

const answerStartedAt = new Date();

const answerClaim =
  await claimCallActive({
    callModel: prisma.call,
    callId: numericCallId,
    data: {
      status: 'ACTIVE',
      answerSdp: answer?.sdp ?? null,
      startedAt: answerStartedAt,
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

if (!answerClaim.won) {
  const authoritative =
    answerClaim.call;

  return res.status(409).json({
    error:
      authoritative?.status === 'ACTIVE'
        ? 'This call was answered on another device.'
        : `Cannot answer in status ${authoritative?.status || 'UNKNOWN'}`,
    code:
      authoritative?.status === 'ACTIVE'
        ? 'CALL_ANSWERED_ELSEWHERE'
        : 'CALL_NOT_ANSWERABLE',
    callId: numericCallId,
    status: authoritative?.status || null,
  });
}

const updated = answerClaim.call;

await prisma.callParticipant.updateMany({
  where: {
    callId: numericCallId,
    userId,
  },
  data: {
    status: 'JOINED',
    joinedAt: answerStartedAt,
    leftAt: null,
  },
});

emitToUser(updated.callerId, 'call:answer', {
  callId: updated.id,
  answer,
  startedAt: updated.startedAt,
});

await notifyAnsweredElsewhere(updated);

res.json({
  ok: true,
  callId: updated.id,
  status: updated.status,
});
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
  const {
    callId,
    reason,
    durationSec,
    deviceId,
  } = req.body || {};

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

  /*
   * Once an ACTIVE call has a recorded physical winner,
   * only that winning callee installation may finalize it.
   *
   * Caller authority remains unchanged.
   * Pre-answer decline/missed behavior remains unchanged.
   */
  if (
    isNonAuthoritativeActiveCalleeDevice({
      call,
      userId,
      deviceId,
    })
  ) {
    console.log(
      '[calls/end] ignored non-authoritative callee device',
      {
        callId: call.id,
        userId,
        reportedDeviceId:
          String(deviceId || '').trim() || null,
        answeredDeviceId:
          call.answeredDeviceId,
      }
    );

    return res.json({
      ok: true,
      ignored: true,
      code: 'CALL_NOT_AUTHORITATIVE_DEVICE',
    });
  }

  let status = 'ENDED';
  if (reason === 'declined') status = 'DECLINED';
  else if (reason === 'missed') status = 'MISSED';
  else if (reason === 'failed') status = 'FAILED';

  const endedAt = new Date();

  const finalization = await prisma.call.updateMany({
    where: {
      id: call.id,
      status: { notIn: TERMINAL_CALL_STATUSES },
    },
    data: {
      status,
      endedAt,
      durationSec: durationSec ?? undefined,
      endReason: reason ?? null,
    },
  });

  // A different client or reconciliation request already finalized the call.
  // Treat this retry as successful, but do not overwrite terminal fields or
  // emit duplicate call-ended events.
  if (finalization.count === 0) {
    return res.json({ ok: true });
  }

  const updated = await prisma.call.findUnique({
    where: { id: call.id },
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

  const notifyIds =
    collectCallLifecycleRecipientIds({
      callerId: updated.callerId,
      calleeId: updated.calleeId,
      participants: call.participants,
    });

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

  for (const id of notifyIds) {
    try {
      await sendPushToUser(id, {
        data: {
          type: 'call_ended',
          callId: updated.id,
          mode: call.mode,
          status: updated.status,
          reason: updated.endReason ?? '',
        },
      });
    } catch (err) {
      console.warn(
        '[calls] failed to send terminal call push after /calls/end',
        {
          callId: updated.id,
          userId: id,
          error: err?.message || err,
        }
      );
    }
  }

  console.log('[calls/end] finalized call', {
    callId: updated.id,
    status: updated.status,
    endedBy: userId,
    notified: Array.from(notifyIds),
  });

  res.json({ ok: true });
}));

/**
 * GET /calls/:id/status
 * Lightweight lifecycle lookup used to reject stale incoming-call pushes.
 */
router.get('/:id/status', asyncHandler(async (req, res) => {
  const userId = Number(req.user.id);
  const callId = Number(req.params.id);

  if (!Number.isFinite(callId) || callId <= 0) {
    return res.status(400).json({ error: 'Invalid call id' });
  }

  const call = await prisma.call.findUnique({
    where: { id: callId },
    include: { participants: true },
  });

  if (!call) {
    return res.status(404).json({ error: 'Call not found' });
  }

  if (!(await ensureParticipant(call, userId))) {
    return res.status(403).json({ error: 'Not a participant' });
  }

  return res.json({
    call: {
      id: call.id,
      mode: call.mode,
      status: call.status,
      endReason: call.endReason,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
    },
  });
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
    deviceId,
  } = req.body || {};

  const call = await prisma.call.findUnique({
    where: { id: callId },
    include: { participants: true },
  });

  if (!call) return res.status(404).json({ error: 'Call not found' });

  if (!(await ensureParticipant(call, userId))) {
    return res.status(403).json({ error: 'Not a participant' });
  }

  const normalizedStatus =
    status == null ? null : String(status).toUpperCase();

  const normalizedEndReason =
    endReason == null
      ? null
      : String(endReason).trim().toLowerCase();

  /*
   * If the physical device that already won retries ACTIVE,
   * treat the request as idempotent. The original HTTP response
   * may have been lost after the database transition committed.
   */
  if (
    normalizedStatus === 'ACTIVE' &&
    call.status === 'ACTIVE' &&
    userId === call.calleeId &&
    call.answeredDeviceId &&
    String(deviceId || '').trim() ===
      String(call.answeredDeviceId).trim()
  ) {
    return res.json({
      call: {
        id: call.id,
        callerId: call.callerId,
        calleeId: call.calleeId,
        mode: call.mode,
        status: call.status,
        startedAt: call.startedAt,
        endedAt: call.endedAt,
        durationSec: call.durationSec,
        endReason: call.endReason,
        twilioCallSid: call.twilioCallSid,
        answeredDeviceId:
          call.answeredDeviceId,
        answeredVoiceIdentity:
          call.answeredVoiceIdentity,
      },
    });
  }

  /*
   * A different physical callee device cannot claim an
   * already-ACTIVE call that has a recorded winner.
   */
  if (
    normalizedStatus === 'ACTIVE' &&
    call.status === 'ACTIVE' &&
    userId === call.calleeId &&
    call.answeredDeviceId
  ) {
    return res.status(409).json({
      error:
        'This call was answered on another device.',
      code: 'CALL_ANSWERED_ELSEWHERE',
      callId,
      status: call.status,
    });
  }

  let answeringDevice = null;

  /*
   * Supported mobile clients supply their stable installation
   * deviceId. Validate it against the same server-side Voice
   * authority used for Twilio fan-out.
   *
   * deviceId remains optional temporarily for rollout
   * compatibility with existing clients.
   */
  if (
    normalizedStatus === 'ACTIVE' &&
    call.mode === 'AUDIO' &&
    userId === call.calleeId &&
    deviceId != null
  ) {
    answeringDevice =
      await resolveEligibleVoiceDevice(
        userId,
        deviceId
      );

    if (!answeringDevice) {
      return res.status(409).json({
        error:
          'This device is not eligible to answer this call.',
        code: 'CALL_DEVICE_NOT_ELIGIBLE',
        callId,
      });
    }
  }

  /*
   * After a physical winner exists, a losing callee device may
   * clean up its local leg but cannot terminate the canonical
   * ACTIVE call. Caller authority is intentionally unaffected.
   */
  if (
    isTerminalCallStatus(normalizedStatus) &&
    isNonAuthoritativeActiveCalleeDevice({
      call,
      userId,
      deviceId,
    })
  ) {
    console.log(
      '[calls/status] ignored non-authoritative callee device',
      {
        callId,
        reportedBy: userId,
        reportedDeviceId:
          String(deviceId || '').trim() || null,
        answeredDeviceId:
          call.answeredDeviceId,
        reportedStatus: normalizedStatus,
        reportedEndReason:
          normalizedEndReason,
      }
    );

    return res.json({
      call: {
        id: call.id,
        callerId: call.callerId,
        calleeId: call.calleeId,
        mode: call.mode,
        status: call.status,
        startedAt: call.startedAt,
        endedAt: call.endedAt,
        durationSec: call.durationSec,
        endReason: call.endReason,
        twilioCallSid: call.twilioCallSid,
        answeredDeviceId:
          call.answeredDeviceId,
        answeredVoiceIdentity:
          call.answeredVoiceIdentity,
      },
    });
  }

  const isRemoteEndedAcknowledgement =
    isTerminalCallStatus(normalizedStatus) &&
    normalizedEndReason === 'remote_ended';

  const isActiveCalleeLosingLegFailure =
    call.status === 'ACTIVE' &&
    userId === call.calleeId &&
    normalizedStatus === 'FAILED' &&
    normalizedEndReason === 'no incoming call to answer.';

  // These reports describe local device cleanup rather than an authoritative
  // account-level terminal transition.
  //
  // In a multi-device call, one callee device can successfully answer while
  // another device loses its local Twilio incoming leg. That losing device
  // must not be allowed to terminate the already-ACTIVE canonical call.
  if (
    isRemoteEndedAcknowledgement ||
    isActiveCalleeLosingLegFailure
  ) {
    console.log(
      '[calls/status] ignored non-authoritative device lifecycle acknowledgement',
      {
        callId,
        reportedBy: userId,
        reportedStatus: normalizedStatus,
        reportedEndReason: normalizedEndReason,
        authoritativeStatus: call.status,
        reason:
          isActiveCalleeLosingLegFailure
            ? 'losing_device_leg'
            : 'remote_ended',
      }
    );

    const authoritative = await prisma.call.findUnique({
      where: {
        id: callId,
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

    return res.json({
      call: authoritative,
    });
  }

  const updateData = {
    status: normalizedStatus ?? undefined,
    startedAt:
      startedAt
        ? new Date(startedAt)
        : normalizedStatus === 'ACTIVE'
          ? new Date()
          : undefined,
    endedAt: endedAt ? new Date(endedAt) : undefined,
    durationSec: durationSec ?? undefined,
    endReason: endReason ?? undefined,
    answeredDeviceId:
      normalizedStatus === 'ACTIVE' &&
      call.mode === 'AUDIO' &&
      answeringDevice
        ? answeringDevice.deviceId
        : undefined,
    answeredVoiceIdentity:
      normalizedStatus === 'ACTIVE' &&
      call.mode === 'AUDIO' &&
      answeringDevice
        ? answeringDevice.voiceIdentity
        : undefined,
  };

  if (twilioCallSid) {
    const existingSidOwner = await prisma.call.findUnique({
      where: { twilioCallSid },
      select: { id: true },
    });

    if (!existingSidOwner || existingSidOwner.id === call.id) {
      updateData.twilioCallSid = twilioCallSid;
    } else {
      console.warn('[calls/status] twilioCallSid already belongs to another call', {
        requestedCallId: call.id,
        existingCallId: existingSidOwner.id,
        twilioCallSid,
      });
    }
  }

  const lifecycleWhere =
  normalizedStatus === 'ACTIVE'
    ? {
        id: callId,
        status: {
          in: [
            'RINGING',
            'INITIATED',
          ],
        },
      }
    : {
        id: callId,
        status: {
          notIn: TERMINAL_CALL_STATUSES,
        },
      };

const lifecycleUpdate =
  await prisma.call.updateMany({
    where: lifecycleWhere,
    data: updateData,
  });

  const updated = await prisma.call.findUnique({
    where: { id: callId },
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
      answeredDeviceId: true,
      answeredVoiceIdentity: true,
    },
  });

  if (
  normalizedStatus === 'ACTIVE' &&
  lifecycleUpdate.count !== 1
) {
  return res.status(409).json({
    error:
      updated?.status === 'ACTIVE'
        ? 'This call was answered on another device.'
        : `Cannot answer in status ${updated?.status || 'UNKNOWN'}`,
    code:
      updated?.status === 'ACTIVE'
        ? 'CALL_ANSWERED_ELSEWHERE'
        : 'CALL_NOT_ANSWERABLE',
    callId,
    status: updated?.status || null,
  });
}

if (
  normalizedStatus === 'ACTIVE' &&
  lifecycleUpdate.count === 1
) {
  await notifyAnsweredElsewhere(updated);
}

if (lifecycleUpdate.count === 1 && isTerminalCallStatus(normalizedStatus)) {
    const notifyIds =
      collectCallLifecycleRecipientIds({
        callerId: updated.callerId,
        calleeId: updated.calleeId,
        participants: call.participants,
      });

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

    for (const id of notifyIds) {
      try {
        await sendPushToUser(id, {
          data: {
            type: 'call_ended',
            callId: updated.id,
            mode: updated.mode,
            status: updated.status,
            reason: updated.endReason ?? '',
          },
        });
      } catch (err) {
        console.warn(
          '[calls] failed to send terminal call push after status patch',
          {
            callId: updated.id,
            userId: id,
            error: err?.message || err,
          }
        );
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
    /*
     * Inbound PSTN callers do not have Chatforia User rows. The assigned
     * Chatforia user occupies callerId for ownership, while fromLabel and
     * externalPhone identify the actual external caller.
     */
    const isExternalInbound =
      call.calleeId == null &&
      Boolean(call.externalPhone) &&
      call.fromLabel === call.externalPhone;

    const isOutgoing =
      !isExternalInbound &&
      call.callerId === userId;

    const otherUser =
      isExternalInbound
        ? null
        : isOutgoing
          ? call.callee
          : call.caller;

    return {
      ...call,
      direction: isOutgoing ? 'OUTGOING' : 'INCOMING',
      displayName:
        (isExternalInbound ? call.externalPhone : null) ||
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