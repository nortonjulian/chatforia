import { jest } from '@jest/globals';

const prismaDeviceFindMany = jest.fn();

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

const {
  getVoiceEligibleDevices,
  getVoiceDialDestinations,
  isVoiceEligibleDevice,
} = await import(
  '../services/voiceDeviceService.js'
);

describe('voiceDeviceService', () => {
  beforeEach(() => {
    prismaDeviceFindMany.mockReset();
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
    ]);
  });

  test('uses temporary legacy fallback when no confirmed device exists', async () => {
    prismaDeviceFindMany.mockResolvedValue([]);

    const destinations =
      await getVoiceDialDestinations(42);

    expect(destinations).toEqual([
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

    expect(destinations).toEqual([]);
  });

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
});
