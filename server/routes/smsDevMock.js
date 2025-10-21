import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import prisma from '../utils/prismaClient.js';
import Boom from '@hapi/boom';
import { normalizeE164, isE164 } from '../utils/phone.js';

const r = express.Router();

/* ---------- tiny helpers (dev-only) ---------- */
async function getUserFromNumber(userId) {
  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: {
      assignedNumbers: { select: { e164: true }, take: 1, orderBy: { id: 'asc' } },
    },
  });
  const num = user?.assignedNumbers?.[0]?.e164 || null;
  if (!num) throw Boom.preconditionFailed('No assigned number for user (dev mock)');
  return normalizeE164(num);
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

/* ---------- LIST THREADS (with preview) ---------- */
// GET /sms/threads
r.get('/threads', requireAuth, async (req, res, next) => {
  try {
    const userId = Number(req.user.id);

    const threads = await prisma.smsThread.findMany({
      where: { userId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        contactPhone: true,
        updatedAt: true,
        messages: {
          orderBy: { id: 'desc' },
          take: 1,
          select: { body: true, createdAt: true },
        },
      },
    });

    const items = threads.map((t) => ({
      id: t.id,
      contactPhone: t.contactPhone,
      lastMessageAt: t.messages[0]?.createdAt || t.updatedAt,
      lastMessageSnippet: (t.messages[0]?.body || '').slice(0, 60),
    }));

    res.json({ items });
  } catch (e) {
    next(e);
  }
});

/* ---------- SEND (DEV MOCK) ---------- */
// POST /sms/send  Body: { to, body }
r.post('/send', requireAuth, express.json(), async (req, res, next) => {
  try {
    const { to, body } = req.body || {};
    if (!to || !body) throw Boom.badRequest('to and body required');

    const toPhone = normalizeE164(to);
    if (!isE164(toPhone)) throw Boom.badRequest('Invalid destination phone');

    // Dev-friendly sender fallback
    let from;
    try {
      from = await getUserFromNumber(req.user.id);
    } catch {
      from = process.env.DEV_FROM_NUMBER || '+19990000000';
    }

    const thread = await upsertThread(req.user.id, toPhone);

    const fakeSid = `SM_mock_${Date.now().toString(36)}`;

    await prisma.smsMessage.create({
      data: {
        threadId: thread.id,
        direction: 'out',
        fromNumber: from,
        toNumber: toPhone,
        body,
        provider: 'mock',
        status: 'mocked',
      },
    });

    // bump thread updatedAt (Prisma will do this if you have @updatedAt; otherwise force)
    await prisma.smsThread.update({
      where: { id: thread.id },
      data: { updatedAt: new Date() },
    });

    res.status(202).json({ ok: true, threadId: thread.id, provider: 'mock', messageSid: fakeSid });
  } catch (e) {
    next(e);
  }
});

export default r;
