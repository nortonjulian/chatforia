import apn from 'apn';
import prisma from '../utils/prismaClient.js';
import { getFirebaseMessaging } from './firebaseAdmin.js';

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
    select: {
      pushToken: true,
      pushProvider: true,
    },
  });

  return {
    apns: devices
      .filter(d => d.pushProvider === 'apns')
      .map(d => d.pushToken)
      .filter(Boolean),

    fcm: devices
      .filter(d => d.pushProvider === 'fcm')
      .map(d => d.pushToken)
      .filter(Boolean),
  };
}

/**
 * Generic push sender
 */
export async function sendPushToUser(userId, payload) {
  const tokens = await getUserTokens(userId);

  const results = {
    apns: null,
    fcm: null,
  };

  if (tokens.apns.length) {
    const apnProvider = getProvider();

    if (apnProvider) {
      const note = new apn.Notification();

      note.topic = process.env.APNS_TOPIC;
      note.alert = payload.alert || {};
      note.sound = payload.sound || 'default';
      note.payload = payload.data || {};

      results.apns = await apnProvider.send(note, tokens.apns);
    }
  }

  if (tokens.fcm.length) {
  const messaging = getFirebaseMessaging();

  if (messaging) {
    console.log('[push] Sending FCM push', {
      userId,
      count: tokens.fcm.length,
    });

    results.fcm = await messaging.sendEachForMulticast({
      tokens: tokens.fcm,
      notification: {
        title: payload.alert?.title || 'Chatforia',
        body: payload.alert?.body || '',
      },
      data: Object.fromEntries(
        Object.entries(payload.data || {}).map(([key, value]) => [
          key,
          value == null ? '' : String(value),
        ])
      ),
      android: {
        priority: 'high',
        notification: {
          sound: payload.sound || 'default',
        },
      },
    });
  }
}

  return {
    ok: Boolean(
      results.apns?.sent?.length ||
      results.fcm?.successCount
    ),
    apnsSent: results.apns?.sent?.length ?? 0,
    apnsFailed: results.apns?.failed?.length ?? 0,
    fcmSent: results.fcm?.successCount ?? 0,
    fcmFailed: results.fcm?.failureCount ?? 0,
  };
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