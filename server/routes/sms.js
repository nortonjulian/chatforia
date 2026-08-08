import express from 'express';
import Boom from '@hapi/boom';

import prisma from '../utils/prismaClient.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import AnalyticsManager from '../utils/analyticsManager.js';
import { normalizeE164, isE164 } from '../utils/phone.js';

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

function normalizeReportReason(reason) {
  const value = String(reason || '').trim().toLowerCase();

  const map = {
    harassment: 'HARASSMENT',
    threats: 'VIOLENCE',
    violence: 'VIOLENCE',
    hate: 'HATE',
    sexual_content: 'NUDITY',
    nudity: 'NUDITY',
    spam_scam: 'SCAM',
    scam: 'SCAM',
    impersonation: 'IMPERSONATION',
    other: 'OTHER',
  };

  return map[value] || 'OTHER';
}

function normalizeBlockedPhone(raw) {
  const phone = normalizeE164(raw);
  if (!isE164(phone)) throw Boom.badRequest('Valid phone number is required');
  return phone;
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

// POST /sms/threads/start
r.post(
  '/threads/start',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (typeof smsService.getOrCreateThread !== 'function') {
      throw Boom.badImplementation('smsService.getOrCreateThread is not implemented');
    }

    const phone = String(req.body?.phone || req.body?.to || '').trim();
    const contactId =
      req.body?.contactId != null ? Number(req.body.contactId) : null;

    if (!phone) {
      throw Boom.badRequest('phone is required');
    }

    const thread = await smsService.getOrCreateThread(req.user.id, phone, {
      contactId,
    });

    res.status(201).json(thread);
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

/* ---------- REPORT AN INCOMING PSTN MESSAGE ---------- */
// POST /sms/messages/:id/report
r.post(
  '/messages/:id/report',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = Number(req.user.id);
    const messageId = Number(req.params.id);

    if (!Number.isInteger(messageId)) {
      throw Boom.badRequest('Valid SMS message id is required');
    }

    const reason = normalizeReportReason(req.body?.reason);
    const detailsRaw =
      typeof req.body?.details === 'string'
        ? req.body.details.trim()
        : '';
    const details = detailsRaw ? detailsRaw.slice(0, 2000) : null;
    const contextCount = Math.max(
      0,
      Math.min(Number(req.body?.contextCount) || 10, 20)
    );
    const blockAfterReport = Boolean(req.body?.blockAfterReport);

    const message = await prisma.smsMessage.findFirst({
      where: {
        id: messageId,
        direction: 'in',
        thread: {
          userId,
        },
      },
      select: {
        id: true,
        threadId: true,
        direction: true,
        fromNumber: true,
        toNumber: true,
        body: true,
        mediaUrls: true,
        createdAt: true,
      },
    });

    if (!message) {
      throw Boom.notFound('Incoming SMS message not found');
    }

    const reportedPhone = normalizeBlockedPhone(message.fromNumber);

    const existingReport = await prisma.report.findFirst({
      where: {
        reportType: 'PSTN',
        smsMessageId: message.id,
        reporterId: userId,
        status: 'OPEN',
      },
      select: { id: true },
    });

    if (existingReport) {
      throw Boom.conflict('You already reported this message');
    }

    const contextMessages =
      contextCount > 0
        ? await prisma.smsMessage.findMany({
            where: {
              threadId: message.threadId,
              createdAt: {
                lte: message.createdAt,
              },
            },
            orderBy: [
              { createdAt: 'desc' },
              { id: 'desc' },
            ],
            take: contextCount + 1,
            select: {
              id: true,
              direction: true,
              fromNumber: true,
              toNumber: true,
              body: true,
              mediaUrls: true,
              createdAt: true,
            },
          })
        : [];

    const evidence = {
      contextCount,
      contextMessages: contextMessages.reverse().map((item) => ({
        id: item.id,
        direction: item.direction,
        fromNumber: item.fromNumber,
        toNumber: item.toNumber,
        text: item.body || null,
        mediaUrls: Array.isArray(item.mediaUrls)
          ? item.mediaUrls
          : item.mediaUrls
            ? Object.values(item.mediaUrls)
            : [],
        createdAt: item.createdAt.toISOString(),
      })),
    };

    const report = await prisma.$transaction(async (tx) => {
      const created = await tx.report.create({
        data: {
          reportType: 'PSTN',
          messageId: null,
          smsMessageId: message.id,
          reporterId: userId,
          reportedUserId: null,
          reportedPhone,
          chatRoomId: null,
          decryptedContent:
            String(message.body || '').trim() ||
            (Array.isArray(message.mediaUrls) && message.mediaUrls.length > 0
              ? '[MMS attachment]'
              : '[Empty SMS message]'),
          reason,
          details,
          evidence,
          blockApplied: blockAfterReport,
          status: 'OPEN',
        },
        select: {
          id: true,
          reportType: true,
          smsMessageId: true,
          reportedPhone: true,
          reason: true,
          blockApplied: true,
          status: true,
          createdAt: true,
        },
      });

      if (blockAfterReport) {
        await tx.smsBlockedNumber.upsert({
          where: {
            userId_phone: {
              userId,
              phone: reportedPhone,
            },
          },
          update: {
            updatedAt: new Date(),
          },
          create: {
            userId,
            phone: reportedPhone,
          },
        });
      }

      return created;
    });

    res.locals.audit = {
      action: blockAfterReport
        ? 'USER_REPORT_AND_BLOCK_PSTN_MESSAGE'
        : 'USER_REPORT_PSTN_MESSAGE',
      targetMessageId: message.id,
      notes: `${reason}:${reportedPhone}`,
    };

    return res.status(201).json({
      success: true,
      report,
    });
  })
);

