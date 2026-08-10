import apn from 'apn';
import prisma from '../utils/prismaClient.js';
import { getFirebaseMessaging } from './firebaseAdmin.js';
import { resolveMessageNotificationSound } from '../config/messageToneCatalog.js';
import { getVoiceEligibleDevices } from './voiceDeviceService.js';

const providers = {
  production: null,
  sandbox: null,
};

const INVALID_APNS_REASONS = new Set([
  'BadDeviceToken',
  'DeviceTokenNotForTopic',
  'Unregistered',
]);

const INVALID_FCM_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
  'messaging/mismatched-credential',
  'messaging/sender-id-mismatch',
]);

async function cleanupInvalidFcmTokens(failed = []) {
  for (const failure of failed) {
    const token = failure?.token ? String(failure.token) : '';
    const code = failure?.code || '';

    if (!token || !INVALID_FCM_CODES.has(code)) continue;

    console.warn('[push] removing invalid FCM token', {
      code,
      token: `${token.slice(0, 10)}...${token.slice(-6)}`,
    });

    await prisma.device.updateMany({
      where: { fcmPushToken: token },
      data: { fcmPushToken: null },
    });

    await prisma.device.updateMany({
      where: {
        pushProvider: 'fcm',
        pushToken: token,
      },
      data: { pushToken: null },
    });
  }
}

function isApnsProduction() {
  const raw = process.env.APNS_PRODUCTION;

  if (raw != null) {
    return ['1', 'true', 'yes', 'production', 'prod']
      .includes(String(raw).toLowerCase().trim());
  }

  return process.env.NODE_ENV === 'production';
}

async function cleanupInvalidApnsTokens(
  failed = [],
  kind = 'alert',
  environment = 'production'
) {
  const isSandbox = environment === 'sandbox';

  const tokenField =
    kind === 'voip'
      ? isSandbox
        ? 'voipSandboxPushToken'
        : 'voipPushToken'
      : isSandbox
        ? 'apnsSandboxPushToken'
        : 'apnsPushToken';

  for (const failure of failed) {
    const token =
      failure?.device
        ? String(failure.device)
        : '';

    const reason =
      failure?.response?.reason ||
      failure?.error?.reason ||
      failure?.error?.message ||
      '';

    if (
      !token ||
      !INVALID_APNS_REASONS.has(reason)
    ) {
      continue;
    }

    console.warn(
      '[push] removing invalid APNs token',
      {
        kind,
        environment,
        reason,
        token:
          `${token.slice(0, 10)}...` +
          `${token.slice(-6)}`,
      }
    );

    await prisma.device.updateMany({
      where: {
        [tokenField]: token,
      },
      data: {
        [tokenField]: null,
      },
    });

    /*
     * Legacy/general APNs fields represent production alert
     * registrations only. Never clear them for sandbox or VoIP
     * failures.
     */
    if (
      kind === 'alert' &&
      environment === 'production'
    ) {
      await prisma.device.updateMany({
        where: {
          pushProvider: 'apns',
          pushToken: token,
        },
        data: {
          pushToken: null,
        },
      });
    }
  }
}

/**
 * Lazily initialize APNs provider
 */
function getProvider(environment = 'production') {
  const normalizedEnvironment =
    environment === 'sandbox'
      ? 'sandbox'
      : 'production';

  if (providers[normalizedEnvironment]) {
    return providers[normalizedEnvironment];
  }

  const {
    APNS_KEY,
    APNS_KEY_ID,
    APNS_TEAM_ID,
    APNS_TOPIC,
  } = process.env;

  if (
    !APNS_KEY ||
    !APNS_KEY_ID ||
    !APNS_TEAM_ID ||
    !APNS_TOPIC
  ) {
    console.warn('[push] APNs not configured');
    return null;
  }

  providers[normalizedEnvironment] =
    new apn.Provider({
      token: {
        key: APNS_KEY
          .replace(/\\n/g, '\n')
          .replace(/^"|"$/g, ''),
        keyId: APNS_KEY_ID,
        teamId: APNS_TEAM_ID,
      },
      production:
        normalizedEnvironment === 'production',
    });

  return providers[normalizedEnvironment];
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
      apnsSandboxPushToken: true,
      fcmPushToken: true,
      voipPushToken: true,
      voipSandboxPushToken: true,
    },
  });

  const unique = (items) =>
    [...new Set(items.filter(Boolean))];

  return {
    apnsProduction: unique([
      ...devices.map(
        (device) => device.apnsPushToken
      ),
      ...devices
        .filter(
          (device) =>
            device.pushProvider === 'apns'
        )
        .map(
          (device) => device.pushToken
        ),
    ]),

    apnsSandbox: unique(
      devices.map(
        (device) =>
          device.apnsSandboxPushToken
      )
    ),

    apnsVoipProduction: unique(
      devices.map(
        (device) => device.voipPushToken
      )
    ),

    apnsVoipSandbox: unique(
      devices.map(
        (device) =>
          device.voipSandboxPushToken
      )
    ),

    fcm: unique([
      ...devices.map(
        (device) => device.fcmPushToken
      ),
      ...devices
        .filter(
          (device) =>
            device.pushProvider === 'fcm'
        )
        .map(
          (device) => device.pushToken
        ),
    ]),
  };
}

