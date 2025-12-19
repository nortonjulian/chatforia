import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import Boom from '@hapi/boom';
import { sendUserSms, listThreads, getThread } from '../services/smsService.js';

const r = express.Router();

/* ---------- LIST THREADS (prod path, via service) ---------- */
// GET /sms/threads
r.get(
  '/threads',
  requireAuth,
  asyncHandler(async (req, res) => {
    const items = await listThreads(req.user.id);
    res.json({ items });
  })
);

/* ---------- SINGLE THREAD (messages, etc.) ---------- */
// GET /sms/threads/:id
r.get(
  '/threads/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const thread = await getThread(req.user.id, req.params.id);
    res.json(thread);
  })
);


/* ---------- SEND (prod path, via provider/service) ---------- */
// server/routes/sms.js
r.post('/_debug_send', requireAuth, express.json(), asyncHandler(async (req, res) => {
  const { to, body, from, mediaUrls } = req.body || {};
  const out = await sendUserSms({ userId: req.user.id, to, body: body || 'debug test', from, mediaUrls });
  res.json(out);
}));


r.post(
  '/send',
  requireAuth,
  express.json(),
  asyncHandler(async (req, res) => {
    const { to, body, from, mediaUrls } = req.body || {};
    if (!to || (!body && (!Array.isArray(mediaUrls) || mediaUrls.length === 0))) {
      throw Boom.badRequest('to and body (or mediaUrls) required');
    }

    const out = await sendUserSms({
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
