import express from 'express';
import prisma from '../utils/prismaClient.js';
import { recordInboundSms } from '../services/smsService.js';
import { sendPushToUser } from '../services/pushService.js';
// import { sendSmsWithFallback } from '../lib/telco/index.js';
import { sendSms } from '../lib/telco/index.js';
import { normalizeE164, isE164 } from '../utils/phone.js';
import { sendMail, isEmailAvailable } from '../utils/sendMail.js';

const router = express.Router();

function emptyTwilioResponse(res) {
  return res
    .type('text/xml')
    .status(200)
    .send('<Response></Response>');
}

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

router.post(
  '/twilio',
  // Parse Twilio's default form-encoded payload
  express.urlencoded({ extended: false }),
  async (req, res) => {
    try {
      const From = req.body?.From || req.body?.from;
      const To = req.body?.To || req.body?.to;
      const Body = req.body?.Body || req.body?.body || '';
      const MessageSid = req.body?.MessageSid || req.body?.MessageSid?.toString?.();

      const toNumber = normalizeE164(To);
      const fromNumber = normalizeE164(From);
      const bodyText = String(Body);
      const upperBody = bodyText.trim().toUpperCase();

      /*
       * Compliance keyword handling:
       *
       * - Twilio remains authoritative for its carrier-facing blocklist
       *   and compliance replies.
       * - Chatforia mirrors STOP/START state locally so outbound sends
       *   can be rejected before contacting Twilio.
       * - Always return empty TwiML for compliance commands; otherwise
       *   Twilio's automatic reply and our TwiML reply can both be sent.
       * - YES is intentionally not reserved because it is common
       *   conversational text in a person-to-person messaging product.
       */
      const optOutType =
        String(req.body?.OptOutType || '')
          .trim()
          .toUpperCase();

      const STOP_KEYWORDS = [
        'STOP',
        'STOPALL',
        'UNSUBSCRIBE',
        'CANCEL',
        'END',
        'QUIT',
        'REVOKE',
        'OPTOUT',
      ];

      const START_KEYWORDS = [
        'START',
        'UNSTOP',
      ];

      const HELP_KEYWORDS = [
        'HELP',
        'INFO',
      ];

      const twilioManagedAction =
        ['STOP', 'START', 'HELP'].includes(optOutType)
          ? optOutType
          : null;

      const fallbackAction =
        STOP_KEYWORDS.includes(upperBody)
          ? 'STOP'
          : START_KEYWORDS.includes(upperBody)
            ? 'START'
            : HELP_KEYWORDS.includes(upperBody)
              ? 'HELP'
              : null;

      const complianceAction =
        twilioManagedAction ||
        fallbackAction;

      if (complianceAction) {
        try {
          const normalizedFrom =
            normalizeE164(fromNumber);

          const provider = 'twilio';

          if (!isE164(normalizedFrom)) {
            req.log?.info?.(
              {
                fromNumber,
                complianceAction,
              },
              '[webhook][twilio] compliance keyword from invalid phone'
            );

            return emptyTwilioResponse(res);
          }

          const safeSmsOptOutPayload = {
            MessageSid: MessageSid || null,
            From: normalizedFrom || null,
            To: To || null,
            Body: upperBody || null,
            OptOutType: optOutType || null,
            NumMedia: req.body?.NumMedia || null,
          };

          if (complianceAction === 'STOP') {
            const existing =
              await prisma.smsOptOut.findFirst({
                where: {
                  phone: normalizedFrom,
                  provider,
                },
              });

            if (existing) {
              await prisma.smsOptOut.update({
                where: {
                  id: existing.id,
                },
                data: {
                  reason: upperBody || 'STOP',
                  inboundMessageId:
                    MessageSid || null,
                  rawPayload:
                    safeSmsOptOutPayload,
                  ipAddress:
                    req.ip,
                  userAgent:
                    req.get?.('user-agent') || null,
                  createdAt:
                    new Date(),
                },
              });
            } else {
              await prisma.smsOptOut.create({
                data: {
                  phone:
                    normalizedFrom,
                  provider,
                  reason:
                    upperBody || 'STOP',
                  inboundMessageId:
                    MessageSid || null,
                  rawPayload:
                    safeSmsOptOutPayload,
                  ipAddress:
                    req.ip,
                  userAgent:
                    req.get?.('user-agent') || null,
                },
              });
            }

            req.log?.info?.(
              {
                from: normalizedFrom,
                twilioManaged:
                  Boolean(twilioManagedAction),
              },
              '[webhook][twilio] recorded OPT-OUT'
            );

            return emptyTwilioResponse(res);
          }

          if (complianceAction === 'START') {
            await prisma.smsOptOut.deleteMany({
              where: {
                phone: normalizedFrom,
                provider,
              },
            });

            req.log?.info?.(
              {
                from: normalizedFrom,
                twilioManaged:
                  Boolean(twilioManagedAction),
              },
              '[webhook][twilio] removed opt-out'
            );

            return emptyTwilioResponse(res);
          }

          req.log?.info?.(
            {
              from: normalizedFrom,
              twilioManaged:
                Boolean(twilioManagedAction),
            },
            '[webhook][twilio] handled HELP keyword'
          );

          return emptyTwilioResponse(res);
        } catch (error) {
          console.error(
            '[webhook][twilio] compliance handling error',
            error
          );

          return emptyTwilioResponse(res);
        }
      }
      // ----------------------------------------------------------------------

      // Basic validation (ack 200 to avoid retries on non-inbound noise)
      // NOTE: inbound MMS can be body-less, but Twilio will often still send Body=""
      // We allow body to be empty as long as there is media.
      if (!isE164(toNumber) || !isE164(fromNumber)) {
        req.log?.info?.({ toNumber, fromNumber }, '[webhook][twilio] ignored (invalid e164)');
        return emptyTwilioResponse(res);
      }

      // ✅ NEW: Parse inbound MMS media (NumMedia, MediaUrl0..N, MediaContentType0..N)
      const mediaCount = Number(req.body?.NumMedia || 0);
      const media = [];
      if (Number.isFinite(mediaCount) && mediaCount > 0) {
        for (let i = 0; i < mediaCount; i += 1) {
          const url = req.body?.[`MediaUrl${i}`];
          const contentType = req.body?.[`MediaContentType${i}`];
          if (url) {
            media.push({
              url: String(url),
              contentType: contentType ? String(contentType) : null,
            });
          }
        }
      }

      // If both empty body and no media, ignore
      const hasBody = Boolean(String(bodyText || '').trim());
      const hasMedia = media.length > 0;

      if (!hasBody && !hasMedia) {
        req.log?.info?.({ toNumber, fromNumber }, '[webhook][twilio] ignored (empty body + no media)');
        return emptyTwilioResponse(res);
      }

      // Record inbound SMS/MMS
      const rec = await recordInboundSms({
        toNumber,
        fromNumber,
        body: bodyText, // may be empty string if MMS-only
        provider: 'twilio',
        providerMessageId: MessageSid || null,
        media, // ✅ IMPORTANT: store as objects (url + contentType)
      });

      if (rec?.blocked) {
        req.log?.info?.(
          {
            userId: rec.userId,
            fromNumber: rec.fromNumber,
            providerMessageId: MessageSid || null,
          },
          '[sms:inbound] suppressed blocked PSTN number'
        );
      }

      /*
       * Notify the assigned user after successful persistence. Push delivery
       * is intentionally independent of the Twilio webhook response so an
       * APNs/FCM failure cannot cause Twilio to redeliver a saved message.
       */
      if (rec?.ok) {
        const trimmedBody = bodyText.trim();

        const notificationBody =
          trimmedBody ||
          (hasMedia ? 'New MMS received' : 'New SMS received');

        void sendPushToUser(rec.userId, {
          alert: {
            title: fromNumber,
            body: notificationBody.slice(0, 160),
          },
          sound: 'default',
          data: {
            type: 'sms_message',
            threadId: String(rec.threadId),
            fromNumber,
            toNumber,
          },
        })
          .then((result) => {
            console.log('[sms:inbound] push result', {
              userId: rec.userId,
              threadId: rec.threadId,
              result,
            });
          })
          .catch((error) => {
            console.warn(
              '[sms:inbound] push failed',
              error?.message || error
            );
          });
      }

      // Forwarding (skip loops: we never receive our own fwd clientRef back from Twilio)
      if (rec?.ok) {
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

        if (
          user?.forwardingEnabledSms &&
          !inQuietHours(user.forwardQuietHoursStart, user.forwardQuietHoursEnd)
        ) {
          // Forward to phone via Twilio
          if (user.forwardSmsToPhone && isE164(user.forwardPhoneNumber)) {
            // Keep forwarding text-only to avoid MMS auth/format edge cases on forward
            const forwardText = `From ${fromNumber}: ${bodyText || '[MMS]'}`.slice(0, 800);

            await sendSms({
              to: normalizeE164(user.forwardPhoneNumber),
              text: forwardText,
              from: toNumber,
              clientRef: `fwd:${rec.userId}:${Date.now()}`,
            });
          }

          // Forward to email (text-only; you can add media later if you want)
          if (user.forwardSmsToEmail && user.forwardEmail && isEmailAvailable()) {
            await sendMail({
              to: user.forwardEmail,
              subject: `SMS from ${fromNumber}`,
              text: bodyText || (hasMedia ? '[MMS received: media attached]' : ''),
            });
          }
        }
      }

      return emptyTwilioResponse(res);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[webhook][twilio] error', e);
      return res.sendStatus(500);
    }
  }
);

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
// router.post('/telnyx', express.json(), async (req, res) => {
//   try {
//     const ev = req.body?.data || req.body;
//     const type = ev?.event_type || ev?.type || 'unknown';
//     const p = ev?.payload || ev?.data || {};

