import { jest } from '@jest/globals';

const providerSendMock = jest.fn();
const providerConstructorMock = jest.fn();
const notificationConstructorMock = jest.fn();

class MockProvider {
  constructor(options) {
    this.production = options.production;

    providerConstructorMock({
      production: options.production,
    });
  }

  send(note, tokens) {
    return providerSendMock({
      production: this.production,
      note,
      tokens,
    });
  }
}

class MockNotification {
  constructor() {
    notificationConstructorMock();
  }

  headers() {
    return {};
  }
}

const mockPrisma = {
  device: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  message: {
    findMany: jest.fn(),
  },
  smsThread: {
    findMany: jest.fn(),
  },
  call: {
    count: jest.fn(),
  },
  voicemail: {
    count: jest.fn(),
  },
  threadState: {
    findMany: jest.fn(),
  },
};

const getFirebaseMessagingMock = jest.fn();
const resolveMessageNotificationSoundMock =
  jest.fn(() => 'Chatforia_Default.caf');

const getVoiceEligibleDevicesMock = jest.fn();
const authorizedPushRegistrationsMock = jest.fn();

await jest.unstable_mockModule('apn', () => ({
  __esModule: true,
  default: {
    Provider: MockProvider,
    Notification: MockNotification,
  },
}));

await jest.unstable_mockModule(
  '../utils/prismaClient.js',
  () => ({
    __esModule: true,
    default: mockPrisma,
  })
);

await jest.unstable_mockModule(
  '../services/firebaseAdmin.js',
  () => ({
    __esModule: true,
    getFirebaseMessaging:
      getFirebaseMessagingMock,
  })
);

await jest.unstable_mockModule(
  '../config/messageToneCatalog.js',
  () => ({
    __esModule: true,
    resolveMessageNotificationSound:
      resolveMessageNotificationSoundMock,
  })
);

await jest.unstable_mockModule(
  '../services/voiceDeviceService.js',
  () => ({
    __esModule: true,
    getVoiceEligibleDevices:
      getVoiceEligibleDevicesMock,
  })
);

await jest.unstable_mockModule('../services/pushAuthorityService.js', () => ({
  authorizedPushRegistrations: authorizedPushRegistrationsMock,
  pushAuthorityMode: () => process.env.PUSH_AUTHORITY_MODE === 'strict' ? 'strict' : 'shadow',
  revokeInvalidProviderToken: jest.fn(),
}));

const {
  sendPushToUser,
  sendVoipCallPushToUser,
  sendIncomingForwardedCallPush,
} = await import('../pushService.js');

const productionAlertToken = 'prod-alert-token';
const sandboxAlertToken = 'sandbox-alert-token';
const productionVoipToken = 'prod-voip-token';
const sandboxVoipToken = 'sandbox-voip-token';

function devicesWithEveryToken() {
  return [
    {
      pushToken: productionAlertToken,
      pushProvider: 'apns',
      apnsPushToken: productionAlertToken,
      apnsSandboxPushToken: sandboxAlertToken,
      fcmPushToken: null,
      voipPushToken: productionVoipToken,
      voipSandboxPushToken: sandboxVoipToken,
    },
  ];
}

function successfulResult(tokens) {
  return {
    sent: tokens.map((device) => ({
      device,
    })),
    failed: [],
  };
}

