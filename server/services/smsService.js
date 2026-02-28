import Boom from '@hapi/boom';
import prisma from '../utils/prismaClient.js';
import { normalizeE164, isE164 } from '../utils/phone.js';
import { sendSms } from '../lib/telco/index.js';

/* -------------------------------------------------------------------------- */
/*                               Helper utils                                 */
/* -------------------------------------------------------------------------- */

function phoneVariants(raw) {
  const cleaned = String(raw || '').trim().replace(/[^\d+]/g, '');
  if (!cleaned) return [];
  const noPlus = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  const withPlus = cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  return [...new Set([withPlus, noPlus].filter(Boolean))];
}

async function getContactDisplayNameForPhone(ownerId, phone) {
  const variants = phoneVariants(phone);
  if (!variants.length) return null;

  const c = await prisma.contact.findFirst({
    where: {
      ownerId: Number(ownerId),
      externalPhone: { in: variants },
    },
    select: {
      alias: true,
      externalName: true,
      externalPhone: true,
      user: { select: { username: true } },
    },
  });

  return c ? (c.alias || c.externalName || c.user?.username || c.externalPhone) : null;
}

/* -------------------------------------------------------------------------- */
/*                       User DID / leased number helper                       */
/* -------------------------------------------------------------------------- */

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
    err.output.payload.code = 'NO_NUMBER';
    throw err;
  }

  return { id: num.id, e164: normalizeE164(num.e164) };
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

/* -------------------------------------------------------------------------- */
/*                             Thread upsert helper                             */
/* -------------------------------------------------------------------------- */

async function upsertThread(userId, contactPhone) {
  const uid = Number(userId);
  const phone = normalizeE164(contactPhone);
  if (!isE164(phone)) throw Boom.badRequest('Invalid destination phone');

  let thread = await prisma.smsThread.findFirst({
    where: { userId: uid, contactPhone: phone },
    select: { id: true, contactPhone: true },
  });

  if (!thread) {
    thread = await prisma.smsThread.create({
      data: {
        userId: uid,
        contactPhone: phone,
        // keep participants in sync so lookup-by-participants also works
        participants: {
          create: [{ phone }],
        },
      },
      select: { id: true, contactPhone: true },
    });
    return thread;
  }

  // ensure participant exists even for legacy threads
  await prisma.smsParticipant.upsert({
    where: { threadId_phone: { threadId: thread.id, phone } },
    update: {},
    create: { threadId: thread.id, phone },
  });

  return thread;
}

/* -------------------------------------------------------------------------- */
/*                          Normalize inbound media payloads                    */
/* -------------------------------------------------------------------------- */

function normalizeInboundMedia(media) {
  if (!Array.isArray(media)) return [];
  return media
    .map((m) => {
      if (!m) return null;
      if (typeof m === 'string') return { url: m, contentType: null };
      const url = m.url || m.MediaUrl || m.mediaUrl;
      const contentType = m.contentType || m.MediaContentType || m.mimeType || null;
      if (!url) return null;
      return { url: String(url), contentType: contentType ? String(contentType) : null };
    })
    .filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/*                                OUTBOUND SMS                                */
/* -------------------------------------------------------------------------- */

export async function sendUserSms({ userId, to, body, from, mediaUrls }) {
  const uid = Number(userId);

  const toPhone = normalizeE164(to);
  if (!isE164(toPhone)) throw Boom.badRequest('Invalid destination phone');

  const safeBody = String(body ?? '').trim();
  const safeMediaUrls = Array.isArray(mediaUrls) ? mediaUrls.filter(Boolean) : [];

  if (!safeBody && safeMediaUrls.length === 0) {
    throw Boom.badRequest('body or mediaUrls required');
  }

  const alreadyOpted = await prisma.smsOptOut.findFirst({
    where: { phone: toPhone, provider: { in: ['twilio', null] } }, 
  });
  if (alreadyOpted) {
    const err = Boom.forbidden('Recipient has opted out of SMS');
    err.output.payload.code = 'SMS_OPTED_OUT';
    throw err;
  }

  const fromNumber = from
    ? await assertUserOwnsFromNumber(uid, from)
    : (await getUserActiveDid(uid)).e164;

  const thread = await upsertThread(uid, toPhone);
  const clientRef = `smsout:${uid}:${Date.now()}`;

  const result = await sendSms({
    to: toPhone,
    text: safeBody,
    clientRef,
    from: fromNumber,
    mediaUrls: safeMediaUrls,
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

/* -------------------------------------------------------------------------- */
/*                                 INBOUND SMS                                */
/* -------------------------------------------------------------------------- */

export async function recordInboundSms({
  toNumber,
  fromNumber,
  body,
  provider,
  providerMessageId,
  media,
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
  const safeMedia = normalizeInboundMedia(media);
  const hasMedia = safeMedia.length > 0;

  if (!safeBody && !hasMedia) return { ok: false, reason: 'empty' };

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
        mediaUrls: hasMedia ? safeMedia : null,
      },
    });

    await tx.smsThread.update({
      where: { id: thread.id },
      data: { updatedAt: new Date() },
    });
  });

  return { ok: true, userId: owner.assignedUserId, threadId: thread.id };
}

