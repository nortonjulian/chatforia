import { jest } from '@jest/globals';

const activateProfileMock = jest.fn();

const subscriberFindFirstMock = jest.fn();
const subscriberUpdateMock = jest.fn();

const prismaMock = {
  subscriber: {
    findFirst: subscriberFindFirstMock,
    update: subscriberUpdateMock,
  },
};

jest.unstable_mockModule(
  '../services/providers/esimProvider.js',
  () => ({
    activateProfile: activateProfileMock,
  })
);

jest.unstable_mockModule(
  '../utils/prismaClient.js',
  () => ({
    default: prismaMock,
  })
);

/*
 * Keep the eSIM feature enabled independently of the environment
 * used by the wider Jest suite.
 */
jest.unstable_mockModule(
  '../config/esim.js',
  () => ({
    ESIM_ENABLED: true,
    ESIM_PROVIDER: 'telna',
  })
);

const {
  activateProfile,
} = await import('../controllers/esimController.js');

function makeReq(body = {}) {
  return {
    user: {
      id: 123,
    },
    body,
  };
}

function makeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

function makeSubscriber(overrides = {}) {
  return {
    id: 77,
    userId: 123,
    purchaseId: 50,
    provider: 'telna',
    providerProfileId: '8910300000059080801',
    iccid: '8910300000059080801',
    activationCode: 'SERVER-SAVED-ACTIVATION',
    status: 'PROVISIONING',
    activatedAt: null,
    msisdn: null,
    providerMeta: {
      reserve: {
        source: 'replacement',
      },
    },
    ...overrides,
  };
}

describe('esimController activateProfile lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('marks the owned Subscriber ACTIVE only when Telna confirms ENABLED', async () => {
    const subscriber = makeSubscriber();

    subscriberFindFirstMock.mockResolvedValue(
      subscriber
    );

    activateProfileMock.mockResolvedValue({
      ok: true,
      activatedAt:
        new Date('2026-10-13T20:00:00.000Z'),
      msisdn: null,
      providerMeta: {
        state: 'ENABLED',
      },
    });

    subscriberUpdateMock.mockResolvedValue({
      ...subscriber,
      status: 'ACTIVE',
      activatedAt:
        new Date('2026-10-13T20:00:00.000Z'),
    });

    const req = makeReq({
      /*
       * These values identify the owned Subscriber, but the provider
       * call must ultimately use the identifiers saved server-side.
       */
      iccid: subscriber.iccid,
      activationCode: 'CLIENT-SUPPLIED-VALUE',
    });

    const res = makeRes();

    await activateProfile(req, res);

    expect(
      subscriberFindFirstMock
    ).toHaveBeenCalledWith({
      where: {
        userId: 123,
        OR: [
          {
            iccid:
              '8910300000059080801',
          },
          {
            activationCode:
              'CLIENT-SUPPLIED-VALUE',
          },
        ],
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    expect(
      activateProfileMock
    ).toHaveBeenCalledWith({
      iccid:
        '8910300000059080801',
      activationCode:
        'SERVER-SAVED-ACTIVATION',
      providerProfileId:
        '8910300000059080801',
      testMode: false,
    });

    expect(
      subscriberUpdateMock
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 77,
        },
        data: expect.objectContaining({
          status: 'ACTIVE',
          activatedAt:
            new Date(
              '2026-10-13T20:00:00.000Z'
            ),
        }),
      })
    );

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        status: 'ACTIVE',
      })
    );
  });

  test('keeps the owned Subscriber PROVISIONING when Telna has not enabled it', async () => {
    const subscriber = makeSubscriber();

    subscriberFindFirstMock.mockResolvedValue(
      subscriber
    );

    activateProfileMock.mockResolvedValue({
      ok: false,
      activatedAt: undefined,
      msisdn: null,
      providerMeta: {
        state: 'AVAILABLE',
      },
    });

    subscriberUpdateMock.mockResolvedValue({
      ...subscriber,
      status: 'PROVISIONING',
      activatedAt: null,
    });

    const req = makeReq({
      iccid: subscriber.iccid,
    });

    const res = makeRes();

    await activateProfile(req, res);

    expect(
      activateProfileMock
    ).toHaveBeenCalledWith({
      iccid:
        '8910300000059080801',
      activationCode:
        'SERVER-SAVED-ACTIVATION',
      providerProfileId:
        '8910300000059080801',
      testMode: false,
    });

    expect(
      subscriberUpdateMock
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 77,
        },
        data: expect.objectContaining({
          status: 'PROVISIONING',
          activatedAt: null,
        }),
      })
    );

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        status: 'PROVISIONING',
      })
    );
  });

  test('cannot activate a Subscriber that does not belong to the authenticated user', async () => {
    subscriberFindFirstMock.mockResolvedValue(
      null
    );

    const req = makeReq({
      iccid: '8910300000059080801',
    });

    const res = makeRes();

    await activateProfile(req, res);

    expect(
      subscriberFindFirstMock
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 123,
        }),
      })
    );

    expect(
      activateProfileMock
    ).not.toHaveBeenCalled();

    expect(
      subscriberUpdateMock
    ).not.toHaveBeenCalled();

    expect(res.status).toHaveBeenCalledWith(
      404
    );

    expect(res.json).toHaveBeenCalledWith({
      error: 'eSIM profile not found',
    });
  });
});
