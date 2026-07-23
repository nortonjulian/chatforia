import express from 'express';
import rateLimit from 'express-rate-limit';
import twilio from 'twilio';
import prisma from '../utils/prismaClient.js';
import { normalizeE164, isE164 } from '../utils/phone.js';
import { emitToUser } from '../services/socketBus.js';
import { sendIncomingForwardedCallPush } from '../services/pushService.js';

const { VoiceResponse } = twilio.twiml;
const router = express.Router();

router.use(express.urlencoded({ extended: false }));

const voiceLimiter = rateLimit({ windowMs: 60 * 1000, max: 120 });

function inQuietHours(start, end, now = new Date()) {
  if (start == null || end == null) return false;
  const h = now.getHours();
  return (
    (start < end && h >= start && h < end) ||
    (start > end && (h >= start || h < end))
  );
}

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

  res.status(200).send('OK');

  try {
    const ts =
      Timestamp && !Number.isNaN(Date.parse(Timestamp))
        ? new Date(Timestamp)
        : new Date();

    const safeVoicePayload = {
      CallSid: CallSid || null,
      CallStatus: CallStatus || null,
      Direction: Direction || null,
      AnsweredBy: AnsweredBy || null,
      Duration: Duration || null,
      ErrorCode: req.body?.ErrorCode || null,
    };

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
        rawPayload: safeVoicePayload,
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
        rawPayload: safeVoicePayload,
      },
    });
  } catch (err) {
    console.error('[Twilio Voice Status] failed to log', {
      message: err?.message || String(err),
      code: err?.code || null,
    });
  }
});

/**
 * Inbound PSTN call to a Chatforia number.
 * Twilio should point the number's Voice webhook here.
 */