describe('pushService APNs environment routing', () => {
  beforeAll(() => {
    process.env.APNS_KEY =
      '-----BEGIN PRIVATE KEY-----\\nmock\\n-----END PRIVATE KEY-----';
    process.env.APNS_KEY_ID = 'KEY123';
    process.env.APNS_TEAM_ID = 'TEAM123';
    process.env.APNS_TOPIC = 'com.chatforia.app';
    process.env.APNS_VOIP_TOPIC =
      'com.chatforia.app.voip';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PUSH_AUTHORITY_MODE = 'shadow';
    authorizedPushRegistrationsMock.mockResolvedValue([]);

    mockPrisma.device.findMany.mockResolvedValue(
      devicesWithEveryToken()
    );

    mockPrisma.device.updateMany.mockResolvedValue({
      count: 1,
    });

    mockPrisma.user.findUnique.mockResolvedValue({
      messageTone: 'Default.mp3',
      plan: 'FREE',
    });

    // Badge-state defaults for push-routing tests:
    // no unread conversations, missed calls, or voicemails.
    mockPrisma.message.findMany.mockResolvedValue([]);
    mockPrisma.smsThread.findMany.mockResolvedValue([]);
    mockPrisma.call.count.mockResolvedValue(0);
    mockPrisma.voicemail.count.mockResolvedValue(0);
    mockPrisma.threadState.findMany.mockResolvedValue([]);

    getVoiceEligibleDevicesMock.mockResolvedValue([
      {
        deviceId: 'ios-production-device',
        platform: 'iOS 26.6',
        voiceIdentity:
          'user_7_device_ios_production_device',
        voiceRegisteredAt: new Date(),
        voiceRegistrationVer: 1,
        voicePushEnvironment: 'production',
        voipPushToken: productionVoipToken,
        voipSandboxPushToken: null,
      },
      {
        deviceId: 'ios-sandbox-device',
        platform: 'iOS 26.6',
        voiceIdentity:
          'user_7_device_ios_sandbox_device',
        voiceRegisteredAt: new Date(),
        voiceRegistrationVer: 1,
        voicePushEnvironment: 'sandbox',
        voipPushToken: null,
        voipSandboxPushToken: sandboxVoipToken,
      },
    ]);

    getFirebaseMessagingMock.mockReturnValue(null);

    providerSendMock.mockImplementation(
      async ({ tokens }) =>
        successfulResult(tokens)
    );
  });

  it(
    'routes production and sandbox alert tokens through matching providers',
    async () => {
      const result = await sendPushToUser(7, {
        alert: {
          title: 'New message',
          body: 'Hello',
        },
        sound: 'default',
        data: {
          type: 'sms_message',
          threadId: '30',
        },
      });

      expect(providerSendMock).toHaveBeenCalledTimes(2);

      expect(providerSendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          production: true,
          tokens: [productionAlertToken],
        })
      );

      expect(providerSendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          production: false,
          tokens: [sandboxAlertToken],
        })
      );

      expect(result).toMatchObject({
        ok: true,
        apnsSent: 2,
        apnsFailed: 0,
        fcmSent: 0,
        fcmFailed: 0,
      });
    }
  );

  it('omits the duplicate alert only for a dialed iOS Voice device', async () => {
    mockPrisma.device.findMany.mockResolvedValueOnce([
      {
        deviceId: 'ringing-iphone', voicePushEnvironment: 'production',
        apnsPushToken: 'ringing-alert', voipPushToken: 'ringing-voip',
        pushProvider: 'apns', pushToken: 'ringing-alert',
      },
      {
        deviceId: 'fallback-iphone', voicePushEnvironment: null,
        apnsPushToken: 'fallback-alert', voipPushToken: null,
      },
      {
        deviceId: 'stale-row', voicePushEnvironment: null,
        apnsPushToken: 'ringing-alert', voipPushToken: null,
      },
    ]);

    await sendIncomingForwardedCallPush({
      userId: 7,
      fromNumber: '+15550001111',
      callKitDeviceIds: ['ringing-iphone'],
    });

    expect(providerSendMock).toHaveBeenCalledTimes(1);
    expect(providerSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        production: true,
        tokens: ['fallback-alert'],
      })
    );
  });

  it('keeps ordinary missed-call alerts on a Voice device', async () => {
    mockPrisma.device.findMany.mockResolvedValueOnce([
      {
        deviceId: 'ringing-iphone', voicePushEnvironment: 'production',
        apnsPushToken: 'ringing-alert', voipPushToken: 'ringing-voip',
      },
    ]);

    await sendPushToUser(7, {
      alert: { title: 'Missed call', body: 'Please call back' },
      data: { type: 'call_missed' },
    });

    expect(providerSendMock).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: ['ringing-alert'] })
    );
  });

  it(
    'routes production and sandbox VoIP tokens through matching providers',
    async () => {
      const result =
        await sendVoipCallPushToUser(7, {
          callId: 91,
          callerId: 4,
          callerName: 'Julian',
          mode: 'AUDIO',
          roomName: 'call-91',
          chatRoomId: 12,
        });

      expect(providerSendMock).toHaveBeenCalledTimes(2);

      expect(providerSendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          production: true,
          tokens: [productionVoipToken],
        })
      );

      expect(providerSendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          production: false,
          tokens: [sandboxVoipToken],
        })
      );

      expect(result).toMatchObject({
        ok: true,
        apnsVoipSent: 2,
        apnsVoipFailed: 0,
      });
    }
  );

  it(
    'does not send AUDIO VoIP pushes to stale non-Voice-registered iOS devices',
    async () => {
      const staleProductionToken =
        'stale-production-voip-token';

      /*
       * This represents the historical account-level token set:
       * it contains a stale production iPhone token in addition
       * to the current sandbox Voice-registered iPhone.
       *
       * AUDIO routing must ignore this generic token list and use
       * getVoiceEligibleDevices() instead.
       */
      mockPrisma.device.findMany.mockResolvedValue([
        {
          pushToken: null,
          pushProvider: null,
          apnsPushToken: null,
          apnsSandboxPushToken: null,
          fcmPushToken: null,
          voipPushToken:
            staleProductionToken,
          voipSandboxPushToken: null,
        },
      ]);

      getVoiceEligibleDevicesMock.mockResolvedValue([
        {
          deviceId: 'current-ios-device',
          platform: 'iOS 26.6',
          voiceIdentity:
            'user_7_device_current_ios_device',
          voiceRegisteredAt: new Date(),
          voiceRegistrationVer: 1,
          voicePushEnvironment: 'sandbox',
          voipPushToken: null,
          voipSandboxPushToken:
            sandboxVoipToken,
        },
      ]);

      const result =
        await sendVoipCallPushToUser(7, {
          callId: 704,
          callerId: 1,
          callerName: 'Caller',
          mode: 'AUDIO',
        });

      expect(
        getVoiceEligibleDevicesMock
      ).toHaveBeenCalledWith(7);

      expect(providerSendMock)
        .toHaveBeenCalledTimes(1);

      expect(providerSendMock)
        .toHaveBeenCalledWith(
          expect.objectContaining({
            production: false,
            tokens: [sandboxVoipToken],
          })
        );

      expect(providerSendMock)
        .not.toHaveBeenCalledWith(
          expect.objectContaining({
            tokens:
              expect.arrayContaining([
                staleProductionToken,
              ]),
          })
        );

      expect(result).toMatchObject({
        ok: true,
        apnsVoipSent: 1,
        apnsVoipFailed: 0,
      });
    }
  );

  it(
    'clears only production fields when a production alert token is invalid',
    async () => {
      providerSendMock.mockImplementation(
        async ({ production, tokens }) => {
          if (production) {
            return {
              sent: [],
              failed: [
                {
                  device: tokens[0],
                  status: '400',
                  response: {
                    reason: 'BadDeviceToken',
                  },
                },
              ],
            };
          }

          return successfulResult(tokens);
        }
      );

      const result = await sendPushToUser(7, {
        alert: {
          title: 'New message',
          body: 'Hello',
        },
        data: {
          type: 'sms_message',
        },
      });

      expect(mockPrisma.device.updateMany)
        .toHaveBeenCalledWith({
          where: {
            apnsPushToken: productionAlertToken,
          },
          data: {
            apnsPushToken: null,
          },
        });

      expect(mockPrisma.device.updateMany)
        .toHaveBeenCalledWith({
          where: {
            pushProvider: 'apns',
            pushToken: productionAlertToken,
          },
          data: {
            pushToken: null,
          },
        });

      expect(mockPrisma.device.updateMany)
        .not.toHaveBeenCalledWith({
          where: {
            apnsSandboxPushToken:
              productionAlertToken,
          },
          data: {
            apnsSandboxPushToken: null,
          },
        });

      expect(result).toMatchObject({
        ok: true,
        apnsSent: 1,
        apnsFailed: 1,
      });
    }
  );

  it(
    'clears only the sandbox field when a sandbox alert token is invalid',
    async () => {
      providerSendMock.mockImplementation(
        async ({ production, tokens }) => {
          if (!production) {
            return {
              sent: [],
              failed: [
                {
                  device: tokens[0],
                  status: '400',
                  response: {
                    reason: 'BadDeviceToken',
                  },
                },
              ],
            };
          }

          return successfulResult(tokens);
        }
      );

      const result = await sendPushToUser(7, {
        alert: {
          title: 'New message',
          body: 'Hello',
        },
        data: {
          type: 'sms_message',
        },
      });

      expect(mockPrisma.device.updateMany)
        .toHaveBeenCalledTimes(1);

      expect(mockPrisma.device.updateMany)
        .toHaveBeenCalledWith({
          where: {
            apnsSandboxPushToken:
              sandboxAlertToken,
          },
          data: {
            apnsSandboxPushToken: null,
          },
        });

      expect(result).toMatchObject({
        ok: true,
        apnsSent: 1,
        apnsFailed: 1,
      });
    }
  );

  it(
    'clears only the matching sandbox VoIP field',
    async () => {
      providerSendMock.mockImplementation(
        async ({ production, tokens }) => {
          if (!production) {
            return {
              sent: [],
              failed: [
                {
                  device: tokens[0],
                  status: '400',
                  response: {
                    reason: 'BadDeviceToken',
                  },
                },
              ],
            };
          }

          return successfulResult(tokens);
        }
      );

      const result =
        await sendVoipCallPushToUser(7, {
          callId: 92,
          callerId: 4,
          callerName: 'Julian',
          mode: 'VIDEO',
        });

      expect(mockPrisma.device.updateMany)
        .toHaveBeenCalledTimes(1);

      expect(mockPrisma.device.updateMany)
        .toHaveBeenCalledWith({
          where: {
            voipSandboxPushToken:
              sandboxVoipToken,
          },
          data: {
            voipSandboxPushToken: null,
          },
        });

      expect(result).toMatchObject({
        ok: true,
        apnsVoipSent: 1,
        apnsVoipFailed: 1,
      });
    }
  );

  test('strict mode excludes every unbound legacy alert and VoIP token', async () => {
    process.env.PUSH_AUTHORITY_MODE = 'strict';
    authorizedPushRegistrationsMock.mockResolvedValue([]);
    await sendPushToUser(7, { alert: { title: 'Test', body: 'Test' }, data: { type: 'sms_message' } });
    await sendVoipCallPushToUser(7, { callId: 12, mode: 'VIDEO' });
    expect(providerSendMock).not.toHaveBeenCalled();
  });

  test('strict mode sends only a currently authorized provider/environment token', async () => {
    process.env.PUSH_AUTHORITY_MODE = 'strict';
    authorizedPushRegistrationsMock.mockResolvedValue([{
      provider: 'apns', environment: 'production', token: productionAlertToken,
      installation: { currentDevice: { deviceId: 'authorized-ios', voicePushEnvironment: 'production' } },
    }]);
    await sendPushToUser(7, { alert: { title: 'Test', body: 'Test' }, data: { type: 'sms_message' } });
    expect(providerSendMock).toHaveBeenCalledTimes(1);
    expect(providerSendMock.mock.calls[0][0].tokens).toEqual([productionAlertToken]);
  });

  test('strict mode rechecks and withholds a token revoked before provider I/O', async () => {
    process.env.PUSH_AUTHORITY_MODE = 'strict';
    authorizedPushRegistrationsMock
      .mockResolvedValueOnce([{
        provider: 'apns', environment: 'production', token: productionAlertToken,
        installation: { currentDevice: { deviceId: 'authorized-ios', voicePushEnvironment: 'production' } },
      }])
      .mockResolvedValueOnce([]);
    await sendPushToUser(7, { alert: { title: 'Test', body: 'Test' }, data: { type: 'sms_message' } });
    expect(providerSendMock).not.toHaveBeenCalled();
  });
});