/* -------------------------------------------------------------------------- */
/*                               LIST THREADS                                 */
/* -------------------------------------------------------------------------- */

export async function listThreads(userId) {
  const uid = Number(userId);

  const threads = await prisma.smsThread.findMany({
    where: { userId: uid, archivedAt: null },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      contactPhone: true,
      updatedAt: true,
    },
    take: 200,
  });

  const out = await Promise.all(
    threads.map(async (t) => {
      const name =
        (await getContactDisplayNameForPhone(uid, t.contactPhone)) ||
        t.contactPhone ||
        `SMS #${t.id}`;

      return {
        ...t,
        displayName: name,
        contactName: name,
      };
    })
  );

  return out;
}

/* -------------------------------------------------------------------------- */
/*                     GET SINGLE THREAD + NAME + MESSAGES                     */
/* -------------------------------------------------------------------------- */

export async function getThread(userId, threadId) {
  const uid = Number(userId);
  const tid = Number(threadId);

  if (!Number.isFinite(tid)) throw Boom.badRequest('Invalid thread id');

  const thread = await prisma.smsThread.findFirst({
    where: { id: tid, userId: uid },
    include: {
      participants: { select: { phone: true }, take: 5 },
    },
  });

  if (!thread) throw Boom.notFound('Thread not found');

  const messages = await prisma.smsMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: 'asc' },
  });

  const peerPhone =
    thread.contactPhone ||
    thread.participants?.[0]?.phone ||
    '';

  const displayName =
    (await getContactDisplayNameForPhone(uid, peerPhone)) ||
    peerPhone ||
    `SMS #${thread.id}`;

  return {
    ...thread,
    contactPhone: peerPhone || thread.contactPhone || null,
    displayName,
    contactName: displayName,
    messages,
  };
}

/* -------------------------------------------------------------------------- */
/*                             DELETE / UPDATE MSG                             */
/* -------------------------------------------------------------------------- */

export async function deleteMessage(userId, messageId) {
  const uid = Number(userId);
  const mid = Number(messageId);
  if (!Number.isFinite(mid)) throw Boom.badRequest('Invalid message id');

  const msg = await prisma.smsMessage.findFirst({
    where: { id: mid },
    select: { id: true, threadId: true },
  });

  if (!msg) throw Boom.notFound('Message not found');

  const thread = await prisma.smsThread.findFirst({
    where: { id: msg.threadId, userId: uid },
    select: { id: true },
  });

  if (!thread) throw Boom.notFound('Message not found');

  await prisma.smsMessage.delete({ where: { id: mid } });

  await prisma.smsThread.update({
    where: { id: msg.threadId },
    data: { updatedAt: new Date() },
  });

  return { ok: true, messageId: mid, threadId: msg.threadId };
}

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

export async function updateMessage(userId, messageId, { body }) {
  const uid = Number(userId);
  const mid = Number(messageId);
  if (!Number.isFinite(mid)) throw Boom.badRequest('Invalid message id');

  const nextBody = String(body ?? '').trim();
  if (!nextBody) throw Boom.badRequest('body is required');

  const msg = await prisma.smsMessage.findFirst({
    where: { id: mid },
    select: { id: true, threadId: true, direction: true, createdAt: true },
  });

  if (!msg) throw Boom.notFound('Message not found');

  const thread = await prisma.smsThread.findFirst({
    where: { id: msg.threadId, userId: uid },
    select: { id: true },
  });

  if (!thread) throw Boom.notFound('Message not found');

  if (String(msg.direction).toLowerCase() !== 'out') {
    throw Boom.forbidden('Only sent messages can be edited');
  }

  // ✅ time window
  const windowSec = Number(process.env.SMS_EDIT_WINDOW_SEC || 300);
  if (Number.isFinite(windowSec) && windowSec > 0) {
    const ageMs = Date.now() - new Date(msg.createdAt).getTime();
    if (ageMs > windowSec * 1000) {
      const err = Boom.forbidden('Edit window expired');
      err.output.payload.code = 'EDIT_WINDOW_EXPIRED';
      err.output.payload.windowSec = windowSec;
      throw err;
    }
  }

  const updated = await prisma.smsMessage.update({
    where: { id: mid },
    data: { body: nextBody, editedAt: new Date() },
  });

  await prisma.smsThread.update({
    where: { id: msg.threadId },
    data: { updatedAt: new Date() },
  });

  return updated;
}

