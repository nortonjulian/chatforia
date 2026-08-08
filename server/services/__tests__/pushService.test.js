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
};

const getFirebaseMessagingMock = jest.fn();
const resolveMessageNotificationSoundMock =
  jest.fn(() => 'Chatforia_Default.caf');

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

const {
  sendPushToUser,
  sendVoipCallPushToUser,
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
});
