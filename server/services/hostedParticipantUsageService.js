import prisma from '../utils/prismaClient.js';
import { assertAndConsumeUsage } from './planUsageService.js';

function positiveDurationSeconds(joinedAt, leftAt) {
  const start = joinedAt instanceof Date ? joinedAt : new Date(joinedAt);
  const end = leftAt instanceof Date ? leftAt : new Date(leftAt);

  const startMs = start.getTime();
  const endMs = end.getTime();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 0;
  }

  return Math.max(1, Math.ceil((endMs - startMs) / 1000));
}

function hostedEventKey({ callId, participantId, joinedAt }) {
  const start = joinedAt instanceof Date ? joinedAt : new Date(joinedAt);
  return [
    'hosted',
    Number(callId),
    Number(participantId),
    start.toISOString(),
  ].join(':');
}

async function currentPlan(userId) {
  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: { plan: true },
  });

  return user?.plan || 'FREE';
}

/**
 * Charge one actual hosted-participant session exactly once.
 *
 * A participant may leave and later rejoin the same Call. joinedAt is part of
 * the durable event key, so each distinct joined session can be charged once
 * without double-counting webhook/client retries.
 */
export async function chargeHostedParticipantSessionOnce({
  callId,
  participantId,
  participantUserId,
  hostUserId,
  joinedAt,
  leftAt,
}) {
  const seconds = positiveDurationSeconds(joinedAt, leftAt);

  if (!seconds) {
    return { charged: false, seconds: 0, reason: 'zero-duration' };
  }

  const eventKey = hostedEventKey({
    callId,
    participantId,
    joinedAt,
  });

  try {
    await prisma.voiceUsageCharge.create({
      data: {
        eventKey,
        userId: Number(hostUserId),
        meter: 'hostedParticipantSeconds',
        seconds,
      },
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      return {
        charged: false,
        seconds: 0,
        reason: 'already-charged',
      };
    }
    throw error;
  }

  try {
    const plan = await currentPlan(hostUserId);

    await assertAndConsumeUsage({
      userId: Number(hostUserId),
      plan,
      meter: 'hostedParticipantSeconds',
      amount: seconds,
    });

    return {
      charged: true,
      seconds,
      participantUserId: Number(participantUserId),
    };
  } catch (error) {
    // Let a legitimate retry attempt the usage write again.
    await prisma.voiceUsageCharge.deleteMany({
      where: { eventKey },
    });
    throw error;
  }
}

/**
 * Finalize every still-connected participant for an app-hosted AUDIO/VIDEO call.
 * PSTN calls are explicitly excluded because those are metered separately.
 */
export async function closeAndChargeHostedParticipantsForCall({
  callId,
  endedAt = new Date(),
}) {
  const call = await prisma.call.findUnique({
    where: { id: Number(callId) },
    select: {
      id: true,
      callerId: true,
      externalPhone: true,
      participants: {
        where: {
          status: 'JOINED',
          joinedAt: { not: null },
          leftAt: null,
        },
        select: {
          id: true,
          userId: true,
          joinedAt: true,
          leftAt: true,
          status: true,
        },
      },
    },
  });

  if (!call) {
    return { skipped: true, reason: 'call-not-found', chargedSeconds: 0 };
  }

  if (call.externalPhone) {
    return { skipped: true, reason: 'pstn-call', chargedSeconds: 0 };
  }

  let chargedSeconds = 0;
  let finalizedParticipants = 0;

  for (const participant of call.participants || []) {
    const claim = await prisma.callParticipant.updateMany({
      where: {
        id: participant.id,
        status: 'JOINED',
        leftAt: null,
      },
      data: {
        status: 'LEFT',
        leftAt: endedAt,
      },
    });

    if (claim.count !== 1) {
      continue;
    }

    finalizedParticipants += 1;

    try {
      const result = await chargeHostedParticipantSessionOnce({
        callId: call.id,
        participantId: participant.id,
        participantUserId: participant.userId,
        hostUserId: call.callerId,
        joinedAt: participant.joinedAt,
        leftAt: endedAt,
      });

      chargedSeconds += result?.seconds || 0;
    } catch (error) {
      // Call lifecycle finalization must not fail because usage accounting failed.
      console.error('[hostedParticipantUsage] participant charge failed', {
        callId: call.id,
        participantId: participant.id,
        participantUserId: participant.userId,
        hostUserId: call.callerId,
        code: error?.code || null,
        message: error?.message || String(error),
      });
    }
  }

  return {
    skipped: false,
    finalizedParticipants,
    chargedSeconds,
  };
}
