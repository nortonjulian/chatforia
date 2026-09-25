/**
 * @jest-environment node
 */

import { jest } from '@jest/globals';

process.env.TWILIO_ACCOUNT_SID = 'AC_test';
process.env.TWILIO_AUTH_TOKEN = 'auth_test';

const endUserCreateMock = jest.fn();
const bundleCreateMock = jest.fn();
const itemAssignmentCreateMock = jest.fn();
const bundleFetchMock = jest.fn();
const bundleUpdateMock = jest.fn();

const bundleContextMock = jest.fn(() => ({
  itemAssignments: {
    create: itemAssignmentCreateMock,
  },
  fetch: bundleFetchMock,
  update: bundleUpdateMock,
}));

await jest.unstable_mockModule('twilio', () => {
  const factory = () => ({
    numbers: {
      v2: {
        regulatoryCompliance: {
          endUsers: {
            create: endUserCreateMock,
          },
          bundles: Object.assign(
            bundleContextMock,
            {
              create: bundleCreateMock,
            }
          ),
        },
      },
    },
  });

  return {
    __esModule: true,
    default: factory,
  };
});

const { default: twilio } =
  await import('../lib/telco/twilio.js');

const RN =
  'RN11111111111111111111111111111111';

const BU =
  'BU22222222222222222222222222222222';

const IT =
  'IT33333333333333333333333333333333';

const EN =
  'IT44444444444444444444444444444444';

