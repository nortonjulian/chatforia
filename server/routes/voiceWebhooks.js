import express from 'express';
import rateLimit from 'express-rate-limit';
import twilio from 'twilio';
import prisma from '../utils/prismaClient.js';   
import { normalizeE164, isE164 } from '../utils/phone.js';

const { VoiceResponse } = twilio.twiml;
const router = express.Router();

// Twilio posts webhooks as x-www-form-urlencoded by default.
router.use(express.urlencoded({ extended: false }));


router.post('/status', async (req, res) => {
  const {
    CallSid,
    CallStatus,
    From,
    To,
    Direction,
    AnsweredBy,
    Timestamp,
    Duration,
  } = req.body || {};

  // Always ack Twilio quickly; DB failure should not break webhooks.
  res.status(200).send('OK');

  try {
    const ts =
      Timestamp && !Number.isNaN(Date.parse(Timestamp))
        ? new Date(Timestamp)
        : new Date();

    await prisma.voiceLog.upsert({
      where: { callSid: CallSid || '' },
      update: {
        status: (CallStatus || 'unknown').toUpperCase(),
        from: From || null,
        to: To || null,
        direction: Direction || null,
        answeredBy: AnsweredBy || null,
        timestamp: ts,
        durationSec: Duration != null ? Number(Duration) : null,
        rawPayload: req.body,
      },
      create: {
        callSid: CallSid || '',
        status: (CallStatus || 'unknown').toUpperCase(),
        from: From || null,
        to: To || null,
        direction: Direction || null,
        answeredBy: AnsweredBy || null,
        timestamp: ts,
        durationSec: Duration != null ? Number(Duration) : null,
        rawPayload: req.body,
      },
    });

    // Optional dev log
    if (process.env.NODE_ENV !== 'production') {
      console.log('[Twilio Voice Status] logged', CallSid, CallStatus);
    }
  } catch (err) {
    console.error('[Twilio Voice Status] failed to log', err);
  }
});

router.post('/client', async (req, res) => {
  const twiml = new VoiceResponse();

  try {
    const { To, From } = req.body || {};
    // From will look like "client:user:123" if you set identity = "user:123"
    const identity = (From || '').replace(/^client:/, '');

    // Destination the browser requested
    const to = (To || '').trim();

    if (!to) {
      twiml.say('Missing destination.');
      twiml.hangup();
      res.type('text/xml').send(twiml.toString());
      return;
    }

    // Resolve callerId (user’s Chatforia DID) if possible
    let callerId = process.env.TWILIO_DEFAULT_CALLER_ID || null;
    if (identity.startsWith('user:')) {
      const userId = Number(identity.split(':')[1]);
      if (!Number.isNaN(userId)) {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            assignedNumbers: { select: { e164: true }, take: 1, orderBy: { id: 'asc' } },
          },
        });
        const num = user?.assignedNumbers?.[0]?.e164;
        if (num && isE164(num)) {
          callerId = normalizeE164(num);
        }
      }
    }

    const dest = normalizeE164(to);
    if (!isE164(dest)) {
      twiml.say('The number you dialed is not valid.');
      twiml.hangup();
      res.type('text/xml').send(twiml.toString());
      return;
    }

    // Dial PSTN from user’s DID (or fallback callerId)
    const dial = callerId
      ? twiml.dial({ callerId })
      : twiml.dial();

    dial.number(dest);

    res.type('text/xml').send(twiml.toString());
  } catch (err) {
    console.error('[Twilio Voice client] error', err);
    twiml.say('An error occurred. Goodbye.');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
  }
});

export default router;
