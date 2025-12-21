import Boom from '@hapi/boom';
import prisma from '../utils/prismaClient.js';
import { normalizeE164, isE164 } from '../utils/phone.js';
import { sendSms } from '../lib/telco/index.js';

/**
 * Get the user's current active number (TextNow-style lease model):
 * - Look up the PhoneNumber row assigned to the user
 * - status must be ASSIGNED or HOLD
 */
async function getUserActiveDid(userId) {
  const num = await prisma.phoneNumber.findFirst({
    where: {
      assignedUserId: Number(userId),
      status: { in: ['ASSIGNED', 'HOLD'] },
    },
    select: { id: true, e164: true, status: true },
    orderBy: { assignedAt: 'desc' },
  });

  if (!num?.e164) {
    const err = Boom.preconditionFailed('No assigned number for user');
    // frontend expects this to trigger NumberPickerModal
    err.output.payload.code = 'NO_NUMBER';
    throw err;
  }

  return { id: num.id, e164: normalizeE164(num.e164) };
}

async function upsertThread(userId, contactPhone) {
  const phone = normalizeE164(contactPhone);
  if (!isE164(phone)) throw Boom.badRequest('Invalid destination phone');

  let thread = await prisma.smsThread.findFirst({
    where: { userId: Number(userId), contactPhone: phone },
  });

  if (!thread) {
    thread = await prisma.smsThread.create({
      data: { userId: Number(userId), contactPhone: phone },
    });
  }

  return thread;
}

async function assertUserOwnsFromNumber(userId, from) {
  const e164 = normalizeE164(from);
  if (!isE164(e164)) throw Boom.badRequest('Invalid from number');

  const owns = await prisma.phoneNumber.findFirst({
    where: {
      assignedUserId: Number(userId),
      e164,
      status: { in: ['ASSIGNED', 'HOLD'] },
    },
    select: { id: true, e164: true },
  });

  if (!owns) throw Boom.forbidden('from number is not assigned to this user');
  return normalizeE164(owns.e164);
}

/**
 * OUTBOUND SMS/MMS
 */
export async function sendUserSms({ userId, to, body, from, mediaUrls }) {
  const uid = Number(userId);

  const toPhone = normalizeE164(to);
  if (!isE164(toPhone)) throw Boom.badRequest('Invalid destination phone');

  const safeBody = String(body ?? '').trim();
  const safeMediaUrls = Array.isArray(mediaUrls) ? mediaUrls.filter(Boolean) : [];

  if (!safeBody && safeMediaUrls.length === 0) {
    throw Boom.badRequest('body or mediaUrls required');
  }

  // If UI passes a specific DID, verify the user owns it; otherwise use current leased DID.
  const fromNumber = from
    ? await assertUserOwnsFromNumber(uid, from)
    : (await getUserActiveDid(uid)).e164;

  const thread = await upsertThread(uid, toPhone);
  const clientRef = `smsout:${uid}:${Date.now()}`;

  console.log('[smsService] sending', {
    userId: uid,
    to: toPhone,
    fromNumber,
    bodyLen: safeBody.length,
    mediaCount: safeMediaUrls.length,
  });

  const result = await sendSms({
    to: toPhone,
    text: safeBody,
    clientRef,
    from: fromNumber,
    mediaUrls: safeMediaUrls, // ✅ MMS
  });

  const provider = result?.provider || 'twilio';

  await prisma.$transaction(async (tx) => {
    await tx.smsMessage.create({
      data: {
        threadId: thread.id,
        direction: 'out',
        fromNumber,
        toNumber: toPhone,
        body: safeBody,
        provider,
        providerMessageId: result?.messageSid || result?.messageId || null,
        mediaUrls: safeMediaUrls.length ? safeMediaUrls : null,
      },
});

    await tx.phoneNumber.updateMany({
      where: {
        assignedUserId: uid,
        e164: fromNumber,
        status: { in: ['ASSIGNED', 'HOLD'] },
      },
      data: { lastOutboundAt: new Date() },
    });

    // updatedAt is @updatedAt, but we can still touch it explicitly if desired
    await tx.smsThread.update({
      where: { id: thread.id },
      data: { updatedAt: new Date() },
    });
  });

  return {
    ok: true,
    threadId: thread.id,
    provider,
    messageSid: result?.messageSid || null,
    clientRef: result?.clientRef || null,
  };
}

/**
 * INBOUND SMS (called by webhook handler)
 */
export async function recordInboundSms({
  toNumber,
  fromNumber,
  body,
  provider,
  providerMessageId,
  mediaUrls,
}) {
  const toE164 = normalizeE164(toNumber);
  const fromE164 = normalizeE164(fromNumber);

  if (!isE164(toE164) || !isE164(fromE164)) {
    return { ok: false, reason: 'invalid-e164' };
  }

  const owner = await prisma.phoneNumber.findFirst({
    where: {
      e164: toE164,
      status: { in: ['ASSIGNED', 'HOLD'] },
      assignedUserId: { not: null },
    },
    select: { assignedUserId: true },
  });

  if (!owner?.assignedUserId) return { ok: false, reason: 'no-owner' };

  const safeBody = String(body ?? '').trim();
  const safeMediaUrls = Array.isArray(mediaUrls) ? mediaUrls.filter(Boolean) : [];

  const thread = await upsertThread(owner.assignedUserId, fromE164);

  await prisma.$transaction(async (tx) => {
    await tx.smsMessage.create({
      data: {
        threadId: thread.id,
        direction: 'in',
        fromNumber: fromE164,
        toNumber: toE164,
        body: safeBody,
        provider: provider || null,
        providerMessageId: providerMessageId || null,
        mediaUrls: safeMediaUrls.length ? safeMediaUrls : null,
      },
    });

    await tx.smsThread.update({
      where: { id: thread.id },
      data: { updatedAt: new Date() },
    });
  });

  return { ok: true, userId: owner.assignedUserId, threadId: thread.id };
}


/**
 * LIST THREADS (for left "Conversations" list)
 */
export async function listThreads(userId) {
  return prisma.smsThread.findMany({
    where: { userId: Number(userId) },
    orderBy: { updatedAt: 'desc' },
  });
}

/**
 * GET A SINGLE THREAD + MESSAGES
 */
export async function getThread(userId, threadId) {
  const thread = await prisma.smsThread.findFirst({
    where: {
      id: Number(threadId),
      userId: Number(userId),
    },
  });

  if (!thread) throw Boom.notFound('Thread not found');

  const messages = await prisma.smsMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: 'asc' },
  });

  return { thread, messages };
}

/**
 * ✅ DELETE THREAD (DB-only)
 * - Removes the thread from your Conversations list
 * - Deletes local message history for that thread
 * - DOES NOT delete provider (Twilio) history
 */
export async function deleteThread(userId, threadId) {
  const uid = Number(userId);
  const tid = Number(threadId);
  if (!Number.isFinite(tid)) throw Boom.badRequest('Invalid thread id');

  const thread = await prisma.smsThread.findFirst({
    where: { id: tid, userId: uid },
    select: { id: true },
  });

  if (!thread) throw Boom.notFound('Thread not found');

  await prisma.$transaction(async (tx) => {
    await tx.smsMessage.deleteMany({ where: { threadId: tid } });
    await tx.smsThread.delete({ where: { id: tid } });
  });

  return { ok: true, threadId: tid };
}
