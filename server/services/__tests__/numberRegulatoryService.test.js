/**
 * @jest-environment node
 */

import { jest } from '@jest/globals';

const findUniqueMock = jest.fn();
const createMock = jest.fn();
const upsertMock = jest.fn();
const updateMock = jest.fn();

const getRegulatoryBundleMock = jest.fn();
const getRegulationsMock = jest.fn();
const normalizeStatusMock = jest.fn();

const mockPrisma = {
  numberRegulatoryProfile: {
    findUnique: findUniqueMock,
    create: createMock,
    upsert: upsertMock,
    update: updateMock,
  },
};

const mockProvider = {
  getRegulations:
    getRegulationsMock,
  getRegulatoryBundle:
    getRegulatoryBundleMock,
  normalizeRegulatoryBundleStatus:
    normalizeStatusMock,
};

const getProviderMock = jest.fn(
  () => mockProvider
);

await jest.unstable_mockModule(
  '../utils/prismaClient.js',
  () => ({
    __esModule: true,
    default: mockPrisma,
    prisma: mockPrisma,
  })
);

await jest.unstable_mockModule(
  '../lib/telco/index.js',
  () => ({
    __esModule: true,
    getProvider: getProviderMock,
  })
);

const {
  getRegulatoryProfile,
  upsertRegulatoryProfile,
  syncRegulatoryBundleStatus,
  evaluateNumberRegulatoryCompliance,
  initializeNumberRegulatoryVerification,
  getRequiredRegulatoryEndUserFields,
  validateRegulatoryEndUserAttributes,
  getRegulatorySupportingDocumentRequirements,
} = await import(
  '../numberRegulatoryService.js'
);

const BU =
  'BU22222222222222222222222222222222';

function baseProfile(overrides = {}) {
  return {
    id: 7,
    userId: 42,
    provider: 'twilio',
    isoCountry: 'AU',
    numberType: 'local',
    endUserType: 'individual',
    regulationSid:
      'RN11111111111111111111111111111111',
    bundleSid: BU,
    endUserSid:
      'IT44444444444444444444444444444444',
    status: 'DRAFT',
    providerStatus: 'draft',
    rejectionReason: null,
    submittedAt: null,
    approvedAt: null,
    validUntil: null,
    ...overrides,
  };
}

const input = {
  userId: 42,
  country: 'au',
  numberType: 'LOCAL',
  endUserType: 'INDIVIDUAL',
};