//     // Normalize basic fields
//     const toRaw = p?.to || p?.to_number || p?.toPhoneNumber;
//     const fromRaw = p?.from || p?.from_number || p?.fromPhoneNumber;
//     const text = p?.text || p?.body || '';
//     const clientRef = p?.client_ref || p?.clientRef || null;

//     // Only process inbound messages
//     const isInbound = String(type).includes('message.received') || !!text;

//     // Basic validation
//     const toNumber = normalizeE164(toRaw);
//     const fromNumber = normalizeE164(fromRaw);
//     if (!isInbound || !isE164(toNumber) || !isE164(fromNumber) || !text) {
//       // Acknowledge anyway to avoid retries; log for observability
//       req.log?.info?.({ type, toRaw, fromRaw }, '[webhook][telnyx] ignored');
//       return res.sendStatus(200);
//     }

//     // Record in DB
//     const rec = await recordInboundSms({
//       toNumber,
//       fromNumber,
//       body: text,
//       provider: 'telnyx',
//     });

//     // Optional forward (skip if this was our own forwarded message)
//     if (rec?.ok && !isLoopRef(clientRef)) {
//       const user = await prisma.user.findUnique({
//         where: { id: rec.userId },
//         select: {
//           forwardingEnabledSms: true,
//           forwardSmsToPhone: true,
//           forwardSmsToEmail: true,
//           forwardPhoneNumber: true,
//           forwardEmail: true,
//           forwardQuietHoursStart: true,
//           forwardQuietHoursEnd: true,
//         },
//       });