router.post('/inbound', voiceLimiter, async (req, res) => {
  const twiml = new VoiceResponse();

  try {
    const rawTo = req.body?.To || '';
    const rawFrom = req.body?.From || '';
    const callSid = req.body?.CallSid || null;

    const toNumber = normalizeE164(rawTo);
    const fromNumber = normalizeE164(rawFrom);

    if (!isE164(toNumber)) {
      twiml.say('The number called is not valid.');
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }

    const phoneNumber = await prisma.phoneNumber.findUnique({
      where: { e164: toNumber },
      select: {
        id: true,
        e164: true,
        assignedUserId: true,
        assignedUser: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!phoneNumber?.assignedUserId || !phoneNumber.assignedUser) {
      twiml.say('This number is not available.');
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }

    const user = phoneNumber.assignedUser;

    let callRecord = null;

    try {
      callRecord = await prisma.call.create({
        data: {
          callerId: user.id,
          calleeId: null,
          mode: 'AUDIO',
          status: 'RINGING',
          externalPhone: fromNumber,
          twilioCallSid: callSid || null,
          fromLabel: fromNumber || null,
          toLabel: toNumber || null,
        },
        select: {
          id: true,
          createdAt: true,
          twilioCallSid: true,
        },
      });
    } catch (err) {
      console.error('[Twilio Voice inbound] failed to create Call row', err);
    }

    if (callRecord?.id) {
      emitToUser(user.id, 'call:incoming', {
        callId: callRecord.id,
        mode: 'AUDIO',
        roomId: null,
        createdAt: callRecord.createdAt,
        forwarded: false,
        fromNumber,
        toNumber,
        fromUser: null,
      });

      void sendIncomingForwardedCallPush({
        userId: user.id,
        fromNumber,
        chatforiaNumber: toNumber,
        callId: callRecord.id,
        callSid,
      }).catch((err) => {
        console.error('[Twilio Voice inbound] push failed', err);
      });
    }

    const fallbackUrl =
      `/webhooks/voice/inbound-app-complete` +
      `?userId=${encodeURIComponent(String(user.id))}` +
      `&from=${encodeURIComponent(fromNumber || '')}` +
      `&to=${encodeURIComponent(toNumber || '')}` +
      `&callId=${encodeURIComponent(String(callRecord?.id || ''))}` +
      `&callSid=${encodeURIComponent(callSid || '')}`;

    const dial = twiml.dial({
      callerId: toNumber,
      answerOnBridge: true,
      timeout: 25,
      action: fallbackUrl,
      method: 'POST',
    });

    dial.client(`user_${user.id}`);

    return res.type('text/xml').send(twiml.toString());

  } catch (err) {
    console.error('[Twilio Voice inbound] error', err);
    twiml.say('An error occurred. Goodbye.');
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  }
});

router.post('/inbound-app-complete', async (req, res) => {
  const twiml = new VoiceResponse();

  try {
    const dialStatus = req.body?.DialCallStatus;
    const userId = Number(req.query.userId);
    const fromNumber = normalizeE164(req.query.from || '');
    const toNumber = normalizeE164(req.query.to || '');

    console.log('[Twilio Voice inbound-app-complete]', {
      dialStatus,
      userId,
    });

    // If the app call completed normally, do not forward afterward.
    if (dialStatus === 'completed') {
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }

    if (!Number.isFinite(userId)) {
      twiml.say('The person you called is unavailable.');
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        forwardingEnabledCalls: true,
        forwardToPhoneE164: true,
        forwardQuietHoursStart: true,
        forwardQuietHoursEnd: true,
        voicemailEnabled: true,
        voicemailGreetingText: true,
        voicemailGreetingUrl: true,
      },
    });

    if (!user) {
      twiml.say('The person you called is unavailable.');
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }

    const forwardingAllowed =
      user.forwardingEnabledCalls &&
      isE164(user.forwardToPhoneE164) &&
      !inQuietHours(user.forwardQuietHoursStart, user.forwardQuietHoursEnd);

    if (forwardingAllowed) {
      const dial = twiml.dial({
        callerId: toNumber,
        answerOnBridge: true,
        timeout: 20,
        action: '/webhooks/voice/dial-complete',
        method: 'POST',
      });

      dial.number(user.forwardToPhoneE164);

      return res.type('text/xml').send(twiml.toString());
    }

    if (user.voicemailEnabled) {
      if (user.voicemailGreetingText) {
        twiml.say(user.voicemailGreetingText);
      } else {
        twiml.say('The person you called is unavailable. Please leave a message after the tone.');
      }

      twiml.record({
        maxLength: 120,
        playBeep: true,
        trim: 'trim-silence',
        timeout: 5,
        action: '/webhooks/voice/voicemail-complete',
        method: 'POST',
      });

      return res.type('text/xml').send(twiml.toString());
    }

    twiml.say('The person you called is unavailable.');
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  } catch (err) {
    console.error('[Twilio Voice inbound-app-complete] error', err);
    twiml.say('An error occurred. Goodbye.');
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  }
});



