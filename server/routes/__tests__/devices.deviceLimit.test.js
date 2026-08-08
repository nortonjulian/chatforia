import {
  getDeviceLimitForPlan,
  getPushTokenOwnership,
  shouldRequireDeviceReplacement,
} from '../devices.js';

describe('device registration limits', () => {
  test('Free accounts allow one active device', () => {
    expect(getDeviceLimitForPlan('FREE')).toBe(1);

    expect(
      shouldRequireDeviceReplacement({
        isCurrentDeviceActive: false,
        activeOtherDeviceCount: 1,
        deviceLimit: getDeviceLimitForPlan('FREE'),
        replaceExistingDevice: false,
      })
    ).toBe(true);
  });

  test.each([
    'PLUS',
    'PREMIUM',
    'WIRELESS',
  ])('%s accounts allow five active devices', (plan) => {
    expect(getDeviceLimitForPlan(plan)).toBe(5);

    expect(
      shouldRequireDeviceReplacement({
        isCurrentDeviceActive: false,
        activeOtherDeviceCount: 4,
        deviceLimit: getDeviceLimitForPlan(plan),
        replaceExistingDevice: false,
      })
    ).toBe(false);

    expect(
      shouldRequireDeviceReplacement({
        isCurrentDeviceActive: false,
        activeOtherDeviceCount: 5,
        deviceLimit: getDeviceLimitForPlan(plan),
        replaceExistingDevice: false,
      })
    ).toBe(true);
  });

  test('an active current device can refresh above the limit', () => {
    expect(
      shouldRequireDeviceReplacement({
        isCurrentDeviceActive: true,
        activeOtherDeviceCount: 198,
        deviceLimit: 5,
        replaceExistingDevice: false,
      })
    ).toBe(false);
  });

  test('an explicit valid replacement bypasses the prompt', () => {
    expect(
      shouldRequireDeviceReplacement({
        isCurrentDeviceActive: false,
        activeOtherDeviceCount: 5,
        deviceLimit: 5,
        replaceExistingDevice: true,
      })
    ).toBe(false);
  });

  test('unknown plans receive the Free limit', () => {
    expect(getDeviceLimitForPlan(null)).toBe(1);
    expect(getDeviceLimitForPlan('unexpected')).toBe(1);
  });
});


describe('push token ownership fields', () => {
  test.each([
    [
      'apns',
      'production',
      'apnsPushToken',
    ],
    [
      'apns',
      'sandbox',
      'apnsSandboxPushToken',
    ],
    [
      'apns_voip',
      'production',
      'voipPushToken',
    ],
    [
      'apns_voip',
      'sandbox',
      'voipSandboxPushToken',
    ],
    [
      'fcm',
      'production',
      'fcmPushToken',
    ],
    [
      'custom',
      'production',
      'pushToken',
    ],
  ])(
    '%s/%s owns the %s field',
    (
      provider,
      environment,
      expectedField
    ) => {
      expect(
        getPushTokenOwnership(
          provider,
          environment
        )
      ).toEqual({
        tokenField: expectedField,
      });
    }
  );
});
