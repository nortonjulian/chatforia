import Boom from '@hapi/boom';
import prisma from '../utils/prismaClient.js';
import { normalizeE164, isE164 } from '../utils/phone.js';
import { URL } from 'node:url';

// Twilio Voice: we initiate Leg A (your user) and let TwiML webhooks do the rest.
// Required env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, plus either TWILIO_FROM_NUMBER or Messaging Service.
// For voice, the "from" must be a Twilio-owned phone number.
const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_VOICE_STATUS_CALLBACK_URL,
  APP_API_ORIGIN,
  TWILIO_VOICE_WEBHOOK_URL,
} = process.env;

async function getTwilioClient() {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw Boom.preconditionFailed('Twilio voice not configured (missing SID/AUTH TOKEN)');
  }

  const mod = await import('twilio');
  const twilio = mod.default ?? mod;

  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

async function getUserAliasNumber(userId) {
  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: {
      assignedNumbers: {
        select: { e164: true },
        take: 1,
        orderBy: { id: 'asc' },
      },
      forwardingEnabledCalls: true,
      forwardToPhoneE164: true,
    },
  });

  const from = user?.assignedNumbers?.[0]?.e164
    ? normalizeE164(user.assignedNumbers[0].e164)
    : null;

  if (!from) {
    throw Boom.preconditionFailed('No Chatforia number assigned');
  }

  if (!user?.forwardingEnabledCalls) {
    throw Boom.preconditionFailed('Call forwarding is not enabled');
  }

  const userPhone = normalizeE164(user?.forwardToPhoneE164 || '');

  if (!isE164(userPhone)) {
    throw Boom.preconditionFailed('User call forwarding phone not verified');
  }

  return { from, userPhone };
}

function withBackendCallId(rawUrl, backendCallId) {
  if (!rawUrl || !backendCallId) return rawUrl || undefined;

  const url = new URL(rawUrl);
  url.searchParams.set('backendCallId', String(backendCallId));

  return url.toString();
}

async function findPendingBackendCall({ userId, dest, rawTo }) {
  const recentCutoff = new Date(Date.now() - 5 * 60 * 1000);

  const candidates = Array.from(
    new Set(
      [dest, String(rawTo || '').trim()].filter(Boolean)
    )
  );

  return prisma.call.findFirst({
    where: {
      callerId: Number(userId),
      calleeId: null,
      mode: 'AUDIO',
      externalPhone: {
        in: candidates,
      },
      twilioCallSid: null,
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
      externalPhone: true,
      twilioCallSid: true,
    },
  });
}

export async function startAliasCall({ userId, to, callId = null }) {
  const dest = normalizeE164(to);

  if (!isE164(dest)) {
    throw Boom.badRequest('Invalid destination phone');
  }

  const { from, userPhone } = await getUserAliasNumber(userId);

  if (!isE164(userPhone)) {
    throw Boom.preconditionFailed('User call forwarding phone not verified');
  }

  let backendCall = null;

  if (callId) {
    backendCall = await prisma.call.findUnique({
      where: { id: Number(callId) },
      select: {
        id: true,
        callerId: true,
        externalPhone: true,
        twilioCallSid: true,
      },
    });

    if (!backendCall) {
      throw Boom.notFound('Call record not found');
    }

    if (backendCall.callerId !== Number(userId)) {
      throw Boom.forbidden('Call record belongs to another user');
    }

    const existingDest = backendCall.externalPhone
      ? normalizeE164(backendCall.externalPhone)
      : null;

    if (existingDest && existingDest !== dest) {
      throw Boom.badRequest('Call record destination does not match');
    }
  } else {
    backendCall = await findPendingBackendCall({
      userId,
      dest,
      rawTo: to,
    });
  }

  const baseUrl = (TWILIO_VOICE_WEBHOOK_URL || APP_API_ORIGIN || '').replace(/\/+$/, '');

  if (!baseUrl) {
    throw Boom.preconditionFailed('Missing APP_API_ORIGIN or TWILIO_VOICE_WEBHOOK_URL for voice webhooks');
  }

  const legAUrl = new URL('/webhooks/voice/alias/legA', baseUrl);
  legAUrl.searchParams.set('userId', String(userId));
  legAUrl.searchParams.set('from', from);
  legAUrl.searchParams.set('to', dest);

  if (backendCall?.id) {
    legAUrl.searchParams.set('backendCallId', String(backendCall.id));
  }

  const statusCallbackUrl = withBackendCallId(
    TWILIO_VOICE_STATUS_CALLBACK_URL,
    backendCall?.id
  );

  const client = await getTwilioClient();

  const call = await client.calls.create({
    to: userPhone,
    from,
    url: legAUrl.toString(),
    machineDetection: 'Enable',
    statusCallback: statusCallbackUrl,
    statusCallbackEvent: statusCallbackUrl
      ? ['initiated', 'ringing', 'answered', 'completed']
      : undefined,
    statusCallbackMethod: 'POST',
  });

  let resolvedCallId = backendCall?.id ?? null;

  if (call?.sid) {
    const existingSidOwner = await prisma.call.findUnique({
      where: { twilioCallSid: call.sid },
      select: { id: true },
    });

    if (existingSidOwner && existingSidOwner.id !== backendCall?.id) {
      resolvedCallId = existingSidOwner.id;

      console.warn('[voiceBridge] Twilio SID already belongs to another call', {
        twilioCallSid: call.sid,
        existingCallId: existingSidOwner.id,
        requestedCallId: backendCall?.id ?? null,
      });
    } else if (backendCall?.id) {
      const updated = await prisma.call.update({
        where: { id: backendCall.id },
        data: {
          status: 'INITIATED',
          externalPhone: dest,
          twilioCallSid: call.sid,
          fromLabel: from,
          toLabel: dest,
        },
        select: {
          id: true,
        },
      });

      resolvedCallId = updated.id;
    } else {
      try {
        const created = await prisma.call.create({
          data: {
            callerId: Number(userId),
            calleeId: null,
            mode: 'AUDIO',
            status: 'INITIATED',
            externalPhone: dest,
            twilioCallSid: call.sid,
            fromLabel: from,
            toLabel: dest,
            participants: {
              create: [
                {
                  userId: Number(userId),
                  role: 'HOST',
                  status: 'JOINED',
                  joinedAt: new Date(),
                },
              ],
            },
          },
          select: {
            id: true,
          },
        });

        resolvedCallId = created.id;
      } catch (err) {
        const existingAfterRace = await prisma.call.findUnique({
          where: { twilioCallSid: call.sid },
          select: { id: true },
        });

        if (!existingAfterRace) {
          throw err;
        }

        resolvedCallId = existingAfterRace.id;
      }
    }
  }

  return {
    ok: true,
    from,
    to: dest,
    userPhone,
    stage: 'legA-dialing',
    callSid: call?.sid || null,
    callId: resolvedCallId,
    resolvedCallId,
  };
}