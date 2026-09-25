/**
 * @jest-environment node
 */

import { jest } from '@jest/globals';

process.env.TWILIO_ACCOUNT_SID = 'AC_test';
process.env.TWILIO_AUTH_TOKEN = 'auth_test';

const regulationsListMock = jest.fn();

await jest.unstable_mockModule('twilio', () => {
  const factory = () => ({
    numbers: {
      v2: {
        regulatoryCompliance: {
          regulations: {
            list: regulationsListMock,
          },
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

describe('Twilio regulatory compliance', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    process.env.TWILIO_ACCOUNT_SID = 'AC_test';
    process.env.TWILIO_AUTH_TOKEN = 'auth_test';
  });

  test('retrieves and preserves regulatory requirements', async () => {
    const requirements = {
      end_user: [
        {
          requirement_name: 'individual_info',
          type: 'individual',
          fields: [
            'first_name',
            'last_name',
            'document_number',
            'email',
            'purpose_for_number',
            'website_url',
          ],
        },
      ],
      supporting_document: [
        [
          {
            requirement_name: 'proof_of_identity_info',
            type: 'document',
            accepted_documents: [
              {
                name: 'Australian Government-issued ID',
                type: 'government_issued_document',
              },
              {
                name: 'Australian Passport',
                type: 'passport',
              },
            ],
          },
          {
            requirement_name: 'individual_address_info',
            type: 'document',
            accepted_documents: [
              {
                name: 'Utility bill',
                type: 'utility_bill',
              },
            ],
          },
        ],
      ],
    };

    regulationsListMock.mockResolvedValue([
      {
        sid: 'RN688ade57698671ba9c4f198cd9320852',
        friendlyName: 'Australia: Local - Individual',
        isoCountry: 'AU',
        numberType: 'local',
        endUserType: 'individual',
        requirements,
      },
    ]);

    const result = await twilio.getRegulations({
      country: 'au',
      numberType: 'local',
      endUserType: 'individual',
    });

    expect(regulationsListMock).toHaveBeenCalledTimes(1);

    expect(regulationsListMock).toHaveBeenCalledWith({
      isoCountry: 'AU',
      numberType: 'local',
      endUserType: 'individual',
      includeConstraints: true,
      limit: 20,
    });

    expect(result).toEqual([
      {
        sid: 'RN688ade57698671ba9c4f198cd9320852',
        friendlyName: 'Australia: Local - Individual',
        isoCountry: 'AU',
        numberType: 'local',
        endUserType: 'individual',
        requirements,
      },
    ]);

    expect(
      result[0].requirements.supporting_document[0][0]
        .accepted_documents
    ).toHaveLength(2);
  });

  test('normalizes lookup parameters', async () => {
    regulationsListMock.mockResolvedValue([]);

    await twilio.getRegulations({
      country: ' gb ',
      numberType: ' MOBILE ',
      endUserType: ' BUSINESS ',
      includeConstraints: false,
    });

    expect(regulationsListMock).toHaveBeenCalledWith({
      isoCountry: 'GB',
      numberType: 'mobile',
      endUserType: 'business',
      includeConstraints: false,
      limit: 20,
    });
  });

  test('rejects invalid country codes before calling Twilio', async () => {
    await expect(
      twilio.getRegulations({
        country: 'USA',
      })
    ).rejects.toThrow(
      'country must be a 2-letter ISO country code'
    );

    expect(regulationsListMock).not.toHaveBeenCalled();
  });

  test('rejects unsupported regulatory number types', async () => {
    await expect(
      twilio.getRegulations({
        country: 'US',
        numberType: 'satellite',
      })
    ).rejects.toThrow(
      'Unsupported regulatory number type: satellite'
    );

    expect(regulationsListMock).not.toHaveBeenCalled();
  });

  test('rejects unsupported end-user types', async () => {
    await expect(
      twilio.getRegulations({
        country: 'US',
        endUserType: 'government',
      })
    ).rejects.toThrow(
      'endUserType must be individual or business'
    );

    expect(regulationsListMock).not.toHaveBeenCalled();
  });
});