describe('numberRegulatoryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('gets a profile using the compound unique key', async () => {
    const profile = baseProfile();

    findUniqueMock.mockResolvedValue(profile);

    const result =
      await getRegulatoryProfile(input);

    expect(findUniqueMock).toHaveBeenCalledWith({
      where: {
        userId_provider_isoCountry_numberType_endUserType: {
          userId: 42,
          provider: 'twilio',
          isoCountry: 'AU',
          numberType: 'local',
          endUserType: 'individual',
        },
      },
    });

    expect(result).toBe(profile);
  });

  test('upserts a normalized profile without erasing omitted fields', async () => {
    const profile = baseProfile({
      status: 'PENDING_REVIEW',
    });

    upsertMock.mockResolvedValue(profile);

    await upsertRegulatoryProfile({
      ...input,
      regulationSid:
        'RN11111111111111111111111111111111',
      bundleSid: BU,
      status: 'PENDING_REVIEW',
    });

    expect(upsertMock).toHaveBeenCalledWith({
      where: {
        userId_provider_isoCountry_numberType_endUserType: {
          userId: 42,
          provider: 'twilio',
          isoCountry: 'AU',
          numberType: 'local',
          endUserType: 'individual',
        },
      },
      create: {
        userId: 42,
        provider: 'twilio',
        isoCountry: 'AU',
        numberType: 'local',
        endUserType: 'individual',
        regulationSid:
          'RN11111111111111111111111111111111',
        bundleSid: BU,
        status: 'PENDING_REVIEW',
      },
      update: {
        regulationSid:
          'RN11111111111111111111111111111111',
        bundleSid: BU,
        status: 'PENDING_REVIEW',
      },
    });
  });

  test('fails closed when no profile exists', async () => {
    findUniqueMock.mockResolvedValue(null);

    const result =
      await syncRegulatoryBundleStatus(input);

    expect(result).toEqual({
      profile: null,
      approved: false,
      knownStatus: false,
      reason: 'profile-not-found',
    });

    expect(
      getRegulatoryBundleMock
    ).not.toHaveBeenCalled();
  });

  test('fails closed when the profile has no Bundle', async () => {
    const profile = baseProfile({
      bundleSid: null,
    });

    findUniqueMock.mockResolvedValue(profile);

    const result =
      await syncRegulatoryBundleStatus(input);

    expect(result.approved).toBe(false);
    expect(result.knownStatus).toBe(true);
    expect(result.reason).toBe(
      'bundle-not-created'
    );

    expect(
      getRegulatoryBundleMock
    ).not.toHaveBeenCalled();
  });

  test('synchronizes an approved Bundle', async () => {
    const profile = baseProfile({
      status: 'IN_REVIEW',
      providerStatus: 'in-review',
    });

    const validUntil =
      new Date('2027-09-25T00:00:00.000Z');

    findUniqueMock.mockResolvedValue(profile);

    getRegulatoryBundleMock.mockResolvedValue({
      sid: BU,
      status: 'twilio-approved',
      validUntil,
    });

    normalizeStatusMock.mockReturnValue(
      'APPROVED'
    );

    const updated = {
      ...profile,
      status: 'APPROVED',
      providerStatus: 'twilio-approved',
      validUntil,
      approvedAt: new Date(),
    };

    updateMock.mockResolvedValue(updated);

    const result =
      await syncRegulatoryBundleStatus(input);

    expect(getProviderMock).toHaveBeenCalledWith(
      'twilio'
    );

    expect(
      getRegulatoryBundleMock
    ).toHaveBeenCalledWith({
      bundleSid: BU,
    });

    expect(updateMock).toHaveBeenCalledTimes(1);

    const updateCall =
      updateMock.mock.calls[0][0];

    expect(updateCall.where).toEqual({
      id: 7,
    });

    expect(updateCall.data.status).toBe(
      'APPROVED'
    );

    expect(
      updateCall.data.providerStatus
    ).toBe('twilio-approved');

    expect(updateCall.data.validUntil).toBe(
      validUntil
    );

    expect(
      updateCall.data.approvedAt
    ).toBeInstanceOf(Date);

    expect(
      updateCall.data.rejectionReason
    ).toBeNull();

    expect(result.approved).toBe(true);
    expect(result.knownStatus).toBe(true);
  });

  test('provisional approval remains non-assignable', async () => {
    const profile = baseProfile();

    findUniqueMock.mockResolvedValue(profile);

    getRegulatoryBundleMock.mockResolvedValue({
      sid: BU,
      status: 'provisionally-approved',
      validUntil: null,
    });

    normalizeStatusMock.mockReturnValue(
      'PROVISIONALLY_APPROVED'
    );

    updateMock.mockResolvedValue({
      ...profile,
      status: 'PROVISIONALLY_APPROVED',
      providerStatus:
        'provisionally-approved',
    });

    const result =
      await syncRegulatoryBundleStatus(input);

    expect(result.approved).toBe(false);
    expect(result.knownStatus).toBe(true);

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        status:
          'PROVISIONALLY_APPROVED',
        providerStatus:
          'provisionally-approved',
        validUntil: null,
      },
    });
  });

  test('unknown provider status fails closed without fabricating internal status', async () => {
    const profile = baseProfile({
      status: 'IN_REVIEW',
      providerStatus: 'in-review',
    });

    findUniqueMock.mockResolvedValue(profile);

    getRegulatoryBundleMock.mockResolvedValue({
      sid: BU,
      status: 'future-status',
      validUntil: null,
    });

    normalizeStatusMock.mockReturnValue(null);

    const updated = {
      ...profile,
      providerStatus: 'future-status',
    };

    updateMock.mockResolvedValue(updated);

    const result =
      await syncRegulatoryBundleStatus(input);

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        providerStatus: 'future-status',
        validUntil: null,
      },
    });

    expect(result.approved).toBe(false);
    expect(result.knownStatus).toBe(false);
    expect(result.reason).toBe(
      'unknown-provider-status'
    );

    expect(result.profile.status).toBe(
      'IN_REVIEW'
    );
  });

  test('records first observed pending-review as submitted', async () => {
    const profile = baseProfile();

    findUniqueMock.mockResolvedValue(profile);

    getRegulatoryBundleMock.mockResolvedValue({
      sid: BU,
      status: 'pending-review',
      validUntil: null,
    });

    normalizeStatusMock.mockReturnValue(
      'PENDING_REVIEW'
    );

    updateMock.mockImplementation(
      async ({ data }) => ({
        ...profile,
        ...data,
      })
    );

    const result =
      await syncRegulatoryBundleStatus(input);

    const updateCall =
      updateMock.mock.calls[0][0];

    expect(updateCall.data.status).toBe(
      'PENDING_REVIEW'
    );

    expect(
      updateCall.data.submittedAt
    ).toBeInstanceOf(Date);

    expect(result.approved).toBe(false);
  });

  test('rejects invalid profile keys before database access', async () => {
    await expect(
      getRegulatoryProfile({
        ...input,
        country: 'USA',
      })
    ).rejects.toThrow(
      'country must be a 2-letter ISO country code'
    );

    expect(
      findUniqueMock
    ).not.toHaveBeenCalled();
  });

  describe('regulatory compliance decision', () => {
    const candidate = {
      id: 99,
      e164: '+61255550123',
      provider: 'twilio',
      isoCountry: 'AU',
      regulatoryNumberType: 'local',
    };

    test('regulation lookup failure fails closed', async () => {
      getRegulationsMock.mockRejectedValue(
        new Error('Twilio unavailable')
      );

      const result =
        await evaluateNumberRegulatoryCompliance({
          userId: 42,
          candidate,
        });

      expect(result.allowed).toBe(false);
      expect(result.requiresVerification).toBe(false);
      expect(result.decision).toBe(
        'BLOCKED_REGULATION_LOOKUP'
      );

      expect(
        findUniqueMock
      ).not.toHaveBeenCalled();

      expect(
        getRegulatoryBundleMock
      ).not.toHaveBeenCalled();
    });

    const regulation = {
      sid: 'RN11111111111111111111111111111111',
      isoCountry: 'AU',
      numberType: 'local',
      endUserType: 'individual',
      requirements: {},
    };

    test('fails closed when inventory country is unknown', async () => {
      const result =
        await evaluateNumberRegulatoryCompliance({
          userId: 42,
          candidate: {
            ...candidate,
            isoCountry: null,
          },
        });

      expect(result.decision).toBe(
        'BLOCKED_UNKNOWN_COUNTRY'
      );
      expect(result.allowed).toBe(false);

      expect(
        getRegulationsMock
      ).not.toHaveBeenCalled();
    });

    test('fails closed when regulatory number type is unknown', async () => {
      const result =
        await evaluateNumberRegulatoryCompliance({
          userId: 42,
          candidate: {
            ...candidate,
            regulatoryNumberType: null,
          },
        });

      expect(result.decision).toBe(
        'BLOCKED_UNKNOWN_NUMBER_TYPE'
      );
      expect(result.allowed).toBe(false);

      expect(
        getRegulationsMock
      ).not.toHaveBeenCalled();
    });

    test('allows assignment when no regulation applies', async () => {
      getRegulationsMock.mockResolvedValue([]);

      const result =
        await evaluateNumberRegulatoryCompliance({
          userId: 42,
          candidate,
        });

      expect(getRegulationsMock).toHaveBeenCalledWith({
        country: 'AU',
        numberType: 'local',
        endUserType: 'individual',
        includeConstraints: true,
      });

      expect(result.allowed).toBe(true);
      expect(result.decision).toBe(
        'NO_REGULATION'
      );

      expect(
        findUniqueMock
      ).not.toHaveBeenCalled();
    });

    test('requires verification when regulation exists but profile does not', async () => {
      getRegulationsMock.mockResolvedValue([
        regulation,
      ]);

      findUniqueMock.mockResolvedValue(null);

      const result =
        await evaluateNumberRegulatoryCompliance({
          userId: 42,
          candidate,
        });

      expect(result.allowed).toBe(false);
      expect(result.requiresVerification).toBe(
        true
      );
      expect(result.decision).toBe(
        'VERIFICATION_REQUIRED'
      );
      expect(result.regulation).toBe(
        regulation
      );
    });

    test('allows only a current approved profile', async () => {
      getRegulationsMock.mockResolvedValue([
        regulation,
      ]);

      const profile = baseProfile({
        status: 'IN_REVIEW',
      });

      findUniqueMock.mockResolvedValue(profile);

      const validUntil =
        new Date('2099-01-01T00:00:00.000Z');

      getRegulatoryBundleMock.mockResolvedValue({
        sid: BU,
        status: 'twilio-approved',
        validUntil,
      });

      normalizeStatusMock.mockReturnValue(
        'APPROVED'
      );

      updateMock.mockImplementation(
        async ({ data }) => ({
          ...profile,
          ...data,
        })
      );

      const result =
        await evaluateNumberRegulatoryCompliance({
          userId: 42,
          candidate,
        });

      expect(result.allowed).toBe(true);
      expect(result.decision).toBe('APPROVED');
    });

    test('expired approval requires verification again', async () => {
      getRegulationsMock.mockResolvedValue([
        regulation,
      ]);

      const profile = baseProfile({
        status: 'APPROVED',
        approvedAt:
          new Date('2025-01-01T00:00:00.000Z'),
      });

      findUniqueMock.mockResolvedValue(profile);

      const validUntil =
        new Date('2025-02-01T00:00:00.000Z');

      getRegulatoryBundleMock.mockResolvedValue({
        sid: BU,
        status: 'twilio-approved',
        validUntil,
      });

      normalizeStatusMock.mockReturnValue(
        'APPROVED'
      );

      updateMock.mockImplementation(
        async ({ data }) => ({
          ...profile,
          ...data,
        })
      );

      const result =
        await evaluateNumberRegulatoryCompliance({
          userId: 42,
          candidate,
        });

      expect(result.allowed).toBe(false);
      expect(result.requiresVerification).toBe(
        true
      );
      expect(result.decision).toBe(
        'VERIFICATION_REQUIRED'
      );
    });

    test.each([
      [
        'pending-review',
        'PENDING_REVIEW',
        'VERIFICATION_PENDING',
      ],
      [
        'in-review',
        'IN_REVIEW',
        'VERIFICATION_PENDING',
      ],
      [
        'twilio-rejected',
        'REJECTED',
        'VERIFICATION_REJECTED',
      ],
      [
        'provisionally-approved',
        'PROVISIONALLY_APPROVED',
        'BLOCKED_PROVISIONAL_APPROVAL',
      ],
    ])(
      'maps %s to %s decision',
      async (
        providerStatus,
        normalizedStatus,
        expectedDecision
      ) => {
        getRegulationsMock.mockResolvedValue([
          regulation,
        ]);

        const profile = baseProfile();

        findUniqueMock.mockResolvedValue(profile);

        getRegulatoryBundleMock.mockResolvedValue({
          sid: BU,
          status: providerStatus,
          validUntil: null,
        });

        normalizeStatusMock.mockReturnValue(
          normalizedStatus
        );

        updateMock.mockImplementation(
          async ({ data }) => ({
            ...profile,
            ...data,
          })
        );

        const result =
          await evaluateNumberRegulatoryCompliance({
            userId: 42,
            candidate,
          });

        expect(result.allowed).toBe(false);
        expect(result.decision).toBe(
          expectedDecision
        );
      }
    );

    test('unknown provider status fails closed', async () => {
      getRegulationsMock.mockResolvedValue([
        regulation,
      ]);

      const profile = baseProfile({
        status: 'IN_REVIEW',
      });

      findUniqueMock.mockResolvedValue(profile);

      getRegulatoryBundleMock.mockResolvedValue({
        sid: BU,
        status: 'future-status',
        validUntil: null,
      });

      normalizeStatusMock.mockReturnValue(null);

      updateMock.mockImplementation(
        async ({ data }) => ({
          ...profile,
          ...data,
        })
      );

      const result =
        await evaluateNumberRegulatoryCompliance({
          userId: 42,
          candidate,
        });

      expect(result.allowed).toBe(false);
      expect(result.decision).toBe(
        'BLOCKED_UNKNOWN_STATUS'
      );
    });

    test('provider synchronization failure fails closed', async () => {
      getRegulationsMock.mockResolvedValue([
        regulation,
      ]);

      const profile = baseProfile();

      findUniqueMock.mockResolvedValue(profile);

      getRegulatoryBundleMock.mockRejectedValue(
        new Error('Twilio unavailable')
      );

      const result =
        await evaluateNumberRegulatoryCompliance({
          userId: 42,
          candidate,
        });

      expect(result.allowed).toBe(false);
      expect(result.decision).toBe(
        'BLOCKED_STATUS_SYNC'
      );
    });
  });


  describe('regulatory verification initialization', () => {
    const candidate = {
      id: 99,
      e164: '+61255550123',
      provider: 'twilio',
      isoCountry: 'AU',
      regulatoryNumberType: 'local',
    };

    const regulation = {
      sid: 'RN11111111111111111111111111111111',
      isoCountry: 'AU',
      numberType: 'local',
      endUserType: 'individual',
      requirements: {
        end_user: [
          {
            requirement_name: 'individual_info',
            type: 'individual',
            fields: [
              'first_name',
              'last_name',
            ],
          },
        ],
      },
    };

    test('creates a NOT_STARTED profile for one exact regulation', async () => {
      getRegulationsMock.mockResolvedValue([
        regulation,
      ]);

      findUniqueMock.mockResolvedValue(null);

      createMock.mockImplementation(
        async ({ data }) => ({
          id: 500,
          ...data,
        })
      );

      const result =
        await initializeNumberRegulatoryVerification({
          userId: 42,
          candidate,
        });

      expect(result.initialized).toBe(true);
      expect(result.reused).toBe(false);

      expect(createMock).toHaveBeenCalledWith({
        data: {
          userId: 42,
          provider: 'twilio',
          isoCountry: 'AU',
          numberType: 'local',
          endUserType: 'individual',
          regulationSid: regulation.sid,
          status: 'NOT_STARTED',
        },
      });

      expect(result.requirements).toEqual(
        regulation.requirements
      );
    });

    test('reuses an existing matching profile', async () => {
      getRegulationsMock.mockResolvedValue([
        regulation,
      ]);

      const profile = baseProfile({
        regulationSid: regulation.sid,
        status: 'NOT_STARTED',
      });

      findUniqueMock.mockResolvedValue(profile);

      const result =
        await initializeNumberRegulatoryVerification({
          userId: 42,
          candidate,
        });

      expect(result.initialized).toBe(true);
      expect(result.reused).toBe(true);
      expect(result.profile).toBe(profile);

      expect(createMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
    });

    test('backfills regulation SID on an existing empty profile', async () => {
      getRegulationsMock.mockResolvedValue([
        regulation,
      ]);

      const profile = baseProfile({
        regulationSid: null,
        status: 'NOT_STARTED',
      });

      findUniqueMock.mockResolvedValue(profile);

      updateMock.mockResolvedValue({
        ...profile,
        regulationSid: regulation.sid,
      });

      const result =
        await initializeNumberRegulatoryVerification({
          userId: 42,
          candidate,
        });

      expect(updateMock).toHaveBeenCalledWith({
        where: {
          id: profile.id,
        },
        data: {
          regulationSid: regulation.sid,
        },
      });

      expect(result.initialized).toBe(true);
      expect(result.reused).toBe(true);
    });

    test('fails closed when multiple regulations are returned', async () => {
      getRegulationsMock.mockResolvedValue([
        regulation,
        {
          ...regulation,
          sid: 'RN22222222222222222222222222222222',
        },
      ]);

      const result =
        await initializeNumberRegulatoryVerification({
          userId: 42,
          candidate,
        });

      expect(result.initialized).toBe(false);
      expect(result.reason).toBe(
        'ambiguous-regulation'
      );

      expect(findUniqueMock).not.toHaveBeenCalled();
      expect(createMock).not.toHaveBeenCalled();
    });

    test('fails closed if an existing profile points at a different regulation', async () => {
      getRegulationsMock.mockResolvedValue([
        regulation,
      ]);

      const profile = baseProfile({
        regulationSid:
          'RN22222222222222222222222222222222',
      });

      findUniqueMock.mockResolvedValue(profile);

      const result =
        await initializeNumberRegulatoryVerification({
          userId: 42,
          candidate,
        });

      expect(result.initialized).toBe(false);
      expect(result.reason).toBe(
        'regulation-changed'
      );

      expect(createMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
    });

    test('does not initialize when regulation is not required', async () => {
      getRegulationsMock.mockResolvedValue([]);

      const result =
        await initializeNumberRegulatoryVerification({
          userId: 42,
          candidate,
        });

      expect(result.initialized).toBe(false);
      expect(result.reason).toBe(
        'regulation-not-required'
      );

      expect(findUniqueMock).not.toHaveBeenCalled();
      expect(createMock).not.toHaveBeenCalled();
    });

    test('regulation lookup failure fails closed', async () => {
      getRegulationsMock.mockRejectedValue(
        new Error('Twilio unavailable')
      );

      const result =
        await initializeNumberRegulatoryVerification({
          userId: 42,
          candidate,
        });

      expect(result.initialized).toBe(false);
      expect(result.reason).toBe(
        'regulation-lookup-failed'
      );

      expect(findUniqueMock).not.toHaveBeenCalled();
      expect(createMock).not.toHaveBeenCalled();
    });
  });


  describe('regulatory supporting document requirements', () => {
    test('preserves requirement groups and accepted document alternatives', () => {
      const requirements = {
        supporting_document: [
          [
            {
              requirement_name:
                'proof_of_identity_info',
              type: 'document',
              accepted_documents: [
                {
                  name:
                    'Australian Government-issued ID',
                  type:
                    'government_issued_document',
                },
                {
                  name: 'Australian Passport',
                  type: 'passport',
                },
              ],
            },
            {
              requirement_name:
                'individual_address_info',
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

      expect(
        getRegulatorySupportingDocumentRequirements(
          requirements
        )
      ).toEqual([
        [
          {
            requirementName:
              'proof_of_identity_info',
            type: 'document',
            acceptedDocuments: [
              {
                name:
                  'Australian Government-issued ID',
                type:
                  'government_issued_document',
              },
              {
                name: 'Australian Passport',
                type: 'passport',
              },
            ],
          },
          {
            requirementName:
              'individual_address_info',
            type: 'document',
            acceptedDocuments: [
              {
                name: 'Utility bill',
                type: 'utility_bill',
              },
            ],
          },
        ],
      ]);
    });

    test('preserves multiple Twilio requirement groups', () => {
      const result =
        getRegulatorySupportingDocumentRequirements({
          supporting_document: [
            [
              {
                requirement_name: 'identity',
                type: 'document',
                accepted_documents: [
                  {
                    name: 'Passport',
                    type: 'passport',
                  },
                ],
              },
            ],
            [
              {
                requirement_name: 'address',
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
        });

      expect(result).toHaveLength(2);
      expect(result[0][0].requirementName).toBe(
        'identity'
      );
      expect(result[1][0].requirementName).toBe(
        'address'
      );
    });

    test('handles absent supporting document requirements safely', () => {
      expect(
        getRegulatorySupportingDocumentRequirements({})
      ).toEqual([]);

      expect(
        getRegulatorySupportingDocumentRequirements(null)
      ).toEqual([]);
    });

    test('does not mutate the source requirements', () => {
      const requirements = {
        supporting_document: [
          [
            {
              requirement_name: 'identity',
              type: 'document',
              accepted_documents: [
                {
                  name: 'Passport',
                  type: 'passport',
                },
              ],
            },
          ],
        ],
      };

      const before = JSON.stringify(requirements);

      getRegulatorySupportingDocumentRequirements(
        requirements
      );

      expect(JSON.stringify(requirements)).toBe(before);
    });
  });


  describe('regulatory End User requirements', () => {
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
            requirement_name:
              'proof_of_identity_info',
            type: 'document',
            accepted_documents: [
              {
                name:
                  'Australian Government-issued ID',
                type:
                  'government_issued_document',
              },
              {
                name: 'Australian Passport',
                type: 'passport',
              },
            ],
          },
        ],
      ],
    };

    test('extracts End User fields without flattening document requirements', () => {
      const fields =
        getRequiredRegulatoryEndUserFields(
          requirements
        );

      expect(fields).toEqual([
        'first_name',
        'last_name',
        'document_number',
        'email',
        'purpose_for_number',
        'website_url',
      ]);

      expect(fields).not.toContain(
        'proof_of_identity_info'
      );
    });

    test('deduplicates End User fields while preserving order', () => {
      const fields =
        getRequiredRegulatoryEndUserFields({
          end_user: [
            {
              fields: [
                'first_name',
                'last_name',
              ],
            },
            {
              fields: [
                'last_name',
                'email',
              ],
            },
          ],
        });

      expect(fields).toEqual([
        'first_name',
        'last_name',
        'email',
      ]);
    });

    test('reports missing required End User attributes', () => {
      const result =
        validateRegulatoryEndUserAttributes({
          requirements,
          attributes: {
            first_name: 'Julian',
            last_name: 'Norton',
            email: 'julian@example.com',
          },
        });

      expect(result.valid).toBe(false);

      expect(result.missingFields).toEqual([
        'document_number',
        'purpose_for_number',
        'website_url',
      ]);
    });

    test('accepts complete attributes and trims string values', () => {
      const result =
        validateRegulatoryEndUserAttributes({
          requirements,
          attributes: {
            first_name: ' Julian ',
            last_name: ' Norton ',
            document_number: ' ABC123 ',
            email: ' julian@example.com ',
            purpose_for_number:
              ' Business communications ',
            website_url:
              ' https://example.com ',
          },
        });

      expect(result.valid).toBe(true);
      expect(result.missingFields).toEqual([]);

      expect(result.attributes).toEqual({
        first_name: 'Julian',
        last_name: 'Norton',
        document_number: 'ABC123',
        email: 'julian@example.com',
        purpose_for_number:
          'Business communications',
        website_url:
          'https://example.com',
      });
    });

    test('does not forward unexpected client attributes', () => {
      const result =
        validateRegulatoryEndUserAttributes({
          requirements: {
            end_user: [
              {
                fields: ['first_name'],
              },
            ],
          },
          attributes: {
            first_name: 'Julian',
            admin: true,
            bundleSid: 'malicious-value',
          },
        });

      expect(result.valid).toBe(true);

      expect(result.attributes).toEqual({
        first_name: 'Julian',
      });
    });

    test('treats blank strings as missing', () => {
      const result =
        validateRegulatoryEndUserAttributes({
          requirements: {
            end_user: [
              {
                fields: [
                  'first_name',
                  'email',
                ],
              },
            ],
          },
          attributes: {
            first_name: '   ',
            email: '\t',
          },
        });

      expect(result.valid).toBe(false);

      expect(result.missingFields).toEqual([
        'first_name',
        'email',
      ]);
    });

    test('handles absent End User requirements safely', () => {
      const result =
        validateRegulatoryEndUserAttributes({
          requirements: {
            supporting_document: [],
          },
          attributes: {
            unexpected: 'value',
          },
        });

      expect(result.valid).toBe(true);
      expect(result.requiredFields).toEqual([]);
      expect(result.missingFields).toEqual([]);
      expect(result.attributes).toEqual({});
    });
  });

});
