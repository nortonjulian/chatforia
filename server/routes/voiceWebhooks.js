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

export default router;
