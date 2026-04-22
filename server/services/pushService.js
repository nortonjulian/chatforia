import apn from 'apn';
import prisma from '../utils/prismaClient.js';

let provider = null;

/**
 * Lazily initialize APNs provider
 */
function getProvider() {
  if (provider) return provider;

  const {
    APNS_KEY,
    APNS_KEY_ID,
    APNS_TEAM_ID,
    APNS_TOPIC,
  } = process.env;

  if (!APNS_KEY || !APNS_KEY_ID || !APNS_TEAM_ID || !APNS_TOPIC) {
    console.warn('[push] APNs not configured');
    return null;
  }

  provider = new apn.Provider({
    token: {
      key: APNS_KEY,
      keyId: APNS_KEY_ID,
      teamId: APNS_TEAM_ID,
    },
    production: process.env.NODE_ENV === 'production',
  });

  return provider;
}

/**
 * Get all valid push tokens for a user
 */
async function getUserTokens(userId) {
  const devices = await prisma.device.findMany({
    where: {
      userId: Number(userId),
      revokedAt: null,
      pushToken: { not: null },
    },
    select: { pushToken: true },
  });

  return devices.map(d => d.pushToken).filter(Boolean);
}

/**
 * Generic push sender
 */
export async function sendPushToUser(userId, payload) {
  const apnProvider = getProvider();
  if (!apnProvider) {
    console.log('[push] skipped (no provider)', { userId, payload });
    return { ok: false, reason: 'no_provider' };
  }

  const tokens = await getUserTokens(userId);

  if (!tokens.length) {
    console.log('[push] no tokens for user', userId);
    return { ok: false, reason: 'no_tokens' };
  }

  const note = new apn.Notification();

  note.topic = process.env.APNS_TOPIC;
  note.alert = payload.alert || {};
  note.sound = payload.sound || 'default';
  note.payload = payload.data || {};

  try {
    const result = await apnProvider.send(note, tokens);

    if (result.failed?.length) {
      console.warn('[push] failed deliveries', result.failed.map(f => ({
        device: f.device,
        status: f.status,
        error: f.response || f.error?.message,
      })));
    }

    return {
      ok: result.sent?.length > 0,
      sent: result.sent?.length ?? 0,
      failed: result.failed?.length ?? 0,
    };
  } catch (err) {
    console.error('[push] send error', err);
    return { ok: false, error: err.message };
  }
}

/**
 * Incoming forwarded call notification
 */
export async function sendIncomingForwardedCallPush({
  userId,
  fromNumber,
  chatforiaNumber,
  callId,
  callSid,
}) {
  return sendPushToUser(userId, {
    alert: {
      title: 'Incoming call',
      body: `Call from ${fromNumber || 'Unknown'}`,
    },
    sound: 'default',
    data: {
      type: 'call_incoming',
      callId: callId ?? null,
      callSid: callSid ?? null,
      fromNumber: fromNumber ?? null,
      chatforiaNumber: chatforiaNumber ?? null,
      forwarded: true,
    },
  });
}

/**
 * Optional: Missed call push (nice UX upgrade)
 */
export async function sendMissedCallPush({
  userId,
  fromNumber,
  callId,
}) {
  return sendPushToUser(userId, {
    alert: {
      title: 'Missed call',
      body: `Missed call from ${fromNumber || 'Unknown'}`,
    },
    sound: 'default',
    data: {
      type: 'call_missed',
      callId: callId ?? null,
      fromNumber: fromNumber ?? null,
    },
  });
}