describe('Twilio regulatory lifecycle primitives', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    process.env.TWILIO_ACCOUNT_SID = 'AC_test';
    process.env.TWILIO_AUTH_TOKEN = 'auth_test';
  });

  test('creates a normalized regulatory End User', async () => {
    endUserCreateMock.mockResolvedValue({
      sid: EN,
      friendlyName: 'Chatforia User 42',
      type: 'individual',
      attributes: {
        first_name: 'Test',
        last_name: 'User',
      },
    });

    const result =
      await twilio.createRegulatoryEndUser({
        friendlyName: ' Chatforia User 42 ',
        endUserType: ' INDIVIDUAL ',
        attributes: {
          first_name: 'Test',
          last_name: 'User',
        },
      });

    expect(endUserCreateMock).toHaveBeenCalledWith({
      friendlyName: 'Chatforia User 42',
      type: 'individual',
      attributes: {
        first_name: 'Test',
        last_name: 'User',
      },
    });

    expect(result.sid).toBe(EN);
    expect(result.type).toBe('individual');
  });

  test('creates a normalized regulatory Bundle', async () => {
    bundleCreateMock.mockResolvedValue({
      sid: BU,
      regulationSid: RN,
      friendlyName: 'Chatforia AU Local 42',
      status: 'draft',
      validUntil: null,
      email: 'test@example.com',
      statusCallback:
        'https://example.com/regulatory-status',
    });

    const result =
      await twilio.createRegulatoryBundle({
        friendlyName: ' Chatforia AU Local 42 ',
        email: ' test@example.com ',
        regulationSid: RN,
        country: ' au ',
        numberType: ' LOCAL ',
        endUserType: ' INDIVIDUAL ',
        statusCallback:
          'https://example.com/regulatory-status',
      });

    expect(bundleCreateMock).toHaveBeenCalledWith({
      friendlyName: 'Chatforia AU Local 42',
      email: 'test@example.com',
      regulationSid: RN,
      isoCountry: 'AU',
      numberType: 'local',
      endUserType: 'individual',
      isTest: false,
      statusCallback:
        'https://example.com/regulatory-status',
    });

    expect(result).toEqual({
      sid: BU,
      regulationSid: RN,
      friendlyName: 'Chatforia AU Local 42',
      status: 'draft',
      validUntil: null,
      email: 'test@example.com',
      statusCallback:
        'https://example.com/regulatory-status',
    });
  });

  test('assigns an object to a regulatory Bundle', async () => {
    itemAssignmentCreateMock.mockResolvedValue({
      sid: IT,
      bundleSid: BU,
      objectSid: EN,
    });

    const result =
      await twilio.assignRegulatoryItem({
        bundleSid: BU,
        objectSid: EN,
      });

    expect(bundleContextMock).toHaveBeenCalledWith(BU);

    expect(
      itemAssignmentCreateMock
    ).toHaveBeenCalledWith({
      objectSid: EN,
    });

    expect(result).toEqual({
      sid: IT,
      bundleSid: BU,
      objectSid: EN,
    });
  });

  test('fetches a regulatory Bundle', async () => {
    const validUntil =
      new Date('2027-09-25T00:00:00.000Z');

    bundleFetchMock.mockResolvedValue({
      sid: BU,
      regulationSid: RN,
      friendlyName: 'Chatforia AU Local 42',
      status: 'twilio-approved',
      validUntil,
      email: 'test@example.com',
      statusCallback:
        'https://example.com/regulatory-status',
    });

    const result =
      await twilio.getRegulatoryBundle({
        bundleSid: BU,
      });

    expect(bundleContextMock).toHaveBeenCalledWith(BU);
    expect(bundleFetchMock).toHaveBeenCalledTimes(1);

    expect(result.status).toBe('twilio-approved');
    expect(result.validUntil).toBe(validUntil);
  });

  test('normalizes Twilio Bundle statuses', () => {
    expect(
      twilio.normalizeRegulatoryBundleStatus('draft')
    ).toBe('DRAFT');

    expect(
      twilio.normalizeRegulatoryBundleStatus(
        'pending-review'
      )
    ).toBe('PENDING_REVIEW');

    expect(
      twilio.normalizeRegulatoryBundleStatus(
        'in-review'
      )
    ).toBe('IN_REVIEW');

    expect(
      twilio.normalizeRegulatoryBundleStatus(
        'twilio-approved'
      )
    ).toBe('APPROVED');

    expect(
      twilio.normalizeRegulatoryBundleStatus(
        'twilio-rejected'
      )
    ).toBe('REJECTED');

    expect(
      twilio.normalizeRegulatoryBundleStatus(
        'provisionally-approved'
      )
    ).toBe('PROVISIONALLY_APPROVED');

    expect(
      twilio.normalizeRegulatoryBundleStatus(
        'future-provider-status'
      )
    ).toBeNull();
  });

  test('submits a regulatory Bundle for review', async () => {
    bundleUpdateMock.mockResolvedValue({
      sid: BU,
      regulationSid: RN,
      friendlyName: 'Chatforia AU Local 42',
      status: 'pending-review',
      validUntil: null,
      email: 'test@example.com',
      statusCallback:
        'https://example.com/regulatory-status',
    });

    const result =
      await twilio.submitRegulatoryBundle({
        bundleSid: BU,
      });

    expect(bundleContextMock).toHaveBeenCalledWith(BU);

    expect(bundleUpdateMock).toHaveBeenCalledWith({
      status: 'pending-review',
    });

    expect(result.status).toBe('pending-review');

    expect(result.normalizedStatus).toBe(
      'PENDING_REVIEW'
    );
  });

  test('rejects invalid lifecycle inputs before Twilio calls', async () => {
    await expect(
      twilio.createRegulatoryEndUser({
        friendlyName: 'Test',
        endUserType: 'government',
      })
    ).rejects.toThrow(
      'endUserType must be individual or business'
    );

    await expect(
      twilio.createRegulatoryBundle({
        friendlyName: 'Test',
        email: 'test@example.com',
        regulationSid: 'bad',
        country: 'AU',
        numberType: 'local',
        endUserType: 'individual',
      })
    ).rejects.toThrow(
      'regulationSid must be a valid Twilio Regulation SID'
    );

    await expect(
      twilio.assignRegulatoryItem({
        bundleSid: 'bad',
        objectSid: EN,
      })
    ).rejects.toThrow(
      'bundleSid must be a valid Twilio Bundle SID'
    );

    expect(endUserCreateMock).not.toHaveBeenCalled();
    expect(bundleCreateMock).not.toHaveBeenCalled();
    expect(itemAssignmentCreateMock).not.toHaveBeenCalled();
  });
});
