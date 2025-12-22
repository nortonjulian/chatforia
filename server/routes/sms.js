import express from 'express';
import Boom from '@hapi/boom';

import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// ✅ Import as a module so "deleteThread" can be optional without crashing at import-time
import * as smsService from '../services/smsService.js';

const r = express.Router();

/* -------------------------------------------------------------------------- */
/*                              PROVIDER WEBHOOKS                             */
/* -------------------------------------------------------------------------- */
/**
 * Twilio inbound SMS/MMS webhook (NO auth)
 * Typical Twilio payload is application/x-www-form-urlencoded:
 *  - From, To, Body, MessageSid, NumMedia, MediaUrl0..N
 *
 * Mount path example:
 *   POST /sms/webhooks/twilio/inbound
 */
r.post(
  '/webhooks/twilio/inbound',
  express.urlencoded({ extended: false }),
  asyncHandler(async (req, res) => {
    if (typeof smsService.recordInboundSms !== 'function') {
      throw Boom.badImplementation('smsService.recordInboundSms is not implemented');
    }

    const fromNumber = req.body?.From;
    const toNumber = req.body?.To;
    const body = req.body?.Body || '';

    const providerMessageId = req.body?.MessageSid || null;

    // MMS support (Twilio)
    const numMedia = Number(req.body?.NumMedia || 0);
    const mediaUrls = [];
    if (Number.isFinite(numMedia) && numMedia > 0) {
      for (let i = 0; i < numMedia; i += 1) {
        const url = req.body?.[`MediaUrl${i}`];
        if (url) mediaUrls.push(url);
      }
    }

    await smsService.recordInboundSms({
      toNumber,
      fromNumber,
      body,
      provider: 'twilio',
      providerMessageId,
      mediaUrls,
    });

    // Twilio expects TwiML or a 200 OK. Empty TwiML is fine.
    res.set('Content-Type', 'text/xml');
    res.status(200).send('<Response></Response>');
  })
);

/* -------------------------------------------------------------------------- */
/*                             AUTHENTICATED ROUTES                            */
/* -------------------------------------------------------------------------- */

// JSON bodies for authenticated app routes
r.use(express.json());

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
