import apn from 'apn';
import prisma from '../utils/prismaClient.js';
import { getFirebaseMessaging } from './firebaseAdmin.js';

let provider = null;

const INVALID_APNS_REASONS = new Set([
  'BadDeviceToken',
  'DeviceTokenNotForTopic',
  'Unregistered',
]);

function isApnsProduction() {
  const raw = process.env.APNS_PRODUCTION;

  if (raw != null) {
    return ['1', 'true', 'yes', 'production', 'prod']
      .includes(String(raw).toLowerCase().trim());
  }

  return process.env.NODE_ENV === 'production';
}

async function cleanupInvalidApnsTokens(failed = [], kind = 'alert') {
  for (const failure of failed) {
    const token = failure?.device ? String(failure.device) : '';
    const reason =
      failure?.response?.reason ||
      failure?.error?.reason ||
      failure?.error?.message ||
      '';

    if (!token || !INVALID_APNS_REASONS.has(reason)) continue;

    console.warn('[push] removing invalid APNs token', {
      kind,
      reason,
      token: `${token.slice(0, 10)}...${token.slice(-6)}`,
    });

    if (kind === 'voip') {
      await prisma.device.updateMany({
        where: { voipPushToken: token },
        data: { voipPushToken: null },
      });

      await prisma.device.updateMany({
        where: {
          pushProvider: 'apns_voip',
          pushToken: token,
        },
        data: { pushToken: null },
      });
    } else {
      await prisma.device.updateMany({
        where: { apnsPushToken: token },
        data: { apnsPushToken: null },
      });

      await prisma.device.updateMany({
        where: {
          pushProvider: 'apns',
          pushToken: token,
        },
        data: { pushToken: null },
      });
    }
  }
}

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
    production: isApnsProduction(),
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
  note.expiry = Math.floor(Date.now() / 1000) + 60;

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

  console.log(
    '[push] APNs VoIP result',
    JSON.stringify(
      {
        userId,
        tokenCount: tokens.apnsVoip.length,
        sent: result.sent.length,
        failed: result.failed.map((failure) => ({
          device: failure.device
            ? `${String(failure.device).slice(0, 10)}...${String(failure.device).slice(-6)}`
            : null,
          status: failure.status,
          response: failure.response || null,
          reason: failure.response?.reason || null,
          error: failure.error?.message || failure.error || null,
        })),
      },
      null,
      2
    )
  );

  await cleanupInvalidApnsTokens(result.failed, 'voip');

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
      note.pushType = 'alert';
      note.priority = 10;
      note.alert = payload.alert || {};
      note.sound = payload.sound || 'default';
      note.payload = payload.data || {};

      results.apns = await apnProvider.send(note, tokens.apns);

      console.log(
        '[push] APNs result',
        JSON.stringify(
          {
            userId,
            tokenCount: tokens.apns.length,
            sent: results.apns.sent.length,
            failed: results.apns.failed.map((failure) => ({
              device: failure.device
                ? `${String(failure.device).slice(0, 10)}...${String(failure.device).slice(-6)}`
                : null,
              status: failure.status,
              response: failure.response || null,
              reason: failure.response?.reason || null,
              error: failure.error?.message || failure.error || null,
            })),
          },
          null,
          2
        )
      );

      await cleanupInvalidApnsTokens(results.apns.failed, 'alert');
    }
  }

  if (tokens.fcm.length) {
    const messaging = getFirebaseMessaging();

    if (messaging) {
      console.log('[push] Sending FCM push', {
        userId,
        count: tokens.fcm.length,
      });

      const stringData = Object.fromEntries(
        Object.entries(payload.data || {}).map(([key, value]) => [
          key,
          value == null ? '' : String(value),
        ])
      );

      const isMissedCall = stringData.type === 'call_missed';

      stringData.title = payload.alert?.title || stringData.senderName || 'Chatforia';
      stringData.body = payload.alert?.body || 'New message';

      const message = {
        tokens: tokens.fcm,
        data: stringData,
        android: {
          priority: 'high',
        },
      };

      if (isMissedCall) {
        message.notification = {
          title: payload.alert?.title || 'Missed call',
          body: payload.alert?.body || '',
        };

        message.android.notification = {
          sound: payload.sound || 'default',
          channelId: 'chatforia_missed_calls',
        };
      }

      results.fcm = await messaging.sendEachForMulticast(message);
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