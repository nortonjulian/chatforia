import Boom from '@hapi/boom';
import prisma from '../utils/prismaClient.js';
import { normalizeE164, isE164 } from '../utils/phone.js';
import { URL } from 'node:url';

// Twilio Voice: we initiate Leg A (your user) and let TwiML webhooks do the rest.
// Required env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, plus either TWILIO_FROM_NUMBER or Messaging Service (for SMS only).
// For voice, the "from" must be a Twilio-owned phone number (your Chatforia DID on Twilio).
const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_VOICE_STATUS_CALLBACK_URL,
  APP_API_ORIGIN,          // e.g. https://api.chatforia.com
  TWILIO_VOICE_WEBHOOK_URL // optional override for the base webhook URL
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
    select: { assignedNumbers: { select: { e164: true }, take: 1, orderBy: { id: 'asc' } }, forwardPhoneNumber: true }
  });
  const from = user?.assignedNumbers?.[0]?.e164 ? normalizeE164(user.assignedNumbers[0].e164) : null;
  if (!from) throw Boom.preconditionFailed('No Chatforia number assigned');
  const userPhone = normalizeE164(user?.forwardPhoneNumber || '');
  return { from, userPhone };
}

export async function startAliasCall({ userId, to }) {
  const dest = normalizeE164(to);
  if (!isE164(dest)) throw Boom.badRequest('Invalid destination phone');
  const { from, userPhone } = await getUserAliasNumber(userId);
  if (!isE164(userPhone)) throw Boom.preconditionFailed('User forwarding phone not verified');

  // Build TwiML webhook URLs
  const baseUrl = (TWILIO_VOICE_WEBHOOK_URL || APP_API_ORIGIN || '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw Boom.preconditionFailed('Missing APP_API_ORIGIN or TWILIO_VOICE_WEBHOOK_URL for voice webhooks');
  }
  // Leg A TwiML URL: says "press 1 to connect", posts DTMF to /webhooks/voice/alias/confirm
  const legAUrl = new URL('/webhooks/voice/alias/legA', baseUrl);
  legAUrl.searchParams.set('userId', String(userId));
  legAUrl.searchParams.set('from', from);
  legAUrl.searchParams.set('to', dest);

  const client = await getTwilioClient();
  const call = await client.calls.create({
    to: userPhone,
    from: from, // must be a Twilio-owned DID; use the user’s assigned Chatforia DID on Twilio
    url: legAUrl.toString(),
    machineDetection: 'Enable', // optional; detects voicemail on user leg
    statusCallback: TWILIO_VOICE_STATUS_CALLBACK_URL || undefined,
    statusCallbackEvent: TWILIO_VOICE_STATUS_CALLBACK_URL
      ? ['initiated', 'ringing', 'answered', 'completed']
      : undefined,
    statusCallbackMethod: 'POST',
  });

  // Return early; Twilio will fetch TwiML and continue via webhooks.
  return {
    ok: true,
    from,
    to: dest,
    userPhone,
    stage: 'legA-dialing',
    callSid: call?.sid || null,
  };
}
