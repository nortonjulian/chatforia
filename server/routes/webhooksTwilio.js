import express from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { recordInboundSms } from '../services/smsService.js';
import prisma from '../utils/prismaClient.js';
import { normalizeE164 } from '../utils/phone.js';
import twilio from 'twilio';

const { VoiceResponse, MessagingResponse } = twilio.twiml;
const r = express.Router();

function getBaseUrl(req) {
  return (
    process.env.APP_API_ORIGIN?.replace(/\/+$/, '') ||
    `${req.protocol}://${req.get('host')}`
  );
}

async function findMatchingMissedCall({ userId, createdAt }) {
  return prisma.call.findFirst({
    where: {
      status: 'MISSED',
      OR: [
        { callerId: userId },
        { calleeId: userId },
      ],
      createdAt: {
        lte: createdAt,
        gte: new Date(createdAt.getTime() - 15 * 60 * 1000),
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      id: true,
    },
  });
}

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
 * If unanswered, fall through to voicemail recording.
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
    const fromNumber = normalizeE164(From || '');
    const baseUrl = getBaseUrl(req);

    const user = await prisma.user.findFirst({
      where: { assignedNumbers: { some: { e164: did } } },
      select: {
        id: true,
        forwardPhoneNumber: true,
        voicemailGreetingUrl: true,
        voicemailGreetingText: true,
        assignedNumbers: {
          where: { e164: did },
          select: { id: true, e164: true },
          take: 1,
        },
      },
    });

    if (!user || !user.forwardPhoneNumber) {
      twiml.say('The person you are trying to reach is not available. Goodbye.');
      twiml.hangup();
      res.type('text/xml').send(twiml.toString());
      return;
    }

    const dest = normalizeE164(user.forwardPhoneNumber);

    const dial = twiml.dial({
      callerId: did,
      timeout: 20,
      action: `/webhooks/voice/inbound/after-dial?userId=${encodeURIComponent(user.id)}&phoneNumberId=${encodeURIComponent(user.assignedNumbers[0]?.id ?? '')}&did=${encodeURIComponent(did)}&from=${encodeURIComponent(fromNumber)}`,
      method: 'POST',
    });

    dial.number(dest);

    res.type('text/xml').send(twiml.toString());
  })
);

/**
 * After Twilio finishes the forward attempt, decide whether to go to voicemail.
 */
r.post(
  '/voice/inbound/after-dial',
  express.urlencoded({ extended: false }),
  asyncHandler(async (req, res) => {
    const { DialCallStatus } = req.body || {};
    const { userId, phoneNumberId, did, from } = req.query || {};

    const twiml = new VoiceResponse();

    const shouldRecordVoicemail = ['no-answer', 'busy', 'failed', 'canceled'].includes(
      String(DialCallStatus || '').toLowerCase()
    );

    if (!shouldRecordVoicemail) {
      twiml.hangup();
      res.type('text/xml').send(twiml.toString());
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: Number(userId) },
      select: {
        voicemailGreetingUrl: true,
        voicemailGreetingText: true,
      },
    });

    if (user?.voicemailGreetingUrl) {
      twiml.play(user.voicemailGreetingUrl);
    } else if (user?.voicemailGreetingText?.trim()) {
      twiml.say(user.voicemailGreetingText.trim());
    } else {
      twiml.say('Please leave a voicemail after the tone.');
    }

    twiml.record({
      playBeep: true,
      maxLength: 120,
      timeout: 5,
      trim: 'trim-silence',
      action: `/webhooks/voice/voicemail/complete?userId=${encodeURIComponent(userId || '')}&phoneNumberId=${encodeURIComponent(phoneNumberId || '')}&did=${encodeURIComponent(did || '')}&from=${encodeURIComponent(from || '')}`,
      method: 'POST',
      recordingStatusCallback: `/webhooks/voice/voicemail/recording-status?userId=${encodeURIComponent(userId || '')}&phoneNumberId=${encodeURIComponent(phoneNumberId || '')}&did=${encodeURIComponent(did || '')}&from=${encodeURIComponent(from || '')}`,
      recordingStatusCallbackMethod: 'POST',
    });

    twiml.say('No recording received. Goodbye.');
    twiml.hangup();

    res.type('text/xml').send(twiml.toString());
  })
);

/**
 * Optional completion action after record verb returns.
 */
r.post(
  '/voice/voicemail/complete',
  express.urlencoded({ extended: false }),
  asyncHandler(async (req, res) => {
    const twiml = new VoiceResponse();
    twiml.say('Thank you. Goodbye.');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
  })
);

/**
 * Recording status callback: create voicemail and link to missed call.
 */
r.post(
  '/voice/voicemail/recording-status',
  express.urlencoded({ extended: false }),
  asyncHandler(async (req, res) => {
    res.status(200).send('ok');

    try {
      const {
        RecordingUrl,
        RecordingDuration,
        RecordingStatus,
      } = req.body || {};

      const { userId, phoneNumberId, did, from } = req.query || {};

      if (!userId || !did || !from) {
        console.error('[voicemail] missing query params', { query: req.query, body: req.body });
        return;
      }

      if (String(RecordingStatus || '').toLowerCase() !== 'completed') {
        console.log('[voicemail] ignoring non-completed recording status', RecordingStatus);
        return;
      }

      if (!RecordingUrl) {
        console.error('[voicemail] missing RecordingUrl');
        return;
      }

      const numericUserId = Number(userId);
      const numericPhoneNumberId = phoneNumberId ? Number(phoneNumberId) : null;
      const createdAt = new Date();

      const matchingCall = await findMatchingMissedCall({
        userId: numericUserId,
        createdAt,
      });

      await prisma.voicemail.create({
        data: {
          userId: numericUserId,
          phoneNumberId: Number.isNaN(numericPhoneNumberId) ? null : numericPhoneNumberId,
          fromNumber: normalizeE164(String(from)),
          toNumber: normalizeE164(String(did)),
          audioUrl: `${RecordingUrl}.mp3`,
          durationSec: RecordingDuration != null ? Number(RecordingDuration) : null,
          transcript: null,
          transcriptStatus: 'PENDING',
          relatedCallId: matchingCall?.id ?? null,
          createdAt,
        },
      });

      console.log('[voicemail] saved voicemail', {
        userId: numericUserId,
        relatedCallId: matchingCall?.id ?? null,
      });
    } catch (err) {
      console.error('[voicemail] failed to save voicemail', err);
    }
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

    res.status(200).send('ok');
  })
);

export default r;