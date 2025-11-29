import Boom from '@hapi/boom';
import prisma from '../utils/prismaClient.js';
import { normalizeE164, isE164 } from '../utils/phone.js';
import { sendSms } from '../lib/telco/index.js';

async function getUserFromNumber(userId) {
  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: {
      assignedNumbers: {
        select: { e164: true },
        take: 1,
        orderBy: { id: 'asc' },
      },
    },
  });

  const num = user?.assignedNumbers?.[0]?.e164 || null;

  if (!num) {
    const err = Boom.preconditionFailed('No assigned number for user');
    // frontend expects this to trigger NumberPickerModal
    err.output.payload.code = 'NO_NUMBER';
    throw err;
  }

  return normalizeE164(num);
}

async function upsertThread(userId, contactPhone) {
  const phone = normalizeE164(contactPhone);
  if (!isE164(phone)) throw Boom.badRequest('Invalid destination phone');

  let thread = await prisma.smsThread.findFirst({
    where: { userId, contactPhone: phone },
  });

  if (!thread) {
    thread = await prisma.smsThread.create({
      data: { userId, contactPhone: phone },
    });
  }

  return thread;
}

export async function sendUserSms({ userId, to, body }) {
  const toPhone = normalizeE164(to);
  if (!isE164(toPhone)) throw Boom.badRequest('Invalid destination phone');

  // ✅ User’s Chatforia DID
  const from = await getUserFromNumber(userId);

  const thread = await upsertThread(userId, toPhone);

  const clientRef = `smsout:${userId}:${Date.now()}`;
  const result = await sendSms({
    to: toPhone,
    text: body,
    clientRef,
    from, // ✅ key line
  });
  const provider = result?.provider || 'twilio';

  await prisma.smsMessage.create({
    data: {
      threadId: thread.id,
      direction: 'out',
      fromNumber: from,
      toNumber: toPhone,
      body,
      provider,
      // providerMessageId: result?.messageSid || null,
    },
  });

  return {
    ok: true,
    threadId: thread.id,
    provider,
    messageSid: result?.messageSid || null,
  };
}

export async function recordInboundSms({
  toNumber,
  fromNumber,
  body,
  provider,
}) {
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

export async function listThreads(userId) {
  return prisma.smsThread.findMany({
    where: { userId: Number(userId) },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function getThread(userId, threadId) {
  const thread = await prisma.smsThread.findFirst({
    where: {
      id: Number(threadId),
      userId: Number(userId),
    },
  });

  if (!thread) {
    throw Boom.notFound('Thread not found');
  }

  const messages = await prisma.smsMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: 'asc' },
  });

  return { thread, messages };
}
