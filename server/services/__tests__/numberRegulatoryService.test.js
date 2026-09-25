/**
 * @jest-environment node
 */

import { jest } from '@jest/globals';

const findUniqueMock = jest.fn();
const upsertMock = jest.fn();
const updateMock = jest.fn();

const getRegulatoryBundleMock = jest.fn();
const normalizeStatusMock = jest.fn();

const mockPrisma = {
  numberRegulatoryProfile: {
    findUnique: findUniqueMock,
    upsert: upsertMock,
    update: updateMock,
  },
};

const mockProvider = {
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
});