/* ---------- LIST BLOCKED PSTN NUMBERS ---------- */
// GET /sms/blocked-numbers
r.get(
  '/blocked-numbers',
  requireAuth,
  asyncHandler(async (req, res) => {
    const items = await prisma.smsBlockedNumber.findMany({
      where: {
        userId: Number(req.user.id),
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        phone: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({ items });
  })
);

/* ---------- BLOCK A PSTN NUMBER ---------- */
// POST /sms/blocked-numbers
r.post(
  '/blocked-numbers',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = Number(req.user.id);
    const phone = normalizeBlockedPhone(req.body?.phone);

    const item = await prisma.smsBlockedNumber.upsert({
      where: {
        userId_phone: {
          userId,
          phone,
        },
      },
      update: {
        updatedAt: new Date(),
      },
      create: {
        userId,
        phone,
      },
      select: {
        id: true,
        phone: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.locals.audit = {
      action: 'USER_BLOCK_PSTN_NUMBER',
      notes: phone,
    };

    return res.status(201).json({
      success: true,
      item,
    });
  })
);

/* ---------- UNBLOCK A PSTN NUMBER ---------- */
// DELETE /sms/blocked-numbers/:id
r.delete(
  '/blocked-numbers/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = Number(req.user.id);
    const blockedNumberId = Number(req.params.id);

    if (!Number.isInteger(blockedNumberId)) {
      throw Boom.badRequest('Valid blocked-number id is required');
    }

    const result = await prisma.smsBlockedNumber.deleteMany({
      where: {
        id: blockedNumberId,
        userId,
      },
    });

    if (result.count === 0) {
      throw Boom.notFound('Blocked number not found');
    }

    res.locals.audit = {
      action: 'USER_UNBLOCK_PSTN_NUMBER',
      targetId: blockedNumberId,
    };

    return res.json({
      success: true,
      id: blockedNumberId,
    });
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
    try {

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

      const isMedia = Array.isArray(mediaUrls) && mediaUrls.length > 0;

      AnalyticsManager.capture("sms_sent_server", {
        userId: req.user.id,
        type: isMedia ? "media" : "text",
        mediaCount: isMedia ? mediaUrls.length : 0,
        provider: out?.provider || "unknown",
      });

      return res.status(202).json(out);
    } catch (err) {
      return res.status(err?.output?.statusCode || 500).json({
        error: err?.name || 'Error',
        message: err?.output?.payload?.userMessage || err?.message || 'Unknown error',
        code: err?.output?.payload?.code || null,
        supportAction: err?.output?.payload?.supportAction || null,
        redirectTo: err?.output?.payload?.redirectTo || null,
        details: err?.output?.payload || null,
      });
    }
  })
);

export default r;
