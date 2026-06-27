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
      key: APNS_KEY.replace(/\\n/g, '\n').replace(/^"|"$/g, ''),
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
    },
    select: {
      pushToken: true,
      pushProvider: true,
      apnsPushToken: true,
      fcmPushToken: true,
      voipPushToken: true,
    },
  });

  const unique = (items) => [...new Set(items.filter(Boolean))];

  return {
    apns: unique([
      ...devices.map(d => d.apnsPushToken),
      ...devices
        .filter(d => d.pushProvider === 'apns')
        .map(d => d.pushToken),
    ]),

    apnsVoip: unique([
      ...devices.map(d => d.voipPushToken),
      ...devices
        .filter(d => d.pushProvider === 'apns_voip')
        .map(d => d.pushToken),
    ]),

    fcm: unique([
      ...devices.map(d => d.fcmPushToken),
      ...devices
        .filter(d => d.pushProvider === 'fcm')
        .map(d => d.pushToken),
    ]),
  };
}

export async function sendVoipCallPushToUser(userId, payload) {
  const tokens = await getUserTokens(userId);

  if (!tokens.apnsVoip?.length) {
    console.warn('[push] no apns_voip tokens for user', userId);
    return {
      ok: false,
      apnsVoipSent: 0,
      apnsVoipFailed: 0,
    };
  }

  const apnProvider = getProvider();

  if (!apnProvider) {
    return {
      ok: false,
      apnsVoipSent: 0,
      apnsVoipFailed: tokens.apnsVoip.length,
    };
  }

  const note = new apn.Notification();

  note.topic = process.env.APNS_VOIP_TOPIC || `${process.env.APNS_TOPIC}.voip`;
  note.pushType = 'voip';
  note.priority = 10;
  note.expiry = Math.floor(Date.now() / 1000) + 30;

  note.payload = {
    type: 'call_incoming',
    callId: payload.callId == null ? '' : String(payload.callId),
    callerId: payload.callerId == null ? '' : String(payload.callerId),
    callerName: payload.callerName || 'Chatforia user',
    mode: payload.mode || 'AUDIO',
    roomName: payload.roomName || '',
    chatRoomId: payload.chatRoomId == null ? '' : String(payload.chatRoomId),
  };

  const result = await apnProvider.send(note, tokens.apnsVoip);

  return {
    ok: result.sent.length > 0,
    apnsVoipSent: result.sent.length,
    apnsVoipFailed: result.failed.length,
    result,
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
            channelId:
              payload.data?.type === 'call_incoming'
                ? 'chatforia_calls'
                : undefined,
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