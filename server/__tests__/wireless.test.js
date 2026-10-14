import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const fetchEsimUsageMock =
  jest.fn();

const createEsimProfileForProviderMock =
  jest.fn();

const replaceEsimForDeviceMock =
  jest.fn();

// --- Prisma mock --- //
const prismaMock = {
  familyMember: {
    findFirst: jest.fn(),
  },
  mobileDataPackPurchase: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  subscriber: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  user: {
    update: jest.fn(),
  },
  esimReplacement: {
    findFirst: jest.fn(),
  },
};

jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  default: prismaMock,
}));

jest.unstable_mockModule(
  '../services/providers/esimProvider.js',
  () => ({
    fetchEsimUsage:
      fetchEsimUsageMock,
  })
);

jest.unstable_mockModule(
  '../services/provisioningService.js',
  () => ({
    createEsimProfileForProvider:
      createEsimProfileForProviderMock,
    handleProviderWebhook: jest.fn(),
  })
);

jest.unstable_mockModule(
  '../services/esimReplacementService.js',
  () => ({
    replaceEsimForDevice:
      replaceEsimForDeviceMock,
  })
);

jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, res, next) => {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    return next();
  },
}));

// Import router after mocks are set up
const { default: wirelessRouter } = await import('../routes/wireless.js');

function makeApp({ withUser = true } = {}) {
  const app = express();

  app.use(express.json());

  if (withUser) {
    app.use((req, _res, next) => {
      req.user = { id: 123 };
      next();
    });
  }

  app.use('/api/wireless', wirelessRouter);

  return app;
}

