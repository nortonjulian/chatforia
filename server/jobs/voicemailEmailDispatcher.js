import { randomUUID } from 'node:crypto';

import prisma from '../utils/prismaClient.js';
import { sendVoicemailForwardEmail } from '../services/voicemailEmail.js';
import { voicemailForwardingDestination } from '../utils/voicemailForwarding.js';
import logger from '../utils/logger.js';

const MAX_ATTEMPTS = 5;
const LEASE_MS = 5 * 60 * 1000;
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

function dueWork(now) {
  return {
    attempts: { lt: MAX_ATTEMPTS },
    OR: [
      { status: 'PENDING', nextAttemptAt: { lte: now } },
      { status: 'PROCESSING', leaseUntil: { lte: now } },
    ],
  };
}

export async function dispatchVoicemailEmailOnce({ db = prisma, now = () => new Date(), send = sendVoicemailForwardEmail } = {}) {
  const clock = now();
  // A process can stop on its final attempt before it records the result.
  // Keep that exhausted lease visible for operator review rather than leaving
  // it stuck in PROCESSING forever or sending an unbounded extra attempt.
  await db.voicemailEmailDelivery.updateMany({
    where: { status: 'PROCESSING', attempts: { gte: MAX_ATTEMPTS }, leaseUntil: { lte: clock } },
    data: { status: 'FAILED', leaseId: null, leaseUntil: null, lastError: 'final_attempt_result_unknown' },
  });
  const candidates = await db.voicemailEmailDelivery.findMany({
    where: dueWork(clock),
    orderBy: { nextAttemptAt: 'asc' },
    take: 10,
    select: { voicemailId: true },
  });

  for (const candidate of candidates) {
    const leaseId = randomUUID();
    const claimTime = now();
    const claimed = await db.voicemailEmailDelivery.updateMany({
      where: { voicemailId: candidate.voicemailId, ...dueWork(claimTime) },
      data: {
        status: 'PROCESSING',
        attempts: { increment: 1 },
        leaseId,
        leaseUntil: new Date(claimTime.getTime() + LEASE_MS),
      },
    });
    if (claimed.count !== 1) continue;

    const work = await db.voicemailEmailDelivery.findUnique({
      where: { voicemailId: candidate.voicemailId },
      include: { voicemail: true },
    });
    if (!work || work.leaseId !== leaseId) continue;

    const user = await db.user.findUnique({
      where: { id: work.userId },
      select: { plan: true, voicemailForwardEmail: true, voicemailEmailForwardingEnabled: true },
    });
    const currentDestination = voicemailForwardingDestination(user);
    if (!work.voicemail || work.voicemail.userId !== work.userId || currentDestination !== work.recipient) {
      await db.voicemailEmailDelivery.updateMany({
        where: { voicemailId: work.voicemailId, leaseId, status: 'PROCESSING' },
        data: { status: 'SKIPPED', leaseId: null, leaseUntil: null, lastError: 'preference_or_owner_changed' },
      });
      continue;
    }

    let sent = false;
    try {
      sent = await send({
        voicemailId: work.voicemailId,
        toEmail: work.recipient,
        fromNumber: work.voicemail.fromNumber,
        fromDisplayName: work.fromDisplayName,
        toNumber: work.voicemail.toNumber,
        transcript: null,
        audioUrl: work.voicemail.audioUrl,
        durationSec: work.voicemail.durationSec,
        createdAt: work.voicemail.createdAt,
      }) === true;
    } catch (error) {
      logger.error({ err: error, voicemailId: work.voicemailId }, 'Voicemail email provider call failed');
    }

    if (sent) {
      // If the provider accepted the mail but this transaction fails or the
      // process stops, the expired lease may retry. This is at-least-once.
      await db.$transaction(async (tx) => {
        const updated = await tx.voicemailEmailDelivery.updateMany({
          where: { voicemailId: work.voicemailId, leaseId, status: 'PROCESSING' },
          data: { status: 'SENT', sentAt: now(), leaseId: null, leaseUntil: null, lastError: null },
        });
        if (updated.count !== 1) throw new Error('Voicemail email lease lost before recording success');
        await tx.voicemail.updateMany({
          where: { id: work.voicemailId, userId: work.userId, forwardedToEmailAt: null },
          data: { forwardedToEmailAt: now() },
        });
      });
      continue;
    }

    const exhausted = work.attempts >= MAX_ATTEMPTS;
    await db.voicemailEmailDelivery.updateMany({
      where: { voicemailId: work.voicemailId, leaseId, status: 'PROCESSING' },
      data: {
        status: exhausted ? 'FAILED' : 'PENDING',
        nextAttemptAt: new Date(now().getTime() + (BACKOFF_MS[work.attempts - 1] || BACKOFF_MS.at(-1))),
        leaseId: null,
        leaseUntil: null,
        lastError: 'provider_not_confirmed',
      },
    });
  }
}

export function startVoicemailEmailDispatcher({ intervalMs = 5000 } = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await dispatchVoicemailEmailOnce();
    } catch (error) {
      logger.error({ err: error }, 'Voicemail email dispatcher failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  void tick();
  return { stop: () => clearInterval(timer), tick };
}
