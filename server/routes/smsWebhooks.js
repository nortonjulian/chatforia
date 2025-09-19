import express from 'express';
import prisma from '../utils/prismaClient.js';
import { recordInboundSms } from '../services/smsService.js';
import { transporter } from '../services/mailer.js';
import { sendSmsWithFallback } from '../lib/telco/index.js';
import { normalizeE164, isE164 } from '../utils/phone.js';

const router = express.Router();

/** Quiet-hours helper */
function inQuietHours(start, end, now = new Date()) {
  if (start == null || end == null) return false;
  const h = now.getHours();
  // 22->06 spans midnight, handle both shapes
  return (start < end && h >= start && h < end) || (start > end && (h >= start || h < end));
}

/** Should we skip forwarding (loop guard)? */
function isLoopRef(refLike) {
  if (!refLike) return false;
  const s = String(refLike).toLowerCase();
  return s.startsWith('fwd:'); // we mark our own forwards like fwd:<userId>:<ts>
}

/* ----------------------------------------------------------------------------
 * TELNYX webhook
 * Typically POSTs:
 * {
 *   data: {
 *     event_type: 'message.received' | 'message.finalized' | ...
 *     payload: { to: '+1...', from: '+1...', text: '...', client_ref?: '...' }
 *   }
 * }
 * --------------------------------------------------------------------------*/
router.post('/telnyx', express.json(), async (req, res) => {
  try {
    const ev = req.body?.data || req.body;
    const type = ev?.event_type || ev?.type || 'unknown';
    const p = ev?.payload || ev?.data || {};

    // Normalize basic fields
    const toRaw = p?.to || p?.to_number || p?.toPhoneNumber;
    const fromRaw = p?.from || p?.from_number || p?.fromPhoneNumber;
    const text = p?.text || p?.body || '';
    const clientRef = p?.client_ref || p?.clientRef || null;

    // Only process inbound messages
    const isInbound = String(type).includes('message.received') || !!text;

    // Basic validation
    const toNumber = normalizeE164(toRaw);
    const fromNumber = normalizeE164(fromRaw);
    if (!isInbound || !isE164(toNumber) || !isE164(fromNumber) || !text) {
      // Acknowledge anyway to avoid retries; log for observability
      req.log?.info?.({ type, toRaw, fromRaw }, '[webhook][telnyx] ignored');
      return res.sendStatus(200);
    }

    // Record in DB
    const rec = await recordInboundSms({
      toNumber,
      fromNumber,
      body: text,
      provider: 'telnyx',
    });

    // Optional forward (skip if this was our own forwarded message)
    if (rec?.ok && !isLoopRef(clientRef)) {
      const user = await prisma.user.findUnique({
        where: { id: rec.userId },
        select: {
          forwardingEnabledSms: true,
          forwardSmsToPhone: true,
          forwardSmsToEmail: true,
          forwardPhoneNumber: true,
          forwardEmail: true,
          forwardQuietHoursStart: true,
          forwardQuietHoursEnd: true,
        },
      });

      if (user?.forwardingEnabledSms && !inQuietHours(user.forwardQuietHoursStart, user.forwardQuietHoursEnd)) {
        // Phone forward
        if (user.forwardSmsToPhone && isE164(user.forwardPhoneNumber)) {
          await sendSmsWithFallback({
            to: normalizeE164(user.forwardPhoneNumber),
            text: `From ${fromNumber}: ${text}`.slice(0, 800),
            clientRef: `fwd:${rec.userId}:${Date.now()}`,
          });
        }
        // Email forward
        if (user.forwardSmsToEmail && user.forwardEmail && transporter) {
          await transporter.sendMail({
            to: user.forwardEmail,
            from: process.env.MAIL_FROM || 'noreply@chatorbit.app',
            subject: `SMS from ${fromNumber}`,
            text,
          });
        }
      }
    }

    res.sendStatus(200);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[webhook][telnyx] error', e);
    // Always 200 unless you want provider retries; here we signal server error
    res.sendStatus(500);
  }
});

/* ----------------------------------------------------------------------------
 * BANDWIDTH webhook
 * Usually an array of events per POST, e.g.
 * [
 *   {
 *     type: 'message-received' | 'message-sending' | 'message-delivered' | ...
 *     to: '+1...', from: '+1...', text: '...', tag?: '...'
 *   }
 * ]
 * --------------------------------------------------------------------------*/
router.post('/bandwidth', express.json(), async (req, res) => {
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    for (const evt of events) {
      const type = evt?.type || 'unknown';

      // Only process inbound received messages
      const isInbound = String(type).includes('message-received');
      const toNumber = normalizeE164(evt?.to || evt?.message?.to);
      const fromNumber = normalizeE164(evt?.from || evt?.message?.from);
      const text = evt?.text || evt?.message?.text || '';
      const tag = evt?.tag || evt?.message?.tag || null;

      if (!isInbound || !isE164(toNumber) || !isE164(fromNumber) || !text) {
        req.log?.info?.({ type, toNumber, fromNumber }, '[webhook][bandwidth] ignored');
        continue;
      }

      const rec = await recordInboundSms({
        toNumber,
        fromNumber,
        body: text,
        provider: 'bandwidth',
      });

      if (rec?.ok && !isLoopRef(tag)) {
        const user = await prisma.user.findUnique({
          where: { id: rec.userId },
          select: {
            forwardingEnabledSms: true,
            forwardSmsToPhone: true,
            forwardSmsToEmail: true,
            forwardPhoneNumber: true,
            forwardEmail: true,
            forwardQuietHoursStart: true,
            forwardQuietHoursEnd: true,
          },
        });

        if (user?.forwardingEnabledSms && !inQuietHours(user.forwardQuietHoursStart, user.forwardQuietHoursEnd)) {
          if (user.forwardSmsToPhone && isE164(user.forwardPhoneNumber)) {
            await sendSmsWithFallback({
              to: normalizeE164(user.forwardPhoneNumber),
              text: `From ${fromNumber}: ${text}`.slice(0, 800),
              clientRef: `fwd:${rec.userId}:${Date.now()}`,
            });
          }
          if (user.forwardSmsToEmail && user.forwardEmail && transporter) {
            await transporter.sendMail({
              to: user.forwardEmail,
              from: process.env.MAIL_FROM || 'noreply@chatorbit.app',
              subject: `SMS from ${fromNumber}`,
              text,
            });
          }
        }
      }
    }

    res.sendStatus(200);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[webhook][bandwidth] error', e);
    res.sendStatus(500);
  }
});

export default router;
