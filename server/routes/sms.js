import express from 'express';
import Boom from '@hapi/boom';

import prisma from '../utils/prismaClient.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// ✅ Import as a module so "deleteThread" can be optional without crashing at import-time
import * as smsService from '../services/smsService.js';

// ✅ Twilio-protected media fetch helper (does Basic Auth + returns fetch Response)
import { fetchTwilioMedia } from '../utils/twilioMediaProxy.js';

const r = express.Router();

// JSON bodies for authenticated app routes
r.use(express.json());

/* -------------------------
 * Helpers
 * ------------------------- */

// Build + / no+ variants to match threads even if your DB/user input differs
function buildPhoneVariants(raw) {
  const cleaned = String(raw || '').trim().replace(/[^\d+]/g, '');
  if (!cleaned) return [];

  const noPlus = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  const withPlus = cleaned.startsWith('+') ? cleaned : `+${cleaned}`;

  // (Optional) you can add more variants here later
  return [...new Set([withPlus, noPlus])];
}

/* -------------------------------------------------------------------------- */
/*                            ✅ SMS MEDIA PROXY (AUTH)                         */
/*  NOTE: Keep this ABOVE '/threads/:id' if you ever mount router at '/sms'    */
/*  and also add any overlapping patterns. In this file it's fine either way. */
/* -------------------------------------------------------------------------- */
// GET /sms/media/:messageId/:idx
r.get(
  '/media/:messageId/:idx',
  requireAuth,
  asyncHandler(async (req, res) => {
    const messageId = Number(req.params.messageId);
    const idx = Number(req.params.idx);

    if (!Number.isFinite(messageId) || !Number.isFinite(idx) || idx < 0) {
      throw Boom.badRequest('Invalid messageId or idx');
    }

    const msg = await prisma.smsMessage.findFirst({
      where: { id: messageId },
      select: {
        id: true,
        threadId: true,
        mediaUrls: true,
        provider: true,
      },
    });

    if (!msg) throw Boom.notFound('Message not found');

    const thread = await prisma.smsThread.findFirst({
      where: { id: msg.threadId, userId: Number(req.user.id) },
      select: { id: true },
    });

    if (!thread) throw Boom.notFound('Message not found');

    const urls = Array.isArray(msg.mediaUrls)
      ? msg.mediaUrls
      : msg.mediaUrls
        ? Object.values(msg.mediaUrls)
        : [];

    const url = urls?.[idx];
    if (!url) throw Boom.notFound('Media item not found');

    const upstream = await fetchTwilioMedia(String(url));
    if (!upstream.ok) throw Boom.badGateway('Failed to fetch upstream media');

    const contentType =
      upstream.headers.get('content-type') || 'application/octet-stream';
    const contentLength = upstream.headers.get('content-length');

    res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.setHeader('Cache-Control', 'private, max-age=60');

    if (upstream.body && typeof upstream.body.pipe === 'function') {
      return upstream.body.pipe(res);
    }

    const arrayBuffer = await upstream.arrayBuffer();
    return res.status(200).send(Buffer.from(arrayBuffer));
  })
);

/* ---------- LIST THREADS ---------- */
// GET /sms/threads
r.get(
  '/threads',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (typeof smsService.listThreads !== 'function') {
      throw Boom.badImplementation('smsService.listThreads is not implemented');
    }
    const items = await smsService.listThreads(req.user.id);
    res.json({ items });
  })
);

/* ---------- LOOKUP THREAD BY PHONE ---------- */
/**
 * GET /sms/threads/lookup?to=+1301...
 * IMPORTANT: must be ABOVE /threads/:id or Express will treat "lookup" as :id
 */
r.get(
  '/threads/lookup',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = Number(req.user.id);
    const toRaw = String(req.query.to || '').trim();
    if (!toRaw) return res.json({ threadId: null });

    const variants = buildPhoneVariants(toRaw);

    // ✅ FIX: match by contactPhone OR participants so legacy threads and upserted
    // participant rows both resolve to the same thread
    const thread = await prisma.smsThread.findFirst({
      where: {
        userId,
        OR: [
          { contactPhone: { in: variants } },
          { participants: { some: { phone: { in: variants } } } },
        ],
      },
      select: { id: true },
    });

    res.json({ threadId: thread?.id ?? null });
  })
);

/* ---------- SINGLE THREAD (messages, etc.) ---------- */
// GET /sms/threads/:id
r.get(
  '/threads/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (typeof smsService.getThread !== 'function') {
      throw Boom.badImplementation('smsService.getThread is not implemented');
    }
    const thread = await smsService.getThread(req.user.id, req.params.id);
    res.json(thread);
  })
);

/* ---------- ✅ EDIT INDIVIDUAL SMS MESSAGE (DB-only) ---------- */
// PATCH /sms/messages/:id
r.patch(
  '/messages/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (typeof smsService.updateMessage !== 'function') {
      throw Boom.notImplemented(
        'SMS message edit not implemented yet. Add smsService.updateMessage(userId, messageId, { body }).'
      );
    }

    const body = String(req.body?.body || '').trim();
    if (!body) throw Boom.badRequest('body is required');

    const out = await smsService.updateMessage(req.user.id, req.params.id, { body });
    res.json({ ok: true, message: out });
  })
);

/* ---------- ✅ DELETE INDIVIDUAL SMS MESSAGE (DB-only) ---------- */
// DELETE /sms/messages/:id
r.delete(
  '/messages/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (typeof smsService.deleteMessage !== 'function') {
      throw Boom.notImplemented(
        'SMS message delete not implemented yet. Add smsService.deleteMessage(userId, messageId).'
      );
    }

    const out = await smsService.deleteMessage(req.user.id, req.params.id);
    res.json({ ok: true, result: out ?? null });
  })
);

/* ---------- DELETE THREAD (DB-only) ---------- */
// DELETE /sms/threads/:id
r.delete(
  '/threads/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (typeof smsService.deleteThread !== 'function') {
      throw Boom.notImplemented(
        'SMS thread delete not implemented yet. Add smsService.deleteThread(userId, threadId).'
      );
    }

    const out = await smsService.deleteThread(req.user.id, id);
    res.json({ ok: true, result: out ?? null });
  })
);

/* ---------- SEND ---------- */
// POST /sms/_debug_send
r.post(
  '/_debug_send',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (typeof smsService.sendUserSms !== 'function') {
      throw Boom.badImplementation('smsService.sendUserSms is not implemented');
    }

    const { to, body, from, mediaUrls } = req.body || {};
    const out = await smsService.sendUserSms({
      userId: req.user.id,
      to,
      body: body || 'debug test',
      from,
      mediaUrls,
    });
    res.json(out);
  })
);

// POST /sms/send
r.post(
  '/send',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (typeof smsService.sendUserSms !== 'function') {
      throw Boom.badImplementation('smsService.sendUserSms is not implemented');
    }

    const { to, body, from, mediaUrls } = req.body || {};
    if (!to || (!body && (!Array.isArray(mediaUrls) || mediaUrls.length === 0))) {
      throw Boom.badRequest('to and body (or mediaUrls) required');
    }

    const out = await smsService.sendUserSms({
      userId: req.user.id,
      to,
      body,
      from,
      mediaUrls: Array.isArray(mediaUrls) ? mediaUrls : [],
    });

    res.status(202).json(out);
  })
);

export default r;