//       if (user?.forwardingEnabledSms && !inQuietHours(user.forwardQuietHoursStart, user.forwardQuietHoursEnd)) {
//         // Phone forward
//         if (user.forwardSmsToPhone && isE164(user.forwardPhoneNumber)) {
//           await sendSmsWithFallback({
//             to: normalizeE164(user.forwardPhoneNumber),
//             text: `From ${fromNumber}: ${text}`.slice(0, 800),
//             clientRef: `fwd:${rec.userId}:${Date.now()}`,
//           });
//         }
//         // Email forward
//         if (user.forwardSmsToEmail && user.forwardEmail && transporter) {
//           await transporter.sendMail({
//             to: user.forwardEmail,
//             from: process.env.EMAIL_FROM || 'hello@chatforia.com',
//             subject: `SMS from ${fromNumber}`,
//             text,
//           });
//         }
//       }
//     }

//     res.sendStatus(200);
//   } catch (e) {
//     // eslint-disable-next-line no-console
//     console.error('[webhook][telnyx] error', e);
//     // Always 200 unless you want provider retries; here we signal server error
//     res.sendStatus(500);
//   }
// });

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
// router.post('/bandwidth', express.json(), async (req, res) => {
//   try {
//     const events = Array.isArray(req.body) ? req.body : [req.body];
//     for (const evt of events) {
//       const type = evt?.type || 'unknown';

//       // Only process inbound received messages
//       const isInbound = String(type).includes('message-received');
//       const toNumber = normalizeE164(evt?.to || evt?.message?.to);
//       const fromNumber = normalizeE164(evt?.from || evt?.message?.from);
//       const text = evt?.text || evt?.message?.text || '';
//       const tag = evt?.tag || evt?.message?.tag || null;

//       if (!isInbound || !isE164(toNumber) || !isE164(fromNumber) || !text) {
//         req.log?.info?.({ type, toNumber, fromNumber }, '[webhook][bandwidth] ignored');
//         continue;
//       }

//       const rec = await recordInboundSms({
//         toNumber,
//         fromNumber,
//         body: text,
//         provider: 'bandwidth',
//       });

//       if (rec?.ok && !isLoopRef(tag)) {
//         const user = await prisma.user.findUnique({
//           where: { id: rec.userId },
//           select: {
//             forwardingEnabledSms: true,
//             forwardSmsToPhone: true,
//             forwardSmsToEmail: true,
//             forwardPhoneNumber: true,
//             forwardEmail: true,
//             forwardQuietHoursStart: true,
//             forwardQuietHoursEnd: true,
//           },
//         );

//         if (user?.forwardingEnabledSms && !inQuietHours(user.forwardQuietHoursStart, user.forwardQuietHoursEnd)) {
//           if (user.forwardSmsToPhone && isE164(user.forwardPhoneNumber)) {
//             await sendSmsWithFallback({
//               to: normalizeE164(user.forwardPhoneNumber),
//               text: `From ${fromNumber}: ${text}`.slice(0, 800),
//               clientRef: `fwd:${rec.userId}:${Date.now()}`,
//             });
//           }
//           if (user.forwardSmsToEmail && user.forwardEmail && transporter) {
//             await transporter.sendMail({
//               to: user.forwardEmail,
//               from: process.env.EMAIL_FROM || 'hello@chatforia.com',
//               subject: `SMS from ${fromNumber}`,
//               text,
//             });
//           }
//         }
//       }
//     }

//     res.sendStatus(200);
//   } catch (e) {
//     // eslint-disable-next-line no-console
//     console.error('[webhook][bandwidth] error', e);
//     res.sendStatus(500);
//   }
// });

export default router;