export async function sendVoipCallPushToUser(
  userId,
  payload
) {
  const isAudioCall =
    String(payload?.mode || '')
      .trim()
      .toUpperCase() === 'AUDIO';

  let groups;

  if (isAudioCall) {
    /*
     * App-to-app AUDIO calls use authoritative device-specific
     * Twilio Voice registration. The CallKit VoIP push must target
     * those same eligible iOS devices rather than every historical
     * non-revoked VoIP token on the account.
     */
    const voiceDevices =
      await getVoiceEligibleDevices(userId);

    const productionTokens =
      voiceDevices
        .filter(
          (device) =>
            device.voicePushEnvironment ===
              'production' &&
            Boolean(device.voipPushToken)
        )
        .map(
          (device) => device.voipPushToken
        );

    const sandboxTokens =
      voiceDevices
        .filter(
          (device) =>
            device.voicePushEnvironment ===
              'sandbox' &&
            Boolean(device.voipSandboxPushToken)
        )
        .map(
          (device) =>
            device.voipSandboxPushToken
        );

    groups = [
      {
        environment: 'production',
        tokens: [
          ...new Set(productionTokens),
        ],
      },
      {
        environment: 'sandbox',
        tokens: [
          ...new Set(sandboxTokens),
        ],
      },
    ];
  } else {
    /*
     * Preserve existing behavior for VIDEO and any other current
     * VoIP-push consumers. This migration is specifically for the
     * Twilio Voice AUDIO path.
     */
    const tokens =
      await getUserTokens(userId);

    groups = [
      {
        environment: 'production',
        tokens: tokens.apnsVoipProduction,
      },
      {
        environment: 'sandbox',
        tokens: tokens.apnsVoipSandbox,
      },
    ];
  }

  const tokenCount =
    groups.reduce(
      (total, group) =>
        total + group.tokens.length,
      0
    );

  if (!tokenCount) {
    console.warn(
      '[push] no apns_voip tokens for user',
      userId
    );

    return {
      ok: false,
      apnsVoipSent: 0,
      apnsVoipFailed: 0,
    };
  }

  const aggregate = {
    sent: [],
    failed: [],
  };

  for (const group of groups) {
    if (!group.tokens.length) continue;

    const apnProvider =
      getProvider(group.environment);

    if (!apnProvider) {
      aggregate.failed.push(
        ...group.tokens.map((device) => ({
          device,
          error: new Error(
            `APNs ${group.environment} provider unavailable`
          ),
        }))
      );

      continue;
    }

    const note = new apn.Notification();

    note.topic =
      process.env.APNS_VOIP_TOPIC ||
      `${process.env.APNS_TOPIC}.voip`;

    note.pushType = 'voip';
    note.priority = 10;
    note.expiry = 0;

    /*
     * apn@2.2.0 omits the apns-expiration header when expiry is 0.
     * Force the literal header so APNs does not persist stale calls.
     */
    const originalHeaders =
      note.headers.bind(note);

    note.headers = () => ({
      ...originalHeaders(),
      'apns-expiration': 0,
    });

    note.payload = {
      type: 'call_incoming',
      callId:
        payload.callId == null
          ? ''
          : String(payload.callId),
      callerId:
        payload.callerId == null
          ? ''
          : String(payload.callerId),
      callerName:
        payload.callerName ||
        'Chatforia user',
      mode:
        payload.mode ||
        'AUDIO',
      roomName:
        payload.roomName ||
        '',
      chatRoomId:
        payload.chatRoomId == null
          ? ''
          : String(payload.chatRoomId),
    };

    const result =
      await apnProvider.send(
        note,
        group.tokens
      );

    aggregate.sent.push(...result.sent);
    aggregate.failed.push(...result.failed);

    console.log(
      '[push] APNs VoIP result',
      JSON.stringify(
        {
          userId,
          environment:
            group.environment,
          tokenCount:
            group.tokens.length,
          sent:
            result.sent.length,
          failed:
            result.failed.map(
              (failure) => ({
                device:
                  failure.device
                    ? `${String(
                        failure.device
                      ).slice(0, 10)}...${String(
                        failure.device
                      ).slice(-6)}`
                    : null,
                status:
                  failure.status,
                response:
                  failure.response ||
                  null,
                reason:
                  failure.response
                    ?.reason ||
                  null,
                error:
                  failure.error
                    ?.message ||
                  failure.error ||
                  null,
              })
            ),
        },
        null,
        2
      )
    );

    await cleanupInvalidApnsTokens(
      result.failed,
      'voip',
      group.environment
    );
  }

  return {
    ok: aggregate.sent.length > 0,
    apnsVoipSent:
      aggregate.sent.length,
    apnsVoipFailed:
      aggregate.failed.length,
    result: aggregate,
  };
}

