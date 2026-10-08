import prisma from '../utils/prismaClient.js';
import {
  assertAndConsumeUsage,
  releaseUsage,
} from './planUsageService.js';

function normalizePositiveSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(0, Math.round(n));
}

async function currentUserPlan(userId) {
  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: { plan: true },
  });
  return user?.plan || 'FREE';
}

/**
 * Charge a canonical Call row exactly once for PSTN duration.
 *
 * We first atomically claim the uncharged seconds on the Call row. Only the
 * process that successfully increases pstnUsageChargedSec consumes allowance.
 * If allowance consumption fails, the claimed delta is rolled back.
 */
export async function chargePstnCallDurationOnce({
  callId,
  userId,
  durationSec,
}) {
  const seconds = normalizePositiveSeconds(durationSec);
  if (!seconds) {
    return { charged: false, seconds: 0, reason: 'zero-duration' };
  }

  const call = await prisma.call.findUnique({
    where: { id: Number(callId) },
    select: {
      id: true,
      callerId: true,
      pstnUsageChargedSec: true,
    },
  });

  if (!call || call.callerId !== Number(userId)) {
    return { charged: false, seconds: 0, reason: 'call-not-found' };
  }

  const already = Math.max(0, Number(call.pstnUsageChargedSec || 0));
  const delta = Math.max(0, seconds - already);

  if (!delta) {
    return { charged: false, seconds: 0, reason: 'already-charged' };
  }

  const claim = await prisma.call.updateMany({
    where: {
      id: call.id,
      pstnUsageChargedSec: already,
    },
    data: {
      pstnUsageChargedSec: seconds,
    },
  });

  if (claim.count !== 1) {
    return { charged: false, seconds: 0, reason: 'concurrent-or-duplicate' };
  }

  try {
    const plan = await currentUserPlan(userId);
    await assertAndConsumeUsage({
      userId: Number(userId),
      plan,
      meter: 'pstnSeconds',
      amount: delta,
    });
    return { charged: true, seconds: delta };
  } catch (error) {
    await prisma.call.updateMany({
      where: {
        id: call.id,
        pstnUsageChargedSec: seconds,
      },
      data: {
        pstnUsageChargedSec: already,
      },
    });
    throw error;
  }
}

/**
 * Charge an external forwarding leg exactly once.
 *
 * The unique event key is based on Twilio's DialCallSid whenever available.
 * We create the ledger row first so webhook retries cannot double-charge.
 * If allowance consumption fails, the claim is removed so a legitimate retry
 * can try again.
 */
export async function chargeForwardingDurationOnce({
  eventKey,
  userId,
  durationSec,
}) {
  const seconds = normalizePositiveSeconds(durationSec);
  if (!seconds) {
    return { charged: false, seconds: 0, reason: 'zero-duration' };
  }

  const key = String(eventKey || '').trim();
  if (!key) {
    return { charged: false, seconds: 0, reason: 'missing-event-key' };
  }

  try {
    await prisma.voiceUsageCharge.create({
      data: {
        eventKey: key,
        userId: Number(userId),
        meter: 'forwardingSeconds',
        seconds,
      },
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      return { charged: false, seconds: 0, reason: 'already-charged' };
    }
    throw error;
  }

  try {
    const plan = await currentUserPlan(userId);
    await assertAndConsumeUsage({
      userId: Number(userId),
      plan,
      meter: 'forwardingSeconds',
      amount: seconds,
    });
    return { charged: true, seconds };
  } catch (error) {
    await prisma.voiceUsageCharge.deleteMany({
      where: { eventKey: key },
    });
    throw error;
  }
}