router.post('/app-call-complete', async (req, res) => {
  const twiml = new VoiceResponse();

  try {
    const dialCallStatus =
      String(req.body?.DialCallStatus || '').toLowerCase();

    const callerUserId = Number(req.query?.callerUserId);
    const calleeUserId = Number(req.query?.calleeUserId);
    const backendCallId = Number(req.query?.backendCallId);
    const dialCallDuration = req.body?.DialCallDuration;

    const validCallerUserId =
      Number.isInteger(callerUserId) && callerUserId > 0;

    const validCalleeUserId =
      Number.isInteger(calleeUserId) && calleeUserId > 0;

    const validBackendCallId =
      Number.isInteger(backendCallId) && backendCallId > 0;

    let relatedCallId = null;
    let existing = null;

    if (validBackendCallId) {
      existing = await prisma.call.findFirst({
        where: {
          id: backendCallId,
          ...(validCallerUserId ? { callerId: callerUserId } : {}),
          ...(validCalleeUserId ? { calleeId: calleeUserId } : {}),
        },
        select: {
          id: true,
          callerId: true,
          calleeId: true,
          startedAt: true,
        },
      });
    }

    // Current clients should send backendCallId. This fallback keeps
    // voicemail reliable for an older iOS or Android build that does not.
    if (!existing && validCallerUserId && validCalleeUserId) {
      const recentCutoff = new Date(Date.now() - 5 * 60 * 1000);

      existing = await prisma.call.findFirst({
        where: {
          callerId: callerUserId,
          calleeId: calleeUserId,
          mode: 'AUDIO',
          status: {
            in: ['INITIATED', 'RINGING', 'ACTIVE'],
          },
          createdAt: {
            gte: recentCutoff,
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          callerId: true,
          calleeId: true,
          startedAt: true,
        },
      });
    }

    if (existing) {
      let status = 'ENDED';
      let endReason = 'completed';

      if (dialCallStatus === 'no-answer') {
        status = 'MISSED';
        endReason = 'no_answer';
      } else if (dialCallStatus === 'busy') {
        status = 'FAILED';
        endReason = 'busy';
      } else if (dialCallStatus === 'failed') {
        status = 'FAILED';
        endReason = 'failed';
      } else if (dialCallStatus === 'canceled') {
        status = 'DECLINED';
        endReason = 'canceled';
      }

      const endedAt = new Date();

      const updated = await prisma.call.update({
        where: { id: existing.id },
        data: {
          status,
          startedAt:
            dialCallStatus === 'completed'
              ? existing.startedAt ?? endedAt
              : existing.startedAt ?? undefined,
          endedAt,
          durationSec:
            dialCallDuration != null
              ? Number(dialCallDuration)
              : undefined,
          endReason,
        },
        select: {
          id: true,
          callerId: true,
          calleeId: true,
          status: true,
          endedAt: true,
          durationSec: true,
          endReason: true,
        },
      });

      relatedCallId = updated.id;

      const endedPayload = {
        callId: updated.id,
        status: updated.status,
        endedAt: updated.endedAt,
        durationSec: updated.durationSec,
        reason: updated.endReason,
        forwarded: false,
      };

      // For voicemail, keep the caller connected to Twilio while ending
      // the unanswered recipient's ringing state.
      if (dialCallStatus === 'completed') {
        emitToUser(updated.callerId, 'call:ended', endedPayload);
      }

      if (
        updated.calleeId &&
        updated.calleeId !== updated.callerId
      ) {
        emitToUser(updated.calleeId, 'call:ended', endedPayload);
      }
    }


    if (dialCallStatus === 'completed') {
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }

    const shouldOfferVoicemail = [
      'no-answer',
      'busy',
      'failed',
    ].includes(dialCallStatus);

    if (!shouldOfferVoicemail || !validCalleeUserId) {
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }

    const [callee, caller] = await Promise.all([
      prisma.user.findUnique({
        where: { id: calleeUserId },
        select: {
          id: true,
          voicemailEnabled: true,
          voicemailGreetingUrl: true,
          voicemailGreetingText: true,
          assignedNumbers: {
            select: {
              id: true,
              e164: true,
            },
            take: 1,
            orderBy: {
              id: 'asc',
            },
          },
        },
      }),
      validCallerUserId
        ? prisma.user.findUnique({
            where: { id: callerUserId },
            select: {
              id: true,
              assignedNumbers: {
                select: {
                  e164: true,
                },
                take: 1,
                orderBy: {
                  id: 'asc',
                },
              },
            },
          })
        : Promise.resolve(null),
    ]);

    if (!callee?.voicemailEnabled) {
      twiml.say('The person you called is unavailable.');
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }

    if (callee.voicemailGreetingUrl) {
      twiml.play(callee.voicemailGreetingUrl);
    } else if (callee.voicemailGreetingText?.trim()) {
      twiml.say(callee.voicemailGreetingText.trim());
    } else {
      twiml.say(
        'The person you called is unavailable. Please leave a message after the tone.'
      );
    }

    const calleeNumber = callee.assignedNumbers?.[0] || null;
    const callerNumber = caller?.assignedNumbers?.[0]?.e164 || null;

    const did =
      calleeNumber?.e164 ||
      `app:user_${calleeUserId}`;

    const from =
      callerNumber ||
      (validCallerUserId
        ? `app:user_${callerUserId}`
        : 'app:unknown');

    const recordingParams = new URLSearchParams({
      userId: String(calleeUserId),
      phoneNumberId: String(calleeNumber?.id || ''),
      did,
      from,
    });

    if (relatedCallId) {
      recordingParams.set(
        'relatedCallId',
        String(relatedCallId)
      );
    }

    twiml.record({
      playBeep: true,
      maxLength: 120,
      timeout: 5,
      trim: 'trim-silence',
      action:
        `/webhooks/voice/voicemail/complete?` +
        recordingParams.toString(),
      method: 'POST',
      recordingStatusCallback:
        `/webhooks/voice/voicemail/recording-status?` +
        recordingParams.toString(),
      recordingStatusCallbackMethod: 'POST',
    });

    twiml.say('No recording received. Goodbye.');
    twiml.hangup();

    return res.type('text/xml').send(twiml.toString());
  } catch (err) {
    console.error('[Twilio Voice app-call-complete] error', err);
    twiml.say('An error occurred. Goodbye.');
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  }
});

router.post('/client', async (req, res) => {
  const twiml = new VoiceResponse();

  try {
    const { To, From } = req.body || {};
    const identity = (From || '').replace(/^client:/, '');
    const to = (To || '').trim();

    if (!to) {
      twiml.say('Missing destination.');
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }

    const numericUserId = Number(to);

    if (/^\d{1,9}$/.test(to) && !Number.isNaN(numericUserId)) {
      const targetUser = await prisma.user.findUnique({
        where: { id: numericUserId },
        select: { id: true },
      });

      if (!targetUser) {
        twiml.say('The Chatforia user you called was not found.');
        twiml.hangup();
        return res.type('text/xml').send(twiml.toString());
      }

      const appCallerUserId =
        identity.startsWith('user_')
          ? Number(identity.slice('user_'.length))
          : null;

      const appBackendCallIdRaw =
        req.query?.backendCallId ||
        req.body?.backendCallId ||
        null;

      const appBackendCallId = appBackendCallIdRaw
        ? Number(appBackendCallIdRaw)
        : null;

      const completionParams = new URLSearchParams({
        calleeUserId: String(numericUserId),
      });

      if (Number.isInteger(appCallerUserId) && appCallerUserId > 0) {
        completionParams.set('callerUserId', String(appCallerUserId));
      }

      if (Number.isInteger(appBackendCallId) && appBackendCallId > 0) {
        completionParams.set('backendCallId', String(appBackendCallId));
      }

      const dial = twiml.dial({
        answerOnBridge: true,
        timeout: 25,
        action: `/webhooks/voice/app-call-complete?${completionParams.toString()}`,
        method: 'POST',
      });

      dial.client(`user_${numericUserId}`);

      return res.type('text/xml').send(twiml.toString());
    }

    let callerId = process.env.TWILIO_DEFAULT_CALLER_ID || null;
    if (identity.startsWith('user_')) {
      const userId = Number(identity.split('_')[1]);
      if (!Number.isNaN(userId)) {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            assignedNumbers: {
              select: { e164: true },
              take: 1,
              orderBy: { id: 'asc' },
            },
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
        return res.type('text/xml').send(twiml.toString());
      }

      const browserUserId = identity.startsWith('user_')
        ? Number(identity.split('_')[1])
        : null;

      const parentCallSid = req.body?.CallSid || null;

      const backendCallIdRaw =
        req.query?.backendCallId ||
        req.body?.backendCallId ||
        null;

      const backendCallId = backendCallIdRaw
        ? Number(backendCallIdRaw)
        : null;

      if (Number.isFinite(browserUserId) && parentCallSid) {
        try {
          const recentCutoff = new Date(Date.now() - 5 * 60 * 1000);

          let existing = null;

          if (Number.isInteger(backendCallId) && backendCallId > 0) {
            existing = await prisma.call.findFirst({
              where: {
                id: backendCallId,
                callerId: browserUserId,
              },
              select: {
                id: true,
                twilioCallSid: true,
              },
            });
          }

          if (!existing) {
            existing = await prisma.call.findFirst({
              where: {
                OR: [
                  { twilioCallSid: parentCallSid },
                  {
                    callerId: browserUserId,
                    calleeId: null,
                    mode: 'AUDIO',
                    externalPhone: dest,
                    twilioCallSid: null,
                    status: {
                      in: ['INITIATED', 'RINGING', 'ACTIVE'],
                    },
                    createdAt: {
                      gte: recentCutoff,
                    },
                  },
                ],
              },
              orderBy: {
                createdAt: 'desc',
              },
              select: {
                id: true,
                twilioCallSid: true,
              },
            });
          }

          if (existing) {
            if (!existing.twilioCallSid) {
              await prisma.call.update({
                where: { id: existing.id },
                data: {
                  twilioCallSid: parentCallSid,
                  fromLabel: callerId || null,
                  toLabel: dest,
                },
              });
            }
          } else {
            await prisma.call.create({
              data: {
                callerId: browserUserId,
                calleeId: null,
                mode: 'AUDIO',
                status: 'INITIATED',
                externalPhone: dest,
                twilioCallSid: parentCallSid,
                fromLabel: callerId || null,
                toLabel: dest,
                participants: {
                  create: [
                    {
                      userId: browserUserId,
                      role: 'HOST',
                      status: 'JOINED',
                      joinedAt: new Date(),
                    },
                  ],
                },
              },
            });
          }
        } catch (err) {
          console.error('[Twilio Voice client] failed to create browser PSTN call row', err);
        }
      }

      const dial = twiml.dial({
        ...(callerId ? { callerId } : {}),
        answerOnBridge: true,
        timeout: 30,
        action: '/webhooks/voice/dial-complete',
        method: 'POST',
      });

      dial.number(dest);

      console.log('[voice/client TwiML]', {
        To,
        From,
        identity,
        to,
        dest,
        callerId,
        xml: twiml.toString(),
      });

      return res.type('text/xml').send(twiml.toString());
  } catch (err) {
    console.error('[Twilio Voice client] error', err);
    twiml.say('An error occurred. Goodbye.');
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  }
});

router.post('/dial-complete', async (req, res) => {
  const twiml = new VoiceResponse();

  try {
    const callSid = req.body?.CallSid || null;
    const dialCallSid = req.body?.DialCallSid || null;
    const dialCallStatus = String(req.body?.DialCallStatus || '').toLowerCase();
    const dialCallDuration = req.body?.DialCallDuration;

    if (callSid || dialCallSid) {
      const existing = await prisma.call.findFirst({
        where: {
          OR: [
            ...(callSid ? [{ twilioCallSid: callSid }] : []),
            ...(dialCallSid ? [{ twilioCallSid: dialCallSid }] : []),
          ],
        },
        select: {
          id: true,
          callerId: true,
          startedAt: true,
        },
      });

      if (existing) {
        let status = 'ENDED';
        let endReason = 'completed';

        if (dialCallStatus === 'no-answer') {
          status = 'MISSED';
          endReason = 'no_answer';
        } else if (dialCallStatus === 'busy') {
          status = 'FAILED';
          endReason = 'busy';
        } else if (dialCallStatus === 'failed') {
          status = 'FAILED';
          endReason = 'failed';
        } else if (dialCallStatus === 'canceled') {
          status = 'DECLINED';
          endReason = 'canceled';
        }

        const endedAt = new Date();

        const updated = await prisma.call.update({
          where: { id: existing.id },
          data: {
            status,
            startedAt:
              dialCallStatus === 'completed'
                ? existing.startedAt ?? endedAt
                : existing.startedAt ?? undefined,
            endedAt,
            durationSec: dialCallDuration != null ? Number(dialCallDuration) : undefined,
            endReason,
          },
          select: {
            id: true,
            callerId: true,
            status: true,
            endedAt: true,
            durationSec: true,
            endReason: true,
          },
        });

        emitToUser(updated.callerId, 'call:ended', {
          callId: updated.id,
          status: updated.status,
          endedAt: updated.endedAt,
          durationSec: updated.durationSec,
          reason: updated.endReason,
          forwarded: true,
        });
      }
    }

    if (dialCallStatus === 'no-answer' || dialCallStatus === 'busy' || dialCallStatus === 'failed') {
      twiml.say('The person you called is unavailable. Please leave a message after the tone.');
      twiml.record({
        maxLength: 120,
        playBeep: true,
        trim: 'trim-silence',
        timeout: 5,
        action: '/webhooks/voice/voicemail-complete',
        method: 'POST',
      });
      return res.type('text/xml').send(twiml.toString());
    }

    return res.type('text/xml').send(twiml.toString());
  } catch (err) {
    console.error('[Twilio Voice dial-complete] error', err);
    return res.type('text/xml').send(twiml.toString());
  }
});

export default router;