/**
 * Generic push sender
 */
export async function sendPushToUser(userId, payload) {
  const tokens = await getUserTokens(userId);

  const results = {
    apns: {
      sent: [],
      failed: [],
    },
    fcm: null,
  };

  const apnsGroups = [
    {
      environment: 'production',
      tokens: tokens.apnsProduction,
    },
    {
      environment: 'sandbox',
      tokens: tokens.apnsSandbox,
    },
  ];

  const hasApnsTokens =
    apnsGroups.some(
      (group) => group.tokens.length > 0
    );

  if (
    !payload.skipApns &&
    hasApnsTokens &&
    payload.alert
  ) {
    const notificationType =
      String(payload.data?.type || '')
        .trim()
        .toLowerCase();

    const usesAccountMessageTone =
      notificationType === 'message_new' ||
      notificationType === 'sms_message';

    let apnsSound =
      payload.sound === null
        ? null
        : payload.sound || 'default';

    if (usesAccountMessageTone) {
      const notificationUser =
        await prisma.user.findUnique({
          where: {
            id: Number(userId),
          },
          select: {
            messageTone: true,
            plan: true,
          },
        });

      apnsSound =
        resolveMessageNotificationSound({
          messageTone:
            notificationUser?.messageTone,
          plan:
            notificationUser?.plan,
        });
    }

    for (const group of apnsGroups) {
      if (!group.tokens.length) continue;

      const apnProvider =
        getProvider(group.environment);

      if (!apnProvider) {
        results.apns.failed.push(
          ...group.tokens.map(
            (device) => ({
              device,
              error: new Error(
                `APNs ${group.environment} provider unavailable`
              ),
            })
          )
        );

        continue;
      }

      const note = new apn.Notification();

      note.topic =
        process.env.APNS_TOPIC;

      note.pushType = 'alert';
      note.priority = 10;
      note.alert =
        payload.alert || {};

      /*
       * A null sound represents Chatforia's Vibrate selection.
       * APNs has no custom vibration-pattern field.
       */
      if (apnsSound) {
        note.sound = apnsSound;
      }

      note.payload =
        payload.data || {};

      const result =
        await apnProvider.send(
          note,
          group.tokens
        );

      results.apns.sent.push(
        ...result.sent
      );

      results.apns.failed.push(
        ...result.failed
      );

      console.log(
        '[push] APNs result',
        JSON.stringify(
          {
            userId,
            environment:
              group.environment,
            tokenCount:
              group.tokens.length,
            sent:
              result.sent.length,
            failed:
              result.failed.map(
                (failure) => ({
                  device:
                    failure.device
                      ? `${String(
                          failure.device
                        ).slice(0, 10)}...${String(
                          failure.device
                        ).slice(-6)}`
                      : null,
                  status:
                    failure.status,
                  response:
                    failure.response ||
                    null,
                  reason:
                    failure.response
                      ?.reason ||
                    null,
                  error:
                    failure.error
                      ?.message ||
                    failure.error ||
                    null,
                })
              ),
          },
          null,
          2
        )
      );

      await cleanupInvalidApnsTokens(
        result.failed,
        'alert',
        group.environment
      );
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
      const isIncomingCall = stringData.type === 'call_incoming';
      const isEndedCall = stringData.type === 'call_ended';

      const lifecycleCollapseKey =
        stringData.callId && (isIncomingCall || isEndedCall)
          ? `chatforia_call_${stringData.callId}`
          : undefined;

      stringData.title = payload.alert?.title || stringData.senderName || 'Chatforia';
      stringData.body = payload.alert?.body || 'New message';

      const message = {
        tokens: tokens.fcm,
        data: stringData,
        android: {
          priority: 'high',

          ...(isIncomingCall
            ? {
                // A ringing invitation is useful only while the call is live.
                ttl: 30_000,
              }
            : {}),

          ...(isEndedCall
            ? {
                // Keep terminal cancellation available long enough to replace
                // a queued incoming invitation.
                ttl: 60_000,
              }
            : {}),

          ...(lifecycleCollapseKey
            ? {
                // Incoming and terminal events for one call replace one
                // another while queued by FCM.
                collapseKey: lifecycleCollapseKey,
              }
            : {}),
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

      if (results.fcm.failureCount > 0) {
        const failed = results.fcm.responses
          .map((response, index) => ({
            token: tokens.fcm[index],
            success: response.success,
            code: response.error?.code || null,
            message: response.error?.message || null,
          }))
          .filter((item) => !item.success);

        console.warn(
          '[push] FCM failures',
          JSON.stringify(
            {
              userId,
              failed: failed.map((failure) => ({
                token: failure.token
                  ? `${String(failure.token).slice(0, 10)}...${String(failure.token).slice(-6)}`
                  : null,
                code: failure.code,
                message: failure.message,
              })),
            },
            null,
            2
          )
        );

        await cleanupInvalidFcmTokens(failed);
      }
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