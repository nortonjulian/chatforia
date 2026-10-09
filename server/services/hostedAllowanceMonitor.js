import twilio from 'twilio';
import prisma from '../utils/prismaClient.js';
import { emitToUser } from './socketBus.js';
import { getUsageAvailability } from './callUsageService.js';
import { closeAndChargeHostedParticipantsForCall } from './hostedParticipantUsageService.js';

const SWEEP_MS = 1000;
let sweepTimer = null;
let sweepRunning = false;

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function activeParticipantSeconds(participants, now = new Date()) {
  const end = validDate(now);
  if (!end) return 0;

  let total = 0;

  for (const participant of participants || []) {
    if (
      participant?.status !== 'JOINED' ||
      !participant?.joinedAt ||
      participant?.leftAt
    ) {
      continue;
    }

    const start = validDate(participant.joinedAt);
    if (!start) continue;

    const elapsedMs = end.getTime() - start.getTime();
    if (elapsedMs <= 0) continue;

    total += Math.max(1, Math.ceil(elapsedMs / 1000));
  }

  return total;
}

function twilioVideoClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;

  if (!accountSid || !apiKeySid || !apiKeySecret) {
    return null;
  }

  return twilio(apiKeySid, apiKeySecret, { accountSid });
}

async function completeTwilioVideoRoom(callId) {
  const client = twilioVideoClient();
  if (!client) {
    console.warn('[hostedAllowance] Twilio Video REST credentials unavailable', {
      callId: Number(callId),
    });
    return false;
  }

  const roomName = `call_${Number(callId)}`;

  try {
    await client.video.v1.rooms(roomName).update({ status: 'completed' });
    return true;
  } catch (error) {
    console.warn('[hostedAllowance] unable to complete Twilio Video room', {
      callId: Number(callId),
      roomName,
      code: error?.code || null,
      status: error?.status || null,
      message: error?.message || String(error),
    });
    return false;
  }
}

async function endHostedCallForAllowance(call, endedAt) {
  const claim = await prisma.call.updateMany({
    where: {
      id: call.id,
      externalPhone: null,
      status: 'ACTIVE',
    },
    data: {
      status: 'ENDED',
      endedAt,
      endReason: 'hosted_allowance_exhausted',
    },
  });

  if (claim.count !== 1) return false;

  if (String(call.mode || '').toUpperCase() === 'VIDEO') {
    await completeTwilioVideoRoom(call.id);
  }

  await closeAndChargeHostedParticipantsForCall({
    callId: call.id,
    endedAt,
  });

  const notifyIds = new Set([
    Number(call.callerId),
    ...(call.calleeId ? [Number(call.calleeId)] : []),
    ...(call.participants || []).map((participant) => Number(participant.userId)),
  ]);

  const payload = {
    callId: call.id,
    status: 'ENDED',
    endedAt,
    reason: 'hosted_allowance_exhausted',
    code: 'PLAN_ALLOWANCE_EXCEEDED',
    detail: 'hostedParticipantSeconds',
  };

  for (const userId of notifyIds) {
    if (Number.isInteger(userId) && userId > 0) {
      emitToUser(userId, 'call:ended', payload);
      if (String(call.mode || '').toUpperCase() === 'VIDEO') {
        emitToUser(userId, 'video:ended', payload);
      }
    }
  }

  return true;
}

export async function runHostedAllowanceSweep({ now = new Date() } = {}) {
  if (sweepRunning) {
    return { skipped: true, reason: 'sweep-already-running', endedCalls: 0 };
  }

  sweepRunning = true;

  try {
    const activeCalls = await prisma.call.findMany({
      where: {
        externalPhone: null,
        status: 'ACTIVE',
        mode: { in: ['AUDIO', 'VIDEO'] },
      },
      select: {
        id: true,
        callerId: true,
        calleeId: true,
        mode: true,
        participants: {
          where: {
            status: 'JOINED',
            joinedAt: { not: null },
            leftAt: null,
          },
          select: {
            id: true,
            userId: true,
            status: true,
            joinedAt: true,
            leftAt: true,
          },
        },
      },
    });

    if (!activeCalls.length) {
      return { skipped: false, endedCalls: 0, activeCalls: 0 };
    }

    const callsByHost = new Map();
    for (const call of activeCalls) {
      const hostUserId = Number(call.callerId);
      if (!callsByHost.has(hostUserId)) callsByHost.set(hostUserId, []);
      callsByHost.get(hostUserId).push(call);
    }

    let endedCalls = 0;

    for (const [hostUserId, hostCalls] of callsByHost.entries()) {
      const availability = await getUsageAvailability({
        userId: hostUserId,
        meter: 'hostedParticipantSeconds',
        date: now,
      });

      if (availability.remaining == null) continue;

      const liveSeconds = hostCalls.reduce(
        (sum, call) => sum + activeParticipantSeconds(call.participants, now),
        0,
      );

      if (liveSeconds < availability.remaining) continue;

      for (const call of hostCalls) {
        const ended = await endHostedCallForAllowance(call, now);
        if (ended) endedCalls += 1;
      }
    }

    return { skipped: false, endedCalls, activeCalls: activeCalls.length };
  } finally {
    sweepRunning = false;
  }
}

export function startHostedAllowanceMonitor() {
  if (sweepTimer || process.env.NODE_ENV === 'test') return sweepTimer;

  const startupTimer = setTimeout(() => {
    runHostedAllowanceSweep().catch((error) => {
      console.error('[hostedAllowance] startup sweep failed', {
        code: error?.code || null,
        message: error?.message || String(error),
      });
    });
  }, 1000);
  startupTimer.unref?.();

  sweepTimer = setInterval(() => {
    runHostedAllowanceSweep().catch((error) => {
      console.error('[hostedAllowance] sweep failed', {
        code: error?.code || null,
        message: error?.message || String(error),
      });
    });
  }, SWEEP_MS);

  sweepTimer.unref?.();
  return sweepTimer;
}

export function stopHostedAllowanceMonitor() {
  if (!sweepTimer) return;
  clearInterval(sweepTimer);
  sweepTimer = null;
}
