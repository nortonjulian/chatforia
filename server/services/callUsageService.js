import prisma from '../utils/prismaClient.js';
import {
  assertAndConsumeUsage,
  releaseUsage,
  getMonthKey,
  getMeterLimit,
  getUsageSummary,
} from './planUsageService.js';
import { getPlanEntitlements } from '../config/planEntitlements.js';

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


function allowanceExceededError({ meter, limit, used }) {
  const err = new Error('Plan allowance exceeded');
  err.status = 429;
  err.code = 'PLAN_ALLOWANCE_EXCEEDED';
  err.detail = meter;
  err.limit = limit;
  err.used = used;
  err.remaining = Math.max(0, limit - used);
  return err;
}

function normalizeReservationToken(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .slice(0, 180);
}

const RESERVABLE_VOICE_METERS = new Set([
  'pstnSeconds',
  'forwardingSeconds',
]);

function parseReservationEventKey(eventKey) {
  const match = String(eventKey || '').match(
    /^reservation:([0-9]{4}-[0-9]{2}):([^:]+):(.+)$/,
  );

  if (!match) return null;

  const meter = match[2];

  if (!RESERVABLE_VOICE_METERS.has(meter)) {
    return null;
  }

  return {
    monthKey: match[1],
    meter,
    token: match[3],
  };
}

export async function getUsageAvailability({
  userId,
  meter,
  date = new Date(),
}) {
  const plan = await currentUserPlan(userId);
  const summary = await getUsageSummary(Number(userId), plan, date);
  const usage = summary?.usage?.[meter];

  if (!usage) {
    throw new Error(`Unknown usage meter: ${meter}`);
  }

  return {
    plan,
    meter,
    monthKey: summary.monthKey,
    ...usage,
  };
}

export async function reserveRemainingUsage({
  userId,
  meter,
  reservationId,
  date = new Date(),
}) {
  const uid = Number(userId);
  const token = normalizeReservationToken(reservationId);

  if (!Number.isInteger(uid) || uid <= 0) {
    throw new Error('Valid userId required');
  }

  if (!token) {
    throw new Error('reservationId required');
  }

  const plan = await currentUserPlan(uid);
  const entitlements = getPlanEntitlements(plan);
  const limit = getMeterLimit(entitlements, meter);
  const monthKey = getMonthKey(date);

  if (limit == null) {
    return {
      reserved: false,
      unlimited: true,
      eventKey: null,
      seconds: null,
      meter,
      monthKey,
      plan,
    };
  }

  const eventKey = `reservation:${monthKey}:${meter}:${token}`;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.voiceUsageCharge.findUnique({
      where: { eventKey },
    });

    if (existing) {
      return {
        reserved: true,
        duplicate: true,
        eventKey,
        seconds: Number(existing.seconds || 0),
        meter,
        monthKey,
        plan,
        limit,
      };
    }

    await tx.planUsage.upsert({
      where: {
        userId_monthKey: {
          userId: uid,
          monthKey,
        },
      },
      update: {},
      create: {
        userId: uid,
        monthKey,
      },
    });

    const rows = await tx.$queryRawUnsafe(
      `
        SELECT "${meter}" AS "used"
        FROM "PlanUsage"
        WHERE "userId" = $1
          AND "monthKey" = $2
        FOR UPDATE
      `,
      uid,
      monthKey,
    );

    const used = Number(rows?.[0]?.used ?? 0);
    const remaining = Math.max(0, Number(limit) - used);

    if (remaining <= 0) {
      throw allowanceExceededError({
        meter,
        limit: Number(limit),
        used,
      });
    }

    await tx.planUsage.update({
      where: {
        userId_monthKey: {
          userId: uid,
          monthKey,
        },
      },
      data: {
        [meter]: Number(limit),
      },
    });

    await tx.voiceUsageCharge.create({
      data: {
        eventKey,
        userId: uid,
        meter,
        seconds: remaining,
      },
    });

    return {
      reserved: true,
      duplicate: false,
      eventKey,
      seconds: remaining,
      meter,
      monthKey,
      plan,
      limit: Number(limit),
      usedBeforeReservation: used,
    };
  });
}

export async function finalizeUsageReservation({
  eventKey,
  actualSeconds = 0,
}) {
  const key = String(eventKey || '').trim();
  const parsed = parseReservationEventKey(key);

  if (!parsed) {
    return {
      finalized: false,
      reason: 'invalid-reservation-key',
    };
  }

  const normalizedActual = Math.max(
    0,
    Math.floor(Number(actualSeconds) || 0),
  );

  const finalEventKey = `final:${key}`;

  return prisma.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRawUnsafe(
      `
        SELECT "eventKey", "userId", "meter", "seconds"
        FROM "VoiceUsageCharge"
        WHERE "eventKey" = $1
        FOR UPDATE
      `,
      key,
    );

    const reservation = lockedRows?.[0] || null;

    if (!reservation) {
      const existingFinal = await tx.voiceUsageCharge.findUnique({
        where: { eventKey: finalEventKey },
      });

      if (existingFinal) {
        return {
          finalized: true,
          duplicate: true,
          eventKey: finalEventKey,
          actualSeconds: Number(existingFinal.seconds || 0),
          releasedSeconds: 0,
        };
      }

      return {
        finalized: false,
        reason: 'reservation-not-found',
      };
    }

    const reservedSeconds = Math.max(
      0,
      Number(reservation.seconds || 0),
    );

    const chargedSeconds = Math.min(
      reservedSeconds,
      normalizedActual,
    );

    const releasedSeconds = Math.max(
      0,
      reservedSeconds - chargedSeconds,
    );

    if (releasedSeconds > 0) {
      await tx.$executeRawUnsafe(
        `
          UPDATE "PlanUsage"
          SET "${parsed.meter}" = GREATEST("${parsed.meter}" - $1, 0),
              "updatedAt" = CURRENT_TIMESTAMP
          WHERE "userId" = $2
            AND "monthKey" = $3
        `,
        releasedSeconds,
        Number(reservation.userId),
        parsed.monthKey,
      );
    }

    await tx.voiceUsageCharge.create({
      data: {
        eventKey: finalEventKey,
        userId: Number(reservation.userId),
        meter: parsed.meter,
        seconds: chargedSeconds,
      },
    });

    await tx.voiceUsageCharge.delete({
      where: { eventKey: key },
    });

    return {
      finalized: true,
      duplicate: false,
      eventKey: finalEventKey,
      reservedSeconds,
      actualSeconds: chargedSeconds,
      releasedSeconds,
      truncatedSeconds: Math.max(0, normalizedActual - chargedSeconds),
    };
  });
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
