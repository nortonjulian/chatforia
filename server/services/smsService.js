import Boom from '@hapi/boom';
import prisma from '../utils/prismaClient.js';
import { normalizeE164, isE164 } from '../utils/phone.js';
import { sendSms } from '../lib/telco/index.js';

/**
 * Pick a user's outbound "from" number (first assigned).
 */
async function getUserFromNumber(userId) {
  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: {
      assignedNumbers: { select: { e164: true }, take: 1, orderBy: { id: 'asc' } },
    },
  });
  const num = user?.assignedNumbers?.[0]?.e164 || null;
  if (!num) throw Boom.preconditionFailed('No assigned number for user');
  return normalizeE164(num);
}

/**
 * Find or create an SmsThread for (userId, contactPhone)
 */
async function upsertThread(userId, contactPhone) {
  const phone = normalizeE164(contactPhone);
  if (!isE164(phone)) throw Boom.badRequest('Invalid destination phone');
  let thread = await prisma.smsThread.findFirst({ where: { userId, contactPhone: phone } });
  if (!thread) {
    thread = await prisma.smsThread.create({ data: { userId, contactPhone: phone } });
  }
  return thread;
}

/**
 * Send outbound SMS from the user's Chatforia number to a destination.
 */
export async function sendUserSms({ userId, to, body }) {
  const toPhone = normalizeE164(to);
  if (!isE164(toPhone)) throw Boom.badRequest('Invalid destination phone');
  const from = await getUserFromNumber(userId);
  const thread = await upsertThread(userId, toPhone);

  // Telco send (Twilio-only)
  const clientRef = `smsout:${userId}:${Date.now()}`;
  const result = await sendSms({ to: toPhone, text: body, clientRef });
  const provider = result?.provider || 'twilio';

  // Persist message
  await prisma.smsMessage.create({
    data: {
      threadId: thread.id,
      direction: 'out',
      fromNumber: from,
      toNumber: toPhone,
      body,
      provider,
      // providerMessageId: result?.messageSid || null, // ← uncomment if your schema supports it
    },
  });

  return { ok: true, threadId: thread.id, provider, messageSid: result?.messageSid || null };
}

/**
 * Persist inbound SMS (called from webhook).
 */
export async function recordInboundSms({ toNumber, fromNumber, body, provider }) {
  // toNumber is the Chatforia DID; find the owning user by assignedNumbers
  const owner = await prisma.user.findFirst({
    where: { assignedNumbers: { some: { e164: normalizeE164(toNumber) } } },
    select: { id: true },
  });
  if (!owner) return { ok: false, reason: 'no-owner' };

  const thread = await upsertThread(owner.id, fromNumber);
  await prisma.smsMessage.create({
    data: {
      threadId: thread.id,
      direction: 'in',
      fromNumber: normalizeE164(fromNumber),
      toNumber: normalizeE164(toNumber),
      body,
      provider: provider || null,
    },
  });
  return { ok: true, userId: owner.id, threadId: thread.id };
}

/** Fetch threads & messages */
export async function listThreads(userId) {
  return prisma.smsThread.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  });
}
export async function getThread(userId, threadId) {
  const thread = await prisma.smsThread.findUnique({
    where: { id: Number(threadId) },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!thread || thread.userId !== Number(userId)) throw Boom.notFound('Thread not found');
  return thread;
}
