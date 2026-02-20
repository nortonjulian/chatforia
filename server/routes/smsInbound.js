import express from 'express';
import { twiml as Twiml, webhook as twilioWebhook } from 'twilio';
import prisma from '../utils/prismaClient.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

const smsInboundLimiter = rateLimit({ windowMs: 60*1000, max: 60 });

async function preventDuplicateProviderMessage(req, res, next) {
  const sid = req.body?.MessageSid;
  if (!sid) return next();
  const existing = await prisma.smsMessage.findUnique({ where: { providerMessageId: sid }, select: { id: true } });
  if (existing) return res.type('text/xml').send('<Response></Response>');
  next();
}

async function attachPhone(req, res, next) {
  const from = req.body?.From;
  if (!from) return next();
  let phone = await prisma.phone.findUnique({ where: { number: from } });
  if (!phone) phone = await prisma.phone.create({ data: { number: from } });
  req.phone = phone;
  next();
}

router.post(
  '/sms/inbound',
   smsInboundLimiter,
  twilioWebhook({ validate: true }), // requires process.env.TWILIO_AUTH_TOKEN
  async (req, res) => {
    const twiml = new Twiml.MessagingResponse();

    try {
      const from = req.body?.From; // e.g. "+1415..."
      const to = req.body?.To || process.env.TWILIO_NUMBER;
      const bodyRaw = (req.body?.Body || '').trim();

      // Normalized token for keyword matching
      const bodyNorm = bodyRaw.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();

      const STOP_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE']);
      const HELP_KEYWORDS = new Set(['HELP', 'INFO']);
      const START_KEYWORDS = new Set(['START', 'UNSTOP', 'RESUME', 'YES']);

      // Find or create Phone row (atomic-ish)
      let phone = await prisma.phone.findUnique({ where: { number: from } });

      if (!phone) {
        phone = await prisma.phone.create({
          data: { number: from },
        });
      }

      // Helper to persist the inbound SmsMessage (matching your model)
      const createInboundMessage = async (extra = {}) => {
        return prisma.smsMessage.create({
          data: {
            // threadId required in your model — if inbound SMS don't belong to a thread, you may use a default thread or nullable threadId
            // If threadId is required in your schema, you must decide what thread to attach. Here we try to set threadId = 0 if allowed.
            // Replace with your actual behavior (e.g., create or find a thread for that phone).
            threadId: extra.threadId ?? 0, // <-- adjust if threadId cannot be zero
            direction: 'in',
            fromNumber: from,
            toNumber: to,
            body: bodyRaw,
            provider: 'twilio',
            providerMessageId: req.body?.MessageSid || null,
            mediaUrls: req.body?.MediaUrl0 ? JSON.stringify([req.body?.MediaUrl0]) : null,
            // you can extend with `action` metadata in a separate column or metadata json
          },
        });
      };

      // STOP
      if (STOP_KEYWORDS.has(bodyNorm)) {
        await prisma.$transaction([
          prisma.phone.update({
            where: { number: from },
            data: { optedOut: true, optedOutAt: new Date() },
          }),
          prisma.smsMessage.create({
            data: {
              threadId: 0, // adjust as above
              direction: 'in',
              fromNumber: from,
              toNumber: to,
              body: bodyRaw,
              provider: 'twilio',
              providerMessageId: req.body?.MessageSid || null,
              // optional: action column not present in your model; else use SmsCarrierEvent
            },
          }),
          prisma.smsCarrierEvent.create({
            data: {
              phoneId: phone.id,
              type: 'STOP',
              rawText: bodyRaw,
              provider: 'twilio',
            },
          }),
        ]);

        twiml.message('Chatforia: You have been unsubscribed and will no longer receive messages. Reply START to resubscribe. Msg&Data rates may apply.');
        res.type('text/xml').send(twiml.toString());
        return;
      }

      // HELP
      if (HELP_KEYWORDS.has(bodyNorm)) {
        await prisma.$transaction([
          prisma.smsMessage.create({
            data: {
              threadId: 0,
              direction: 'in',
              fromNumber: from,
              toNumber: to,
              body: bodyRaw,
              provider: 'twilio',
              providerMessageId: req.body?.MessageSid || null,
            },
          }),
          prisma.smsCarrierEvent.create({
            data: {
              phoneId: phone.id,
              type: 'HELP',
              rawText: bodyRaw,
              provider: 'twilio',
            },
          }),
        ]);

        twiml.message('Chatforia Help: Msg frequency varies. Msg&Data rates may apply. Reply STOP to opt out. For more help email support@chatforia.com or visit https://chatforia.com/legal/sms');
        res.type('text/xml').send(twiml.toString());
        return;
      }

      // START / RESUME
      if (START_KEYWORDS.has(bodyNorm)) {
        await prisma.$transaction([
          prisma.phone.update({
            where: { number: from },
            data: { optedOut: false, optedOutAt: null },
          }),
          prisma.smsMessage.create({
            data: {
              threadId: 0,
              direction: 'in',
              fromNumber: from,
              toNumber: to,
              body: bodyRaw,
              provider: 'twilio',
              providerMessageId: req.body?.MessageSid || null,
            },
          }),
          prisma.smsCarrierEvent.create({
            data: {
              phoneId: phone.id,
              type: 'START',
              rawText: bodyRaw,
              provider: 'twilio',
            },
          }),
        ]);

        twiml.message('Chatforia: You are subscribed again. Reply STOP to opt out.');
        res.type('text/xml').send(twiml.toString());
        return;
      }

      // Non-keyword inbound: log message + optional routing
      await prisma.smsMessage.create({
        data: {
          threadId: 0,
          direction: 'in',
          fromNumber: from,
          toNumber: to,
          body: bodyRaw,
          provider: 'twilio',
          providerMessageId: req.body?.MessageSid || null,
        },
      });

      // Optionally enqueue for human support, or auto-respond with opt-out reminder
      // twiml.message('Chatforia: To unsubscribe reply STOP. For help reply HELP.');

      res.type('text/xml').send(twiml.toString());
    } catch (err) {
      console.error('sms inbound error', err);
      // Reply empty TwiML (200) to avoid Twilio retry storms
      res.type('text/xml').send(new Twiml.MessagingResponse().toString());
    }
  }
);

export default router;