describe('wireless routes', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();

    replaceEsimForDeviceMock.mockReset();

    process.env.NODE_ENV = 'test';

    prismaMock.familyMember.findFirst.mockReset();

    prismaMock.mobileDataPackPurchase.findFirst.mockReset();
    prismaMock.mobileDataPackPurchase.findMany.mockReset();
    prismaMock.mobileDataPackPurchase.update.mockReset();

    prismaMock.subscriber.findFirst.mockReset();
    prismaMock.subscriber.findUnique.mockReset();
    prismaMock.subscriber.update.mockReset();
    prismaMock.subscriber.updateMany.mockReset();
    prismaMock.user.update.mockReset();
    prismaMock.esimReplacement.findFirst.mockReset();
    prismaMock.esimReplacement.findFirst.mockResolvedValue(null);

    createEsimProfileForProviderMock.mockReset();

    prismaMock.subscriber.findFirst.mockResolvedValue(null);
    prismaMock.subscriber.findUnique.mockResolvedValue(null);
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  // ---------------- GET /status ---------------- //

  it('returns 401 when user is not authenticated', async () => {
    const app = makeApp({ withUser: false });

    const res = await request(app).get('/api/wireless/status');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns INDIVIDUAL mode with active pack when no family membership', async () => {
    const app = makeApp();

    const now = new Date();

    const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;

    const expiresAt = new Date(
      now.getTime() + fiveDaysMs
    ).toISOString();

    prismaMock.mobileDataPackPurchase.findMany.mockResolvedValue([{
      id: 10,
      userId: 123,
      addonKind: 'ESIM_STARTER',
      totalDataMb: 1000,
      remainingDataMb: 300,
      expiresAt,
      purchasedAt: now.toISOString(),
    }]);

    const res = await request(app).get('/api/wireless/status');

    expect(res.status).toBe(200);

    expect(res.body.mode).toBe('INDIVIDUAL');
    expect(res.body.state).toBe('OK');
    expect(res.body.low).toBe(false);
    expect(res.body.exhausted).toBe(false);
    expect(res.body.expired).toBe(false);

    expect(res.body.source).toMatchObject({
      type: 'ESIM_PACK',
      id: 10,
      addonKind: 'ESIM_STARTER',
      totalDataMb: 1000,
      remainingDataMb: 300,
      expiresAt,
    });

    expect(res.body.source.daysRemaining).toBe(5);

    expect(
      prismaMock.mobileDataPackPurchase.findMany
    ).toHaveBeenCalledTimes(1);
  });

  it('uses the provider ACTIVE package instead of a newer queued top-up', async () => {
    const app = makeApp();

    const now = Date.now();

    const expiresAt =
      new Date(
        now + 30 * 24 * 60 * 60 * 1000
      ).toISOString();

    const queuedPack = {
      id: 43,
      userId: 123,
      addonKind: 'chatforia_esim_local_3_premium',
      totalDataMb: 3072,
      remainingDataMb: 3072,
      expiresAt,
      purchasedAt:
        new Date(now).toISOString(),
      providerPurchaseId:
        'telna-package-43',
      iccid: 'same-topup-iccid',
    };

    const activePack = {
      id: 42,
      userId: 123,
      addonKind: 'chatforia_esim_local_3_premium',
      totalDataMb: 3072,
      remainingDataMb: 2974,
      expiresAt,
      purchasedAt:
        new Date(now - 60_000).toISOString(),
      providerPurchaseId:
        'telna-package-42',
      iccid: 'same-topup-iccid',
    };

    prismaMock.mobileDataPackPurchase.findMany
      .mockResolvedValue([
        queuedPack,
        activePack,
      ]);

    fetchEsimUsageMock
      .mockResolvedValueOnce({
        totalMb: null,
        remainingMb: 3072,
        expiresAt,
        providerStatus: 'NOT_ACTIVE',
      })
      .mockResolvedValueOnce({
        totalMb: null,
        remainingMb: 2974,
        expiresAt,
        providerStatus: 'ACTIVE',
      });

    prismaMock.mobileDataPackPurchase.update
      .mockImplementation(
        async ({ where, data }) => {
          const original =
            where.id === 43
              ? queuedPack
              : activePack;

          return {
            ...original,
            ...data,
          };
        }
      );

    const res =
      await request(app)
        .get('/api/wireless/status');

    expect(res.status).toBe(200);

    expect(
      fetchEsimUsageMock
    ).toHaveBeenCalledTimes(2);

    expect(
      fetchEsimUsageMock
    ).toHaveBeenNthCalledWith(
      1,
      'telna-package-43'
    );

    expect(
      fetchEsimUsageMock
    ).toHaveBeenNthCalledWith(
      2,
      'telna-package-42'
    );

    expect(res.body.source.id).toBe(42);

    expect(
      res.body.source.remainingDataMb
    ).toBe(2974);

    expect(res.body.queuedPacks).toEqual([
      {
        id: 43,
        addonKind:
          'chatforia_esim_local_3_premium',
        totalDataMb: 3072,
        remainingDataMb: 3072,
        expiresAt,
      },
    ]);

    expect(
      res.body.queuedDataMb
    ).toBe(3072);

    expect(
      res.body.totalAvailableDataMb
    ).toBe(6046);
  });

  it(
    'does not double-count a NOT_ACTIVE compatibility fallback as queued data',
    async () => {
      const app = makeApp();

      const now = Date.now();

      const expiresAt =
        new Date(
          now + 30 * 24 * 60 * 60 * 1000
        ).toISOString();

      const newestNotActivePack = {
        id: 44,
        userId: 123,
        addonKind:
          'chatforia_esim_local_3_premium',
        totalDataMb: 3072,
        remainingDataMb: 2500,
        expiresAt,
        purchasedAt:
          new Date(now).toISOString(),
        providerPurchaseId:
          'telna-package-44',
        iccid: 'same-fallback-iccid',
      };

      const olderNotActivePack = {
        id: 43,
        userId: 123,
        addonKind:
          'chatforia_esim_local_3_premium',
        totalDataMb: 3072,
        remainingDataMb: 3072,
        expiresAt,
        purchasedAt:
          new Date(
            now - 60_000
          ).toISOString(),
        providerPurchaseId:
          'telna-package-43',
        iccid: 'same-fallback-iccid',
      };

      prismaMock.mobileDataPackPurchase.findMany
        .mockResolvedValue([
          newestNotActivePack,
          olderNotActivePack,
        ]);

      fetchEsimUsageMock
        .mockResolvedValueOnce({
          totalMb: null,
          remainingMb: 2500,
          expiresAt,
          providerStatus: 'NOT_ACTIVE',
        })
        .mockResolvedValueOnce({
          totalMb: null,
          remainingMb: 3072,
          expiresAt,
          providerStatus: 'NOT_ACTIVE',
        });

      prismaMock.mobileDataPackPurchase.update
        .mockImplementation(
          async ({ where, data }) => {
            const original =
              where.id === 44
                ? newestNotActivePack
                : olderNotActivePack;

            return {
              ...original,
              ...data,
            };
          }
        );

      const res =
        await request(app)
          .get('/api/wireless/status');

      expect(res.status).toBe(200);

      /*
       * Preserve compatibility behavior: with no provider
       * ACTIVE package, the newest usable pack may still
       * drive Current Usage.
       */
      expect(res.body.source.id).toBe(44);

      expect(
        res.body.source.remainingDataMb
      ).toBe(2500);

      /*
       * But because the provider has not confirmed an ACTIVE
       * package, do not also expose NOT_ACTIVE candidates as
       * queued data. That would double-count the fallback.
       */
      expect(res.body.queuedPacks).toEqual([]);
      expect(res.body.queuedDataMb).toBe(0);

      expect(
        res.body.totalAvailableDataMb
      ).toBe(2500);

      expect(
        fetchEsimUsageMock
      ).toHaveBeenCalledTimes(2);
    }
  );


  it(
  'refreshes provider usage with providerPurchaseId instead of profile ID or ICCID',
  async () => {
    const app = makeApp();

    const expiresAt =
      new Date(
        Date.now() +
          5 *
            24 *
            60 *
            60 *
            1000
      ).toISOString();

    const providerExpiresAt =
      new Date(
        Date.now() +
          4 *
            24 *
            60 *
            60 *
            1000
      ).toISOString();

    prismaMock
      .mobileDataPackPurchase
      .findMany
      .mockResolvedValue([{
        id: 11,
        userId: 123,
        addonKind:
          'ESIM_STARTER',
        totalDataMb: 1000,
        remainingDataMb: 700,
        expiresAt,
        purchasedAt:
          new Date().toISOString(),

        providerPurchaseId:
          'telna-package-456',

        esimProfileId:
          'telna-profile-should-not-be-used',

        iccid:
          '8910300000059080801',
      }]);

    prismaMock
      .subscriber
      .findFirst
      .mockResolvedValue({
        id: 50,
        userId: 123,

        providerProfileId:
          'telna-profile-should-not-be-used',

        iccid:
          '8910300000059080801',
      });

    fetchEsimUsageMock
      .mockResolvedValue({
        totalMb: 1000,
        remainingMb: 512,
        expiresAt:
          providerExpiresAt,
      });

    prismaMock
      .mobileDataPackPurchase
      .update
      .mockImplementation(
        async ({ data }) => ({
          id: 11,
          userId: 123,
          addonKind:
            'ESIM_STARTER',
          purchasedAt:
            new Date().toISOString(),
          ...data,
        })
      );

    const res =
      await request(app)
        .get(
          '/api/wireless/status'
        );

    expect(
      res.status
    ).toBe(200);

    expect(
      fetchEsimUsageMock
    ).toHaveBeenCalledTimes(1);

    expect(
      fetchEsimUsageMock
    ).toHaveBeenCalledWith(
      'telna-package-456'
    );

    expect(
      fetchEsimUsageMock
    ).not.toHaveBeenCalledWith(
      'telna-profile-should-not-be-used'
    );

    expect(
      fetchEsimUsageMock
    ).not.toHaveBeenCalledWith(
      '8910300000059080801'
    );

    const updateCall =
      prismaMock.mobileDataPackPurchase.update
        .mock.calls[0][0];

    expect(updateCall.where).toEqual({
      id: 11,
    });

    expect(updateCall.data).toMatchObject({
      remainingDataMb: 512,
      providerPurchaseId:
        'telna-package-456',
    });

    /*
     * Usage refresh must never copy identity from the user's latest
     * Subscriber onto this package.
     */
    expect(updateCall.data).not.toHaveProperty(
      'iccid'
    );

    expect(updateCall.data).not.toHaveProperty(
      'esimProfileId'
    );

    expect(
      prismaMock
        .mobileDataPackPurchase
        .update
    ).toHaveBeenCalledWith({
      where: {
        id: 11,
      },

      data: {
        totalDataMb: 1000,
        remainingDataMb: 512,
        expiresAt:
          providerExpiresAt,

        providerPurchaseId:
          'telna-package-456',
      },
    });

    expect(
      res.body.source
        .remainingDataMb
    ).toBe(512);
  }
);



  it('does not increase customer balance when replacement provider usage moves backwards', async () => {
    const app = makeApp();

    const expiresAt =
      new Date(
        Date.now() +
          5 * 24 * 60 * 60 * 1000
      ).toISOString();

    prismaMock.mobileDataPackPurchase.findMany.mockResolvedValue([{
      id: 13,
      userId: 123,
      addonKind: 'chatforia_esim_local_3_premium',
      totalDataMb: 3072,

      // Chatforia has already observed consumption down to 1,000 MB.
      remainingDataMb: 1000,

      expiresAt,
      purchasedAt: new Date().toISOString(),
      providerPurchaseId: 'replacement-package-13',
      esimProfileId: 'replacement-profile-13',
      iccid: 'replacement-iccid-13',
    }]);

    /*
     * Original transferred entitlement was 1,237 MB in a 3,072 MB
     * provider container. This provider reading implies only 137 MB
     * consumed, which would calculate to 1,100 MB remaining.
     *
     * Because Chatforia already stored 1,000 MB, this reading is stale
     * and must not replenish 100 MB.
     */
    fetchEsimUsageMock.mockResolvedValue({
      totalMb: null,
      remainingMb: 2935,
      expiresAt,
    });

    prismaMock.esimReplacement.findFirst.mockResolvedValue({
      id: 'replacement-13',
      userId: 123,
      newProviderPurchaseId: 'replacement-package-13',
      remainingDataMb: 1237,
      replacementDataMb: 3072,
    });

    prismaMock.mobileDataPackPurchase.update.mockImplementation(
      async ({ data }) => ({
        id: 13,
        userId: 123,
        addonKind: 'chatforia_esim_local_3_premium',
        purchasedAt: new Date().toISOString(),
        ...data,
      })
    );

    const res =
      await request(app)
        .get('/api/wireless/status');

    expect(res.status).toBe(200);

    expect(
      prismaMock.mobileDataPackPurchase.update
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 13 },
        data: expect.objectContaining({
          remainingDataMb: 1000,
        }),
      })
    );

    expect(res.body.source.remainingDataMb).toBe(1000);
  });

  it('does not expose replacement provider capacity as customer entitlement', async () => {
    const app = makeApp();

    const expiresAt =
      new Date(
        Date.now() +
          5 * 24 * 60 * 60 * 1000
      ).toISOString();

    /*
     * The customer had 1,237 MB when the device replacement occurred,
     * but Telna required a 3 GB provider-side replacement package.
     */
    prismaMock.mobileDataPackPurchase.findMany.mockResolvedValue([{
      id: 12,
      userId: 123,
      addonKind: 'chatforia_esim_local_3_premium',
      totalDataMb: 3072,
      remainingDataMb: 1237,
      expiresAt,
      purchasedAt: new Date().toISOString(),
      providerPurchaseId: 'replacement-package-12',
      esimProfileId: 'replacement-profile-12',
      iccid: 'replacement-iccid-12',
    }]);

    fetchEsimUsageMock.mockResolvedValue({
      totalMb: null,
      remainingMb: 2900,
      expiresAt,
    });

    prismaMock.esimReplacement.findFirst.mockResolvedValue({
      id: 'replacement-12',
      userId: 123,
      newProviderPurchaseId: 'replacement-package-12',

      // Actual customer entitlement transferred.
      remainingDataMb: 1237,

      // Physical Telna package capacity.
      replacementDataMb: 3072,
    });

    prismaMock.mobileDataPackPurchase.update.mockImplementation(
      async ({ data }) => ({
        id: 12,
        userId: 123,
        addonKind: 'chatforia_esim_local_3_premium',
        purchasedAt: new Date().toISOString(),
        ...data,
      })
    );

    const res =
      await request(app)
        .get('/api/wireless/status');

    expect(res.status).toBe(200);

    /*
     * Telna reports 2,900 MB remaining in a 3,072 MB container:
     * 172 MB provider consumption.
     *
     * Customer entitlement:
     * 1,237 - 172 = 1,065 MB.
     */
    expect(
      prismaMock.mobileDataPackPurchase.update
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 12 },
        data: expect.objectContaining({
          remainingDataMb: 1065,
        }),
      })
    );

    expect(res.body.source.remainingDataMb).toBe(1065);

    expect(
      prismaMock.esimReplacement.findFirst
    ).toHaveBeenCalledWith({
      where: {
        userId: 123,
        newProviderPurchaseId:
          'replacement-package-12',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  });

  it('returns INDIVIDUAL exhausted/expired status from last pack when no active pack', async () => {
    const app = makeApp();

    const now = new Date();

    const oneDayAgo = new Date(
      now.getTime() - 24 * 60 * 60 * 1000
    ).toISOString();

    prismaMock.mobileDataPackPurchase.findMany
      .mockResolvedValue([]);

    prismaMock.mobileDataPackPurchase.findFirst
      .mockResolvedValue({
        id: 20,
        userId: 123,
        addonKind: 'ESIM_TRAVELER',
        totalDataMb: 1000,
        remainingDataMb: 0,
        expiresAt: oneDayAgo,
        purchasedAt: oneDayAgo,
      });

    const res = await request(app).get('/api/wireless/status');

    expect(res.status).toBe(200);

    expect(res.body.mode).toBe('INDIVIDUAL');
    expect(res.body.state).toBe('EXPIRED');
    expect(res.body.exhausted).toBe(true);
    expect(res.body.expired).toBe(true);

    expect(res.body.source).toMatchObject({
      type: 'ESIM_PACK',
      id: 20,
      addonKind: 'ESIM_TRAVELER',
      totalDataMb: 1000,
      remainingDataMb: 0,
      expiresAt: oneDayAgo,
    });

    expect(res.body.source.daysRemaining).toBe(0);

    expect(
      prismaMock.mobileDataPackPurchase.findMany
    ).toHaveBeenCalledTimes(1);

    expect(
      prismaMock.mobileDataPackPurchase.findFirst
    ).toHaveBeenCalledTimes(1);
  });

  it('returns NONE when no packs exist', async () => {
    const app = makeApp();

    prismaMock.mobileDataPackPurchase.findMany
      .mockResolvedValue([]);

    prismaMock.mobileDataPackPurchase.findFirst
      .mockResolvedValue(null);

    const res = await request(app).get('/api/wireless/status');

    expect(res.status).toBe(200);

    expect(res.body).toEqual({
      mode: 'NONE',
      state: 'NONE',
      low: false,
      exhausted: false,
      expired: false,
      source: null,
    });
  });

  it('returns 500 on unexpected error', async () => {
    const app = makeApp();

    prismaMock.mobileDataPackPurchase.findMany.mockRejectedValueOnce(
      new Error('DB failure')
    );

    const res = await request(app).get('/api/wireless/status');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to load wireless status');
  });

  // ---------------- POST /debug/consume ---------------- //

  it('returns 403 in production', async () => {
    process.env.NODE_ENV = 'production';

    const app = makeApp();

    const res = await request(app)
      .post('/api/wireless/debug/consume')
      .send({ mb: 100 });

    expect(res.status).toBe(403);

    expect(res.body).toEqual({
      error: 'Not available in production',
    });
  });

  it('returns 400 when mb is invalid', async () => {
    const app = makeApp();

    const res = await request(app)
      .post('/api/wireless/debug/consume')
      .send({ mb: 0 });

    expect(res.status).toBe(400);

    expect(res.body).toEqual({
      error: 'mb must be > 0',
    });
  });

  it('returns 400 when there is no active individual pack to consume from', async () => {
    const app = makeApp();

    prismaMock.mobileDataPackPurchase.findFirst.mockResolvedValue(
      null
    );

    const res = await request(app)
      .post('/api/wireless/debug/consume')
      .send({ mb: 50 });

    expect(res.status).toBe(400);

    expect(res.body).toEqual({
      error: 'No active individual pack to consume from',
    });
  });

  it('consumes from active pack and updates remainingDataMb', async () => {
    const app = makeApp();

    prismaMock.mobileDataPackPurchase.findFirst.mockResolvedValue({
      id: 30,
      userId: 123,
      addonKind: 'ESIM_POWER',
      totalDataMb: 1000,
      remainingDataMb: 600,
      expiresAt: new Date().toISOString(),
      purchasedAt: new Date().toISOString(),
    });

    prismaMock.mobileDataPackPurchase.update.mockResolvedValue({
      id: 30,
      remainingDataMb: 500,
    });

    const res = await request(app)
      .post('/api/wireless/debug/consume')
      .send({ mb: 100 });

    expect(
      prismaMock.mobileDataPackPurchase.findFirst
    ).toHaveBeenCalledTimes(1);

    expect(
      prismaMock.mobileDataPackPurchase.update
    ).toHaveBeenCalledWith({
      where: { id: 30 },
      data: { remainingDataMb: 500 },
    });

    expect(res.status).toBe(200);

    expect(res.body).toEqual({
      ok: true,
      id: 30,
      remainingDataMb: 500,
    });
  });

  it('handles errors in debug consume with 500', async () => {
    const app = makeApp();

    prismaMock.mobileDataPackPurchase.findFirst.mockResolvedValue({
      id: 40,
      userId: 123,
      remainingDataMb: 300,
    });

    prismaMock.mobileDataPackPurchase.update.mockRejectedValue(
      new Error('Update failed')
    );

    const res = await request(app)
      .post('/api/wireless/debug/consume')
      .send({ mb: 100 });

    expect(res.status).toBe(500);

    expect(res.body).toEqual({
      error: 'Failed to consume data',
    });
  });


  // ---------------- POST /activate ownership ---------------- //

  it('allows the authenticated owner to activate their Subscriber', async () => {
    const app = makeApp();

    prismaMock.subscriber.findFirst.mockResolvedValueOnce({
      id: 70,
      userId: 123,
      purchaseId: null,
      provider: 'telna',
      providerMeta: {},
    });

    createEsimProfileForProviderMock.mockResolvedValueOnce({
      success: true,
      profileId: 'profile-70',
      iccid: '8910300000000000070',
      externalId: 'external-70',
      qrSvg: null,
    });

    prismaMock.subscriber.update.mockResolvedValueOnce({});

    const res = await request(app)
      .post('/api/wireless/activate')
      .send({ subscriberId: 70 });

    expect(res.status).toBe(200);

    expect(prismaMock.subscriber.findFirst).toHaveBeenCalledWith({
      where: {
        id: 70,
        userId: 123,
      },
    });

    expect(createEsimProfileForProviderMock).toHaveBeenCalledWith(
      'telna',
      {
        subscriberId: 70,
        purchaseId: null,
      },
    );

    expect(prismaMock.subscriber.update).toHaveBeenCalledTimes(1);
  });

  it('does not activate another users Subscriber by ID', async () => {
    const app = makeApp();

    /*
     * Ownership-constrained lookup returns nothing even if that numeric
     * Subscriber ID exists for somebody else.
     */
    prismaMock.subscriber.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/wireless/activate')
      .send({ subscriberId: 999 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: 'subscriber not found',
    });

    expect(prismaMock.subscriber.findFirst).toHaveBeenCalledWith({
      where: {
        id: 999,
        userId: 123,
      },
    });

    expect(createEsimProfileForProviderMock).not.toHaveBeenCalled();
    expect(prismaMock.subscriber.update).not.toHaveBeenCalled();
  });

  it('scopes activationToken lookup to the authenticated user', async () => {
    const app = makeApp();

    prismaMock.subscriber.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/wireless/activate')
      .send({
        activationToken: 'token-owned-by-someone-else',
      });

    expect(res.status).toBe(404);

    expect(prismaMock.subscriber.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 123,
        providerMeta: {
          path: ['activationToken'],
          equals: 'token-owned-by-someone-else',
        },
      },
    });

    expect(createEsimProfileForProviderMock).not.toHaveBeenCalled();
    expect(prismaMock.subscriber.update).not.toHaveBeenCalled();
  });

  // ---------------- POST /claim ownership ---------------- //

  it('allows an unowned Subscriber to be claimed', async () => {
    const app = makeApp();

    prismaMock.subscriber.findUnique.mockResolvedValueOnce({
      id: 80,
      userId: null,
      iccid: null,
    });

    prismaMock.subscriber.updateMany.mockResolvedValueOnce({
      count: 1,
    });

    prismaMock.subscriber.findFirst.mockResolvedValueOnce({
      id: 80,
      userId: 123,
      iccid: null,
    });

    const res = await request(app)
      .post('/api/wireless/claim')
      .send({ subscriberId: 80 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(prismaMock.subscriber.updateMany).toHaveBeenCalledWith({
      where: {
        id: 80,
        userId: null,
      },
      data: {
        userId: 123,
      },
    });

    expect(prismaMock.subscriber.findFirst).toHaveBeenCalledWith({
      where: {
        id: 80,
        userId: 123,
      },
    });
  });

  it('does not allow a Subscriber owned by another user to be claimed', async () => {
    const app = makeApp();

    prismaMock.subscriber.findUnique.mockResolvedValueOnce({
      id: 81,
      userId: 456,
      iccid: '8910300000000000081',
    });

    const res = await request(app)
      .post('/api/wireless/claim')
      .send({ subscriberId: 81 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: 'subscriber not found',
    });

    expect(prismaMock.subscriber.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.subscriber.update).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('allows claiming a Subscriber already owned by the same user without rewriting ownership', async () => {
    const app = makeApp();

    prismaMock.subscriber.findUnique.mockResolvedValueOnce({
      id: 82,
      userId: 123,
      iccid: null,
    });

    const res = await request(app)
      .post('/api/wireless/claim')
      .send({ subscriberId: 82 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(prismaMock.subscriber.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.subscriber.update).not.toHaveBeenCalled();
  });

  // ---------------- POST /esim/:purchaseId/replace ---------------- //

  it('returns 401 for an unauthenticated eSIM replacement request', async () => {
    const app = makeApp({
      withUser: false,
    });

    const res =
      await request(app)
        .post(
          '/api/wireless/esim/50/replace'
        )
        .send({});

    expect(res.status).toBe(401);

    expect(
      replaceEsimForDeviceMock
    ).not.toHaveBeenCalled();
  });

  it('rejects an invalid replacement purchase ID before calling the service', async () => {
    const app = makeApp();

    const res =
      await request(app)
        .post(
          '/api/wireless/esim/not-a-number/replace'
        )
        .send({});

    expect(res.status).toBe(400);

    expect(res.body).toEqual({
      error:
        'Valid purchaseId required',
    });

    expect(
      replaceEsimForDeviceMock
    ).not.toHaveBeenCalled();
  });

  it('replaces an eSIM using only the authenticated user and purchase ID', async () => {
    const app = makeApp();

    replaceEsimForDeviceMock
      .mockResolvedValue({
        id: 'replacement-1',
        purchaseId: 50,
        status: 'COMPLETED',
        oldIccid: 'OLD-ICCID',
        newIccid: 'NEW-ICCID',
        remainingDataMb: 4301,
        originalExpiresAt:
          '2026-11-01T00:00:00.000Z',
        createdAt:
          '2026-10-13T22:00:00.000Z',
        completedAt:
          '2026-10-13T22:00:05.000Z',
        newSubscriber: {
          id: 101,
          iccid: 'NEW-ICCID',
          providerProfileId:
            'NEW-PROFILE',
          smdp: null,
          activationCode:
            'LPA:1$new.example$NEW-CODE',
          lpaUri:
            'LPA:1$new.example$NEW-CODE',
          qrPayload:
            'LPA:1$new.example$NEW-CODE',
        },
      });

    const res =
      await request(app)
        .post(
          '/api/wireless/esim/50/replace'
        )
        .set(
          'Idempotency-Key',
          'replacement-request-1'
        )
        .send({
          // These values must have no authority.
          userId: 999,
          iccid: 'ATTACKER-ICCID',
          providerPurchaseId:
            'ATTACKER-PACKAGE',
          remainingDataMb: 999999,
        });

    expect(res.status).toBe(200);

    expect(
      replaceEsimForDeviceMock
    ).toHaveBeenCalledTimes(1);

    expect(
      replaceEsimForDeviceMock
    ).toHaveBeenCalledWith({
      userId: 123,
      purchaseId: 50,
      idempotencyKey:
        'replacement-request-1',
      reason:
        'DEVICE_REPLACEMENT',
    });

    expect(res.body).toEqual({
      ok: true,
      replacement: {
        id: 'replacement-1',
        purchaseId: 50,
        status: 'COMPLETED',
        oldIccid: 'OLD-ICCID',
        newIccid: 'NEW-ICCID',
        remainingDataMb: 4301,
        expiresAt:
          '2026-11-01T00:00:00.000Z',
        createdAt:
          '2026-10-13T22:00:00.000Z',
        completedAt:
          '2026-10-13T22:00:05.000Z',
        installation: {
          subscriberId: 101,
          iccid: 'NEW-ICCID',
          providerProfileId:
            'NEW-PROFILE',
          smdp: null,
          activationCode:
            'LPA:1$new.example$NEW-CODE',
          lpaUri:
            'LPA:1$new.example$NEW-CODE',
          qrPayload:
            'LPA:1$new.example$NEW-CODE',
        },
      },
    });
  });

  it('returns 404 when the authenticated user does not own the purchase', async () => {
    const app = makeApp();

    replaceEsimForDeviceMock
      .mockRejectedValue(
        Object.assign(
          new Error(
            'Active eSIM purchase was not found'
          ),
          {
            code:
              'ESIM_REPLACEMENT_PURCHASE_NOT_FOUND',
          }
        )
      );

    const res =
      await request(app)
        .post(
          '/api/wireless/esim/999/replace'
        )
        .set(
          'Idempotency-Key',
          'replacement-not-owned-1'
        )
        .send({});

    expect(res.status).toBe(404);

    expect(res.body).toEqual({
      error:
        'eSIM purchase not found',
      code:
        'ESIM_REPLACEMENT_PURCHASE_NOT_FOUND',
    });
  });

  it('returns 409 when the existing eSIM state cannot safely be replaced', async () => {
    const app = makeApp();

    replaceEsimForDeviceMock
      .mockRejectedValue(
        Object.assign(
          new Error(
            'The existing eSIM has no provider package identifier'
          ),
          {
            code:
              'ESIM_REPLACEMENT_MISSING_PACKAGE',
          }
        )
      );

    const res =
      await request(app)
        .post(
          '/api/wireless/esim/50/replace'
        )
        .set(
          'Idempotency-Key',
          'replacement-unsafe-state-1'
        )
        .send({});

    expect(res.status).toBe(409);

    expect(res.body).toEqual({
      error:
        'The existing eSIM has no provider package identifier',
      code:
        'ESIM_REPLACEMENT_MISSING_PACKAGE',
    });
  });

  it('returns 409 when the existing eSIM has no remaining data to transfer', async () => {
    const app = makeApp();

    replaceEsimForDeviceMock
      .mockRejectedValue(
        Object.assign(
          new Error(
            'The eSIM package has no remaining data to transfer'
          ),
          {
            code:
              'ESIM_REPLACEMENT_EXHAUSTED',
          }
        )
      );

    const res =
      await request(app)
        .post(
          '/api/wireless/esim/50/replace'
        )
        .set(
          'Idempotency-Key',
          'replacement-exhausted-1'
        )
        .send({});

    expect(res.status).toBe(409);

    expect(
      replaceEsimForDeviceMock
    ).toHaveBeenCalledWith({
      userId: 123,
      purchaseId: 50,
      idempotencyKey:
        'replacement-exhausted-1',
      reason:
        'DEVICE_REPLACEMENT',
    });

    expect(res.body).toEqual({
      error:
        'The eSIM package has no remaining data to transfer',
      code:
        'ESIM_REPLACEMENT_EXHAUSTED',
    });
  });

  it('returns 409 when a replacement collision cannot be reconciled', async () => {
    const app = makeApp();

    replaceEsimForDeviceMock
      .mockRejectedValue(
        Object.assign(
          new Error(
            'Replacement collision detected'
          ),
          {
            code:
              'ESIM_REPLACEMENT_COLLISION_UNRESOLVED',
          }
        )
      );

    const res =
      await request(app)
        .post(
          '/api/wireless/esim/50/replace'
        )
        .set(
          'Idempotency-Key',
          'replacement-collision-1'
        )
        .send({});

    expect(res.status).toBe(409);

    expect(res.body).toEqual({
      error:
        'An eSIM replacement is already being processed',
      code:
        'ESIM_REPLACEMENT_COLLISION_UNRESOLVED',
    });
  });

  it('returns 400 when Idempotency-Key is missing', async () => {
    const app = makeApp();

    const res =
      await request(app)
        .post(
          '/api/wireless/esim/50/replace'
        )
        .send({});

    expect(res.status).toBe(400);

    expect(res.body).toEqual({
      error:
        'Valid Idempotency-Key header required',
      code:
        'ESIM_REPLACEMENT_INVALID_IDEMPOTENCY_KEY',
    });

    expect(
      replaceEsimForDeviceMock
    ).not.toHaveBeenCalled();
  });

  it('returns 409 when an idempotency key was already used for another purchase', async () => {
    const app = makeApp();

    replaceEsimForDeviceMock
      .mockRejectedValue(
        Object.assign(
          new Error(
            'Idempotency key was already used for another eSIM purchase'
          ),
          {
            code:
              'ESIM_REPLACEMENT_IDEMPOTENCY_CONFLICT',
          }
        )
      );

    const res =
      await request(app)
        .post(
          '/api/wireless/esim/51/replace'
        )
        .set(
          'Idempotency-Key',
          'replacement-request-1'
        )
        .send({});

    expect(res.status).toBe(409);

    expect(
      replaceEsimForDeviceMock
    ).toHaveBeenCalledWith({
      userId: 123,
      purchaseId: 51,
      idempotencyKey:
        'replacement-request-1',
      reason:
        'DEVICE_REPLACEMENT',
    });

    expect(res.body).toEqual({
      error:
        'Idempotency key was already used for another eSIM purchase',
      code:
        'ESIM_REPLACEMENT_IDEMPOTENCY_CONFLICT',
    });
  });


});
