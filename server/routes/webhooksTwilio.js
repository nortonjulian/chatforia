import express from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { recordInboundSms } from '../services/smsService.js';
import prisma from '../utils/prismaClient.js';
import { normalizeE164 } from '../utils/phone.js';
import twilio from 'twilio';

const { VoiceResponse, MessagingResponse } = twilio.twiml;
const r = express.Router();

/**
 * Leg A of alias call: user’s forwarding phone.
 */
r.post(
  '/voice/alias/legA',
  express.urlencoded({ extended: false }),
  asyncHandler(async (req, res) => {
    const { userId, from, to } = req.query || {};
    console.log('Twilio voice alias legA:', { query: req.query, body: req.body });

    const twiml = new VoiceResponse();

    const gather = twiml.gather({
      numDigits: 1,
      method: 'POST',
      action: `/webhooks/voice/alias/confirm?userId=${encodeURIComponent(
        userId || ''
      )}&from=${encodeURIComponent(from || '')}&to=${encodeURIComponent(
        to || ''
      )}`,
      timeout: 10,
    });

    gather.say(
      'You have a Chatforia call. Press 1 to connect. If you did not expect this call, you may hang up.'
    );

    twiml.say('We did not receive any input. Goodbye.');
    twiml.hangup();

    res.type('text/xml').send(twiml.toString());
  })
);

/**
 * Confirm legA input; connect to destination if digit is 1.
 */
r.post(
  '/voice/alias/confirm',
  express.urlencoded({ extended: false }),
  asyncHandler(async (req, res) => {
    const { Digits } = req.body || {};
    const { from, to } = req.query || {};
    console.log('Twilio voice alias confirm:', { query: req.query, body: req.body });

    const twiml = new VoiceResponse();

    if (Digits === '1' && from && to) {
      const dest = normalizeE164(to);
      const callerId = normalizeE164(from);

      const dial = twiml.dial({ callerId });
      dial.number(dest);

      twiml.say('Connecting your call.');
    } else {
      twiml.say('Call cancelled. Goodbye.');
      twiml.hangup();
    }

    res.type('text/xml').send(twiml.toString());
  })
);

/**
 * Direct inbound call to a user’s DID.
 */
r.post(
  '/voice/inbound',
  express.urlencoded({ extended: false }),
  asyncHandler(async (req, res) => {
    const { To, From } = req.body || {};
    console.log('Twilio inbound voice:', req.body);

    const twiml = new VoiceResponse();

    if (!To) {
      twiml.say('We could not determine the destination number. Goodbye.');
      twiml.hangup();
      res.type('text/xml').send(twiml.toString());
      return;
    }

    const did = normalizeE164(To);

    const user = await prisma.user.findFirst({
      where: { assignedNumbers: { some: { e164: did } } },
      select: { forwardPhoneNumber: true },
    });

    if (!user || !user.forwardPhoneNumber) {
      twiml.say('The person you are trying to reach is not available. Goodbye.');
      twiml.hangup();
      res.type('text/xml').send(twiml.toString());
      return;
    }

    const dest = normalizeE164(user.forwardPhoneNumber);

    const dial = twiml.dial({ callerId: did });
    dial.number(dest);

    res.type('text/xml').send(twiml.toString());
  })
);

/**
 * POST /webhooks/status
 * Twilio delivery status callback
 */
r.post(
  '/status',
  express.urlencoded({ extended: false }),
  asyncHandler(async (req, res) => {
    const {
      MessageSid,
      MessageStatus,
      To,
      From,
      ErrorCode,
      ErrorMessage,
    } = req.body || {};

    console.log(`[Twilio Status] ${MessageSid}: ${MessageStatus}`, {
      To,
      From,
      ErrorCode,
      ErrorMessage,
    });

    // Optional: forward to messageMonitor (if created)
    // await messageMonitor.handleStatusUpdate({ ...req.body });

    res.status(200).send('ok');
  })
);

export default r;