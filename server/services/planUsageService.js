import prisma from '../utils/prismaClient.js';
import { getPlanEntitlements } from '../config/planEntitlements.js';

const METER_TO_LIMIT_KEY = Object.freeze({
  riaActions: 'riaActions',
  translationChars: 'translationChars',
  hostedParticipantSeconds: 'hostedParticipantMinutes',
  smsMessages: 'smsMessages',
  pstnSeconds: 'pstnMinutes',
  forwardingSeconds: 'forwardingMinutes',
  voicemailTranscriptionSeconds: 'voicemailTranscriptionMinutes',
});

const SECOND_BASED_METERS = new Set([
  'hostedParticipantSeconds',
  'pstnSeconds',
  'forwardingSeconds',
  'voicemailTranscriptionSeconds',
]);

export function getMonthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

export function getMeterLimit(entitlements, meter) {
  const entitlementKey = METER_TO_LIMIT_KEY[meter];

  if (!entitlementKey) {
    throw new Error(`Unknown usage meter: ${meter}`);
  }

  const rawLimit = entitlements[entitlementKey];

  if (rawLimit == null) return null;

  return SECOND_BASED_METERS.has(meter)
    ? rawLimit * 60
    : rawLimit;
}

export async function getPlanUsage(userId, date = new Date()) {
  const monthKey = getMonthKey(date);

  return prisma.planUsage.upsert({
    where: {
      userId_monthKey: {
        userId: Number(userId),
        monthKey,
      },
    },
    update: {},
    create: {
      userId: Number(userId),
      monthKey,
    },
  });
}

export async function getUsageSummary(userId, plan, date = new Date()) {
  const usage = await getPlanUsage(userId, date);
  const entitlements = getPlanEntitlements(plan);

  const meters = {};

  for (const meter of Object.keys(METER_TO_LIMIT_KEY)) {
    const used = usage[meter] ?? 0;
    const limit = getMeterLimit(entitlements, meter);

    meters[meter] = {
      used,
      limit,
      remaining: limit == null ? null : Math.max(0, limit - used),
    };
  }

  return {
    plan,
    monthKey: usage.monthKey,
    entitlements,
    usage: meters,
  };
}

const VALID_METERS = new Set(Object.keys(METER_TO_LIMIT_KEY));

function assertValidMeter(meter) {
  if (!VALID_METERS.has(meter)) {
    throw new Error(`Unknown usage meter: ${meter}`);
  }
}

export async function assertAndConsumeUsage({
  userId,
  plan,
  meter,
  amount = 1,
  date = new Date(),
}) {
  const normalizedAmount = Math.floor(Number(amount));

  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw new Error('Usage amount must be a positive integer');
  }

  assertValidMeter(meter);

  const entitlements = getPlanEntitlements(plan);
  const limit = getMeterLimit(entitlements, meter);

  if (limit == null) {
    return {
      allowed: true,
      limit: null,
      used: null,
      remaining: null,
    };
  }

  const monthKey = getMonthKey(date);

  return prisma.$transaction(async (tx) => {
    await tx.planUsage.upsert({
      where: {
        userId_monthKey: {
          userId: Number(userId),
          monthKey,
        },
      },
      update: {},
      create: {
        userId: Number(userId),
        monthKey,
      },
    });

    const result = await tx.$executeRawUnsafe(
      `
      UPDATE "PlanUsage"
      SET "${meter}" = "${meter}" + $1,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "userId" = $2
        AND "monthKey" = $3
        AND "${meter}" + $1 <= $4
      `,
      normalizedAmount,
      Number(userId),
      monthKey,
      limit,
    );

    if (result !== 1) {
      const current = await tx.planUsage.findUnique({
        where: {
          userId_monthKey: {
            userId: Number(userId),
            monthKey,
          },
        },
      });

      const used = current?.[meter] ?? 0;

      const err = new Error('Plan allowance exceeded');
      err.status = 429;
      err.code = 'PLAN_ALLOWANCE_EXCEEDED';
      err.detail = meter;
      err.limit = limit;
      err.used = used;
      err.remaining = Math.max(0, limit - used);
      throw err;
    }

    const current = await tx.planUsage.findUnique({
      where: {
        userId_monthKey: {
          userId: Number(userId),
          monthKey,
        },
      },
    });

    const used = current?.[meter] ?? 0;

    return {
      allowed: true,
      limit,
      used,
      remaining: Math.max(0, limit - used),
    };
  });
}

export async function releaseUsage({
  userId,
  meter,
  amount = 1,
  date = new Date(),
}) {
  const normalizedAmount = Math.floor(Number(amount));

  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw new Error('Usage amount must be a positive integer');
  }

  assertValidMeter(meter);

  const monthKey = getMonthKey(date);

  await prisma.$executeRawUnsafe(
    `
    UPDATE "PlanUsage"
    SET "${meter}" = GREATEST("${meter}" - $1, 0),
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "userId" = $2
      AND "monthKey" = $3
    `,
    normalizedAmount,
    Number(userId),
    monthKey,
  );
}