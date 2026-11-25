import { jest } from '@jest/globals';

const prismaDeviceFindMany = jest.fn();
const authorizedPushRegistrationsMock = jest.fn();

await jest.unstable_mockModule(
  '../utils/prismaClient.js',
  () => ({
    __esModule: true,
    default: {
      device: {
        findMany: prismaDeviceFindMany,
      },
    },
  })
);

await jest.unstable_mockModule('../services/pushAuthorityService.js', () => ({
  authorizedPushRegistrations: authorizedPushRegistrationsMock,
  pushAuthorityMode: () => process.env.PUSH_AUTHORITY_MODE === 'strict' ? 'strict' : 'shadow',
}));

const {
  getVoiceEligibleDevices,
  getVoiceDialDestinations,
  isVoiceEligibleDevice,
} = await import(
  '../services/voiceDeviceService.js'
);

const {
  parseVoiceIdentityUserId,
} = await import(
  '../utils/voiceIdentity.js'
);

describe('voiceDeviceService', () => {
  beforeEach(() => {
    prismaDeviceFindMany.mockReset();
    authorizedPushRegistrationsMock.mockReset();
    process.env.PUSH_AUTHORITY_MODE = 'shadow';
  });

  function registeredAndroid(overrides = {}) {
    return {
      deviceId: 'android-device-123',
      platform: 'android',
      pairingStatus: 'approved',
      revokedAt: null,
      isPrimary: false,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
      voiceIdentity:
        'user_42_device_android_device_123',
      voiceRegisteredAt: new Date(),
      voiceRegistrationVer: 1,
      voicePushEnvironment: null,
      ...overrides,
    };
  }

  function registeredIOS(overrides = {}) {
    return {
      deviceId: 'ios-device-456',
      platform: 'ios',
      pairingStatus: 'approved',
      revokedAt: null,
      isPrimary: false,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
      voiceIdentity:
        'user_42_device_ios_device_456',
      voiceRegisteredAt: new Date(),
      voiceRegistrationVer: 1,
      voicePushEnvironment: 'production',
      ...overrides,
    };
  }

  test('accepts a valid confirmed Android Voice registration', () => {
    expect(
      isVoiceEligibleDevice(
        registeredAndroid(),
        42
      )
    ).toBe(true);
  });

  test('accepts a valid confirmed iOS Voice registration', () => {
    expect(
      isVoiceEligibleDevice(
        registeredIOS(),
        42
      )
    ).toBe(true);
  });

  test('accepts versioned iOS platform strings', () => {
    expect(
      isVoiceEligibleDevice(
        registeredIOS({
          platform: 'iOS 26.6',
        }),
        42
      )
    ).toBe(true);

    expect(
      isVoiceEligibleDevice(
        registeredIOS({
          platform: 'iOS 26.5.2',
        }),
        42
      )
    ).toBe(true);
  });

  test('rejects a revoked device', () => {
    expect(
      isVoiceEligibleDevice(
        registeredAndroid({
          revokedAt: new Date(),
        }),
        42
      )
    ).toBe(false);
  });

  test('rejects a rejected device', () => {
    expect(
      isVoiceEligibleDevice(
        registeredAndroid({
          pairingStatus: 'rejected',
        }),
        42
      )
    ).toBe(false);
  });

  test('rejects device without confirmed registration timestamp', () => {
    expect(
      isVoiceEligibleDevice(
        registeredAndroid({
          voiceRegisteredAt: null,
        }),
        42
      )
    ).toBe(false);
  });

  test('rejects stale registration version', () => {
    expect(
      isVoiceEligibleDevice(
        registeredAndroid({
          voiceRegistrationVer: 0,
        }),
        42
      )
    ).toBe(false);
  });

  test('rejects stored identity that does not match derived identity', () => {
    expect(
      isVoiceEligibleDevice(
        registeredAndroid({
          voiceIdentity:
            'user_999_device_android_device_123',
        }),
        42
      )
    ).toBe(false);
  });

  test('rejects iOS registration without valid push environment', () => {
    expect(
      isVoiceEligibleDevice(
        registeredIOS({
          voicePushEnvironment: null,
        }),
        42
      )
    ).toBe(false);
  });

  test('returns multiple independently registered mobile devices', async () => {
    prismaDeviceFindMany.mockResolvedValue([
      registeredAndroid(),
      registeredIOS(),
    ]);

    const devices =
      await getVoiceEligibleDevices(42);

    expect(devices).toHaveLength(2);
    expect(devices.map((d) => d.deviceId)).toEqual([
      'android-device-123',
      'ios-device-456',
    ]);
  });

  test('returns device-specific dial destinations for registered devices', async () => {
    prismaDeviceFindMany.mockResolvedValue([
      registeredAndroid(),
      registeredIOS(),
    ]);

    const destinations =
      await getVoiceDialDestinations(42);

    expect(destinations).toEqual([
      {
        identity:
          'user_42_device_android_device_123',
        deviceId: 'android-device-123',
        platform: 'android',
        legacy: false,
      },
      {
        identity:
          'user_42_device_ios_device_456',
        deviceId: 'ios-device-456',
        platform: 'ios',
        legacy: false,
      },
      {
        identity: 'user:42',
        deviceId: null,
        platform: 'web',
        legacy: false,
      },
    ]);
  });

  test('uses temporary legacy fallback when no confirmed device exists', async () => {
    prismaDeviceFindMany.mockResolvedValue([]);

    const destinations =
      await getVoiceDialDestinations(42);

    expect(destinations).toEqual([
      {
        identity: 'user:42',
        deviceId: null,
        platform: 'web',
        legacy: false,
      },
      {
        identity: 'user_42',
        deviceId: null,
        platform: null,
        legacy: true,
      },
    ]);
  });

  test('can disable legacy fallback for final production migration state', async () => {
    prismaDeviceFindMany.mockResolvedValue([]);

    const destinations =
      await getVoiceDialDestinations(
        42,
        {
          allowLegacyFallback: false,
        }
      );

    expect(destinations).toEqual([
      {
        identity: 'user:42',
        deviceId: null,
        platform: 'web',
        legacy: false,
      },
    ]);
  });

  test(
    'parses the browser Voice identity',
    () => {
      expect(
        parseVoiceIdentityUserId(
          'client:user:42'
        )
      ).toBe(42);
    }
  );

  test('never returns more than 10 eligible devices', async () => {
    prismaDeviceFindMany.mockResolvedValue(
      Array.from({ length: 15 }, (_, index) =>
        registeredAndroid({
          deviceId: `device-${index}`,
          voiceIdentity:
            `user_42_device_device_${index}`,
        })
      )
    );

    const devices =
      await getVoiceEligibleDevices(42);

    expect(devices).toHaveLength(10);
  });

  test('strict mode excludes unbound mobile Voice registrations and legacy destination', async () => {
    process.env.PUSH_AUTHORITY_MODE = 'strict';
    prismaDeviceFindMany.mockResolvedValue([registeredIOS({
      voicePushEnvironment: 'production', voipPushToken: 'old-voip-token',
    })]);
    authorizedPushRegistrationsMock.mockResolvedValue([]);
    expect(await getVoiceEligibleDevices(42)).toEqual([]);
    const destinations = await getVoiceDialDestinations(42);
    expect(destinations.some((item) => item.legacy || item.platform === 'ios')).toBe(false);
  });

  test('strict mode requires the matching VoIP environment and token for iOS', async () => {
    process.env.PUSH_AUTHORITY_MODE = 'strict';
    const device = registeredIOS({ voicePushEnvironment: 'production',
      voipPushToken: 'current-voip-token', voipSandboxPushToken: 'sandbox-voip-token' });
    prismaDeviceFindMany.mockResolvedValue([device]);
    authorizedPushRegistrationsMock.mockResolvedValue([{ provider: 'apns_voip',
      environment: 'sandbox', token: 'sandbox-voip-token',
      installation: { currentDevice: { deviceId: device.deviceId } } }]);
    expect(await getVoiceEligibleDevices(42)).toEqual([]);
    authorizedPushRegistrationsMock.mockResolvedValue([{ provider: 'apns_voip',
      environment: 'production', token: 'current-voip-token',
      installation: { currentDevice: { deviceId: device.deviceId } } }]);
    expect((await getVoiceEligibleDevices(42)).map((item) => item.deviceId)).toEqual([device.deviceId]);
  });

  test('strict mode admits Android Voice only through its current FCM registration', async () => {
    process.env.PUSH_AUTHORITY_MODE = 'strict';
    const device = registeredAndroid({ fcmPushToken: 'current-fcm-token' });
    prismaDeviceFindMany.mockResolvedValue([device]);
    authorizedPushRegistrationsMock.mockResolvedValue([{ provider: 'fcm',
      environment: 'none', token: 'stale-fcm-token',
      installation: { currentDevice: { deviceId: device.deviceId } } }]);
    expect(await getVoiceEligibleDevices(42)).toEqual([]);
    authorizedPushRegistrationsMock.mockResolvedValue([{ provider: 'fcm',
      environment: 'none', token: 'current-fcm-token',
      installation: { currentDevice: { deviceId: device.deviceId } } }]);
    expect((await getVoiceEligibleDevices(42)).map((item) => item.deviceId)).toEqual([device.deviceId]);
    expect(prismaDeviceFindMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ fcmPushToken: true }),
    }));
  });
});
