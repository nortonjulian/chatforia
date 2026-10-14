import { jest } from '@jest/globals';

import {
  chooseReplacementPack,
  replaceEsimForDevice,
  reconcileEsimReplacement,
  retryFailedEsimReplacement,
} from '../esimReplacementService.js';

function makeFixture({
  remainingMb = 4300.25,
  expiresAt = new Date('2026-11-01T00:00:00.000Z'),
} = {}) {
  const purchase = {
    id: 50,
    userId: 7,
    kind: 'ESIM',
    addonKind: 'chatforia_esim_local_10_premium',
    totalDataMb: 10 * 1024,
    remainingDataMb: 5000,
    expiresAt,
    iccid: 'OLD-ICCID',
    esimProfileId: 'OLD-PROFILE',
    providerPurchaseId: 'OLD-PACKAGE',
    qrCodeSvg: '<old-qr>',
  };

  const oldSubscriber = {
    id: 100,
    userId: 7,
    purchaseId: 50,
    provider: 'telna',
    providerProfileId: 'OLD-PROFILE',
    iccid: 'OLD-ICCID',
    region: 'US',
    status: 'ACTIVE',
    providerMeta: {},
    activatedAt: new Date('2026-10-01T00:00:00.000Z'),
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
  };

  const newSubscriber = {
    id: 101,
    userId: 7,
    purchaseId: 50,
    provider: 'telna',
    providerProfileId: 'NEW-PROFILE',
    iccid: 'NEW-ICCID',
    region: 'US',
    status: 'PENDING',
    providerMeta: {},
  };

  const replacement = {
    id: 'replacement-1',
    status: 'PENDING',
  };

  const tx = {
    esimReplacement: {
      update: jest.fn().mockResolvedValue({}),
    },
    mobileDataPackPurchase: {
      update: jest.fn().mockResolvedValue({}),
    },
    subscriber: {
      update: jest.fn().mockResolvedValue({}),
    },
    user: {
      update: jest.fn().mockResolvedValue({}),
    },
  };

  const prismaClient = {
    mobileDataPackPurchase: {
      findFirst: jest.fn().mockResolvedValue(purchase),
    },
    subscriber: {
      findFirst: jest.fn().mockResolvedValue(oldSubscriber),
    },
    esimReplacement: {
      create: jest.fn().mockResolvedValue(replacement),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({
        count: 1,
      }),
      findUnique: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue({
          ...replacement,
          status: 'COMPLETED',
          oldSubscriber,
          newSubscriber,
        }),
    },
    $transaction: jest.fn(async (callback) => callback(tx)),
  };

  const provider = {
    fetchEsimUsage: jest.fn().mockResolvedValue({
      remainingMb,
      expiresAt,
    }),
    provisionEsimPack: jest.fn().mockResolvedValue({
      providerPurchaseId: 'NEW-PACKAGE',
      iccid: 'NEW-ICCID',
      expiresAt,
      qrCodeSvg: '<new-qr>',
    }),
    setEsimPackageStatus: jest.fn().mockResolvedValue({
      providerPurchaseId: 'OLD-PACKAGE',
      status: 'TERMINATED',
    }),
    suspendLine: jest.fn().mockResolvedValue({
      ok: true,
    }),
  };

  const allocator = jest.fn().mockResolvedValue({
    subscriber: newSubscriber,
    providerProfileId: 'NEW-PROFILE',
    reserve: {
      iccid: 'NEW-ICCID',
    },
  });

  return {
    purchase,
    oldSubscriber,
    newSubscriber,
    replacement,
    tx,
    prismaClient,
    provider,
    allocator,
  };
}

describe('chooseReplacementPack', () => {
  test.each([
    [1, 3],
    [3 * 1024, 3],
    [3 * 1024 + 0.01, 5],
    [5 * 1024, 5],
    [5 * 1024 + 0.01, 10],
    [10 * 1024 + 0.01, 20],
  ])(
    'selects the smallest local pack covering %s MB',
    (remainingMb, expectedGb) => {
      expect(
        chooseReplacementPack(
          'chatforia_esim_local_20_premium',
          remainingMb
        )
      ).toEqual({
        scope: 'local',
        replacementDataMb: expectedGb * 1024,
        replacementAddonKind:
          `chatforia_esim_local_${expectedGb}_premium`,
      });
    }
  );

  test('rejects an exhausted finite package instead of granting a new 3 GB pack', () => {
    expect(() =>
      chooseReplacementPack(
        'chatforia_esim_local_3_premium',
        0
      )
    ).toThrow(
      expect.objectContaining({
        code:
          'ESIM_REPLACEMENT_EXHAUSTED',
      })
    );
  });

  test('rejects unlimited replacement until its semantics are defined', () => {
    expect(() =>
      chooseReplacementPack(
        'chatforia_esim_local_unlimited_premium',
        100
      )
    ).toThrow(
      expect.objectContaining({
        code: 'ESIM_REPLACEMENT_UNLIMITED_UNSUPPORTED',
      })
    );
  });

  test('does not invent a Global 20 GB replacement pack', () => {
    expect(() =>
      chooseReplacementPack(
        'chatforia_esim_global_10_premium',
        10 * 1024 + 1
      )
    ).toThrow(
      expect.objectContaining({
        code: 'ESIM_REPLACEMENT_NO_CAPACITY',
      })
    );
  });
});

describe('retryFailedEsimReplacement safety', () => {
  test('concurrent retry loser cannot provision another provider package', async () => {
    const fixture = makeFixture();

    const failed = {
      id: 'replacement-1',
      userId: 7,
      purchaseId: 50,
      status: 'FAILED',
      newSubscriberId:
        fixture.newSubscriber.id,
      newIccid:
        fixture.newSubscriber.iccid,
      newProviderProfileId:
        fixture.newSubscriber.providerProfileId,
      newProviderPurchaseId: null,
      oldSubscriberId:
        fixture.oldSubscriber.id,
      oldIccid:
        fixture.oldSubscriber.iccid,
      oldProviderProfileId:
        fixture.oldSubscriber.providerProfileId,
      oldProviderPurchaseId:
        'OLD-PACKAGE',
      remainingDataMb: 4301,
      originalExpiresAt:
        fixture.purchase.expiresAt,
      replacementDataMb:
        5 * 1024,
      replacementAddonKind:
        'chatforia_esim_local_5_premium',
      provisionedAt: null,
      oldPackageTerminatedAt: null,
      oldSubscriber:
        fixture.oldSubscriber,
      newSubscriber:
        fixture.newSubscriber,
      purchase:
        fixture.purchase,
    };

    fixture.prismaClient.esimReplacement.findUnique
      .mockReset()
      .mockResolvedValue(failed);

    /*
     * count: 0 means another retry request already changed FAILED
     * to ALLOCATED and therefore owns the provider side effect.
     */
    fixture.prismaClient.esimReplacement.updateMany
      .mockResolvedValue({
        count: 0,
      });

    await expect(
      retryFailedEsimReplacement(
        failed.id,
        {
          prismaClient:
            fixture.prismaClient,
          provider:
            fixture.provider,
          now:
            new Date(
              '2026-10-13T16:00:00.000Z'
            ),
        }
      )
    ).rejects.toMatchObject({
      code:
        'ESIM_REPLACEMENT_RETRY_ALREADY_CLAIMED',
    });

    expect(
      fixture.prismaClient.esimReplacement.updateMany
    ).toHaveBeenCalledWith({
      where: {
        id: failed.id,
        status: 'FAILED',
      },
      data: {
        status: 'ALLOCATED',
        errorCode: null,
        errorMessage: null,
      },
    });

    expect(
      fixture.provider.provisionEsimPack
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.setEsimPackageStatus
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.suspendLine
    ).not.toHaveBeenCalled();

    /*
     * A retry must reuse the already-recorded Subscriber/ICCID.
     * There is intentionally no allocator dependency in this API.
     */
    expect(
      fixture.prismaClient.mobileDataPackPurchase.findFirst
    ).not.toHaveBeenCalled();
  });
  test('retry winner reuses the frozen allocation and completes the replacement', async () => {
    const fixture = makeFixture();

    const failed = {
      id: 'replacement-1',
      userId: 7,
      purchaseId: 50,
      status: 'FAILED',
      newSubscriberId:
        fixture.newSubscriber.id,
      newIccid:
        fixture.newSubscriber.iccid,
      newProviderProfileId:
        fixture.newSubscriber.providerProfileId,
      newProviderPurchaseId: null,
      oldSubscriberId:
        fixture.oldSubscriber.id,
      oldIccid:
        fixture.oldSubscriber.iccid,
      oldProviderProfileId:
        fixture.oldSubscriber.providerProfileId,
      oldProviderPurchaseId:
        'OLD-PACKAGE',
      remainingDataMb: 4301,
      originalExpiresAt:
        fixture.purchase.expiresAt,
      replacementDataMb:
        5 * 1024,
      replacementAddonKind:
        'chatforia_esim_local_5_premium',
      provisionedAt: null,
      oldPackageTerminatedAt: null,
      oldSubscriber:
        fixture.oldSubscriber,
      newSubscriber:
        fixture.newSubscriber,
      purchase:
        fixture.purchase,
    };

    const completed = {
      ...failed,
      status: 'COMPLETED',
      newProviderPurchaseId:
        'NEW-PACKAGE',
    };

    fixture.prismaClient.esimReplacement.findUnique
      .mockReset()
      .mockResolvedValueOnce(failed)
      .mockResolvedValue(completed);

    fixture.prismaClient.esimReplacement.updateMany
      .mockResolvedValue({
        count: 1,
      });

    const result =
      await retryFailedEsimReplacement(
        failed.id,
        {
          prismaClient:
            fixture.prismaClient,
          provider:
            fixture.provider,
          now:
            new Date(
              '2026-10-13T16:00:00.000Z'
            ),
        }
      );

    expect(
      fixture.prismaClient.esimReplacement.updateMany
    ).toHaveBeenCalledWith({
      where: {
        id: failed.id,
        status: 'FAILED',
      },
      data: {
        status: 'ALLOCATED',
        errorCode: null,
        errorMessage: null,
      },
    });

    /*
     * Retry uses the frozen allocation and entitlement. It does not
     * consume another ICCID or recalculate the old package balance.
     */
    expect(
      fixture.provider.fetchEsimUsage
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.provisionEsimPack
    ).toHaveBeenCalledTimes(1);

    expect(
      fixture.provider.provisionEsimPack
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        providerProfileId:
          'NEW-PROFILE',
        iccid:
          'NEW-ICCID',
        addonKind:
          'chatforia_esim_local_5_premium',
        planCode:
          'chatforia_esim_local_5_premium',
      })
    );

    /*
     * Successful provider creation must be checkpointed before the
     * canonical transaction and destructive old-service cleanup.
     */
    expect(
      fixture.prismaClient.esimReplacement.update
    ).toHaveBeenCalledWith({
      where: {
        id: failed.id,
      },
      data: expect.objectContaining({
        newSubscriberId: 101,
        newIccid:
          'NEW-ICCID',
        newProviderProfileId:
          'NEW-PROFILE',
        newProviderPurchaseId:
          'NEW-PACKAGE',
      }),
    });

    expect(
      fixture.prismaClient.$transaction
    ).toHaveBeenCalled();

    expect(
      fixture.provider.setEsimPackageStatus
    ).toHaveBeenCalledWith(
      'OLD-PACKAGE',
      'TERMINATED'
    );

    expect(
      fixture.provider.suspendLine
    ).toHaveBeenCalled();

    expect(result).toMatchObject({
      status: 'COMPLETED',
      newProviderPurchaseId:
        'NEW-PACKAGE',
    });
  });

  test('definite retry provisioning rejection returns workflow to FAILED without touching old service', async () => {
    const fixture = makeFixture();

    const failed = {
      id: 'replacement-1',
      userId: 7,
      purchaseId: 50,
      status: 'FAILED',
      newSubscriberId:
        fixture.newSubscriber.id,
      newIccid:
        fixture.newSubscriber.iccid,
      newProviderProfileId:
        fixture.newSubscriber.providerProfileId,
      newProviderPurchaseId: null,
      oldSubscriberId:
        fixture.oldSubscriber.id,
      oldIccid:
        fixture.oldSubscriber.iccid,
      oldProviderProfileId:
        fixture.oldSubscriber.providerProfileId,
      oldProviderPurchaseId:
        'OLD-PACKAGE',
      remainingDataMb: 4301,
      originalExpiresAt:
        fixture.purchase.expiresAt,
      replacementDataMb:
        5 * 1024,
      replacementAddonKind:
        'chatforia_esim_local_5_premium',
      provisionedAt: null,
      oldPackageTerminatedAt: null,
      oldSubscriber:
        fixture.oldSubscriber,
      newSubscriber:
        fixture.newSubscriber,
      purchase:
        fixture.purchase,
    };

    fixture.prismaClient.esimReplacement.findUnique
      .mockReset()
      .mockResolvedValue(failed);

    fixture.prismaClient.esimReplacement.updateMany
      .mockResolvedValue({
        count: 1,
      });

    const rejection = Object.assign(
      new Error('Telna rejected replacement package'),
      {
        code: 'TELNA_HTTP_ERROR',
        status: 400,
      }
    );

    fixture.provider.provisionEsimPack
      .mockRejectedValue(rejection);

    await expect(
      retryFailedEsimReplacement(
        failed.id,
        {
          prismaClient:
            fixture.prismaClient,
          provider:
            fixture.provider,
          now:
            new Date(
              '2026-10-13T16:00:00.000Z'
            ),
        }
      )
    ).rejects.toBe(rejection);

    expect(
      fixture.provider.provisionEsimPack
    ).toHaveBeenCalledTimes(1);

    expect(
      fixture.prismaClient.esimReplacement.update
    ).toHaveBeenCalledWith({
      where: {
        id: failed.id,
      },
      data: expect.objectContaining({
        status: 'FAILED',
        errorCode:
          'TELNA_HTTP_ERROR',
      }),
    });

    expect(
      fixture.provider.setEsimPackageStatus
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.suspendLine
    ).not.toHaveBeenCalled();

    expect(
      fixture.prismaClient.$transaction
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.fetchEsimUsage
    ).not.toHaveBeenCalled();
  });

  test('ambiguous retry provisioning failure requires reconciliation without touching old service', async () => {
    const fixture = makeFixture();

    const failed = {
      id: 'replacement-1',
      userId: 7,
      purchaseId: 50,
      status: 'FAILED',
      newSubscriberId:
        fixture.newSubscriber.id,
      newIccid:
        fixture.newSubscriber.iccid,
      newProviderProfileId:
        fixture.newSubscriber.providerProfileId,
      newProviderPurchaseId: null,
      oldSubscriberId:
        fixture.oldSubscriber.id,
      oldIccid:
        fixture.oldSubscriber.iccid,
      oldProviderProfileId:
        fixture.oldSubscriber.providerProfileId,
      oldProviderPurchaseId:
        'OLD-PACKAGE',
      remainingDataMb: 4301,
      originalExpiresAt:
        fixture.purchase.expiresAt,
      replacementDataMb:
        5 * 1024,
      replacementAddonKind:
        'chatforia_esim_local_5_premium',
      provisionedAt: null,
      oldPackageTerminatedAt: null,
      oldSubscriber:
        fixture.oldSubscriber,
      newSubscriber:
        fixture.newSubscriber,
      purchase:
        fixture.purchase,
    };

    fixture.prismaClient.esimReplacement.findUnique
      .mockReset()
      .mockResolvedValue(failed);

    fixture.prismaClient.esimReplacement.updateMany
      .mockResolvedValue({
        count: 1,
      });

    const ambiguous = Object.assign(
      new Error('Telna returned server error'),
      {
        code: 'TELNA_HTTP_ERROR',
        status: 500,
        requestId: 'telna-request-1',
      }
    );

    fixture.provider.provisionEsimPack
      .mockRejectedValue(ambiguous);

    await expect(
      retryFailedEsimReplacement(
        failed.id,
        {
          prismaClient:
            fixture.prismaClient,
          provider:
            fixture.provider,
          now:
            new Date(
              '2026-10-13T16:00:00.000Z'
            ),
        }
      )
    ).rejects.toBe(ambiguous);

    expect(
      fixture.provider.provisionEsimPack
    ).toHaveBeenCalledTimes(1);

    expect(
      fixture.prismaClient.esimReplacement.update
    ).toHaveBeenCalledWith({
      where: {
        id: failed.id,
      },
      data: expect.objectContaining({
        status:
          'REQUIRES_RECONCILIATION',
        errorCode:
          'TELNA_HTTP_ERROR',
      }),
    });

    expect(
      fixture.provider.setEsimPackageStatus
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.suspendLine
    ).not.toHaveBeenCalled();

    expect(
      fixture.prismaClient.$transaction
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.fetchEsimUsage
    ).not.toHaveBeenCalled();
  });

  test('retry canonical persistence failure preserves known provider package and leaves old service untouched', async () => {
    const fixture = makeFixture();

    const failed = {
      id: 'replacement-1',
      userId: 7,
      purchaseId: 50,
      status: 'FAILED',
      newSubscriberId:
        fixture.newSubscriber.id,
      newIccid:
        fixture.newSubscriber.iccid,
      newProviderProfileId:
        fixture.newSubscriber.providerProfileId,
      newProviderPurchaseId: null,
      oldSubscriberId:
        fixture.oldSubscriber.id,
      oldIccid:
        fixture.oldSubscriber.iccid,
      oldProviderProfileId:
        fixture.oldSubscriber.providerProfileId,
      oldProviderPurchaseId:
        'OLD-PACKAGE',
      remainingDataMb: 4301,
      originalExpiresAt:
        fixture.purchase.expiresAt,
      replacementDataMb:
        5 * 1024,
      replacementAddonKind:
        'chatforia_esim_local_5_premium',
      provisionedAt: null,
      oldPackageTerminatedAt: null,
      oldSubscriber:
        fixture.oldSubscriber,
      newSubscriber:
        fixture.newSubscriber,
      purchase:
        fixture.purchase,
    };

    fixture.prismaClient.esimReplacement.findUnique
      .mockReset()
      .mockResolvedValue(failed);

    fixture.prismaClient.esimReplacement.updateMany
      .mockResolvedValue({
        count: 1,
      });

    const canonicalError =
      Object.assign(
        new Error(
          'Canonical persistence failed'
        ),
        {
          code:
            'TEST_RETRY_CANONICAL_PERSISTENCE_FAILED',
        }
      );

    fixture.prismaClient.$transaction
      .mockRejectedValue(
        canonicalError
      );

    await expect(
      retryFailedEsimReplacement(
        failed.id,
        {
          prismaClient:
            fixture.prismaClient,
          provider:
            fixture.provider,
          now:
            new Date(
              '2026-10-13T16:00:00.000Z'
            ),
        }
      )
    ).rejects.toBe(
      canonicalError
    );

    expect(
      fixture.provider.provisionEsimPack
    ).toHaveBeenCalledTimes(1);

    /*
     * Telna returned a definite package ID before Chatforia's
     * canonical transaction failed.
     */
    expect(
      fixture.prismaClient.esimReplacement.update
    ).toHaveBeenCalledWith({
      where: {
        id: failed.id,
      },
      data: expect.objectContaining({
        newSubscriberId: 101,
        newIccid:
          'NEW-ICCID',
        newProviderProfileId:
          'NEW-PROFILE',
        newProviderPurchaseId:
          'NEW-PACKAGE',
      }),
    });

    /*
     * The catch path must leave the workflow reconcilable and retain
     * the known provider package identity.
     */
    expect(
      fixture.prismaClient.esimReplacement.update
    ).toHaveBeenCalledWith({
      where: {
        id: failed.id,
      },
      data: expect.objectContaining({
        status:
          'REQUIRES_RECONCILIATION',
        newProviderPurchaseId:
          'NEW-PACKAGE',
        errorCode:
          'TEST_RETRY_CANONICAL_PERSISTENCE_FAILED',
      }),
    });

    /*
     * Canonical state was not proven durable, so destructive cleanup
     * of the customer's old working service is forbidden.
     */
    expect(
      fixture.provider.setEsimPackageStatus
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.suspendLine
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.fetchEsimUsage
    ).not.toHaveBeenCalled();
  });

  test('retry provider checkpoint failure best-effort preserves known package id for reconciliation', async () => {
    const fixture = makeFixture();

    const failed = {
      id: 'replacement-1',
      userId: 7,
      purchaseId: 50,
      status: 'FAILED',
      newSubscriberId:
        fixture.newSubscriber.id,
      newIccid:
        fixture.newSubscriber.iccid,
      newProviderProfileId:
        fixture.newSubscriber.providerProfileId,
      newProviderPurchaseId: null,
      oldSubscriberId:
        fixture.oldSubscriber.id,
      oldIccid:
        fixture.oldSubscriber.iccid,
      oldProviderProfileId:
        fixture.oldSubscriber.providerProfileId,
      oldProviderPurchaseId:
        'OLD-PACKAGE',
      remainingDataMb: 4301,
      originalExpiresAt:
        fixture.purchase.expiresAt,
      replacementDataMb:
        5 * 1024,
      replacementAddonKind:
        'chatforia_esim_local_5_premium',
      provisionedAt: null,
      oldPackageTerminatedAt: null,
      oldSubscriber:
        fixture.oldSubscriber,
      newSubscriber:
        fixture.newSubscriber,
      purchase:
        fixture.purchase,
    };

    fixture.prismaClient.esimReplacement.findUnique
      .mockReset()
      .mockResolvedValue(failed);

    fixture.prismaClient.esimReplacement.updateMany
      .mockResolvedValue({
        count: 1,
      });

    const checkpointError =
      Object.assign(
        new Error(
          'Provider checkpoint failed'
        ),
        {
          code:
            'TEST_RETRY_PROVIDER_CHECKPOINT_FAILED',
        }
      );

    /*
     * First update = dedicated known-provider-package checkpoint.
     * Second update = catch-path best-effort rescue write.
     */
    fixture.prismaClient.esimReplacement.update
      .mockReset()
      .mockRejectedValueOnce(
        checkpointError
      )
      .mockResolvedValueOnce({});

    await expect(
      retryFailedEsimReplacement(
        failed.id,
        {
          prismaClient:
            fixture.prismaClient,
          provider:
            fixture.provider,
          now:
            new Date(
              '2026-10-13T16:00:00.000Z'
            ),
        }
      )
    ).rejects.toBe(
      checkpointError
    );

    expect(
      fixture.provider.provisionEsimPack
    ).toHaveBeenCalledTimes(1);

    /*
     * The first checkpoint attempted to preserve the definite Telna
     * package identity immediately after provider success.
     */
    expect(
      fixture.prismaClient.esimReplacement.update
    ).toHaveBeenNthCalledWith(
      1,
      {
        where: {
          id: failed.id,
        },
        data: expect.objectContaining({
          newSubscriberId: 101,
          newIccid:
            'NEW-ICCID',
          newProviderProfileId:
            'NEW-PROFILE',
          newProviderPurchaseId:
            'NEW-PACKAGE',
        }),
      }
    );

    /*
     * After that write fails, the catch path must make another
     * best-effort attempt to persist NEW-PACKAGE.
     */
    expect(
      fixture.prismaClient.esimReplacement.update
    ).toHaveBeenNthCalledWith(
      2,
      {
        where: {
          id: failed.id,
        },
        data: expect.objectContaining({
          status:
            'REQUIRES_RECONCILIATION',
          newIccid:
            'NEW-ICCID',
          newProviderPurchaseId:
            'NEW-PACKAGE',
          errorCode:
            'TEST_RETRY_PROVIDER_CHECKPOINT_FAILED',
        }),
      }
    );

    /*
     * Canonical persistence never began, and destructive cleanup is
     * forbidden.
     */
    expect(
      fixture.prismaClient.$transaction
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.setEsimPackageStatus
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.suspendLine
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.fetchEsimUsage
    ).not.toHaveBeenCalled();
  });

  test('expired frozen retry entitlement fails before claim or provider work', async () => {
    const fixture = makeFixture();

    const failed = {
      id: 'replacement-1',
      userId: 7,
      purchaseId: 50,
      status: 'FAILED',
      newSubscriberId:
        fixture.newSubscriber.id,
      newIccid:
        fixture.newSubscriber.iccid,
      newProviderProfileId:
        fixture.newSubscriber.providerProfileId,
      newProviderPurchaseId: null,
      oldSubscriberId:
        fixture.oldSubscriber.id,
      oldIccid:
        fixture.oldSubscriber.iccid,
      oldProviderProfileId:
        fixture.oldSubscriber.providerProfileId,
      oldProviderPurchaseId:
        'OLD-PACKAGE',
      remainingDataMb: 4301,
      originalExpiresAt:
        new Date(
          '2026-10-13T15:59:59.000Z'
        ),
      replacementDataMb:
        5 * 1024,
      replacementAddonKind:
        'chatforia_esim_local_5_premium',
      provisionedAt: null,
      oldPackageTerminatedAt: null,
      oldSubscriber:
        fixture.oldSubscriber,
      newSubscriber:
        fixture.newSubscriber,
      purchase:
        fixture.purchase,
    };

    fixture.prismaClient.esimReplacement.findUnique
      .mockReset()
      .mockResolvedValue(failed);

    await expect(
      retryFailedEsimReplacement(
        failed.id,
        {
          prismaClient:
            fixture.prismaClient,
          provider:
            fixture.provider,
          now:
            new Date(
              '2026-10-13T16:00:00.000Z'
            ),
        }
      )
    ).rejects.toMatchObject({
      code:
        'ESIM_REPLACEMENT_EXPIRED',
    });

    expect(
      fixture.prismaClient.esimReplacement.updateMany
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.provisionEsimPack
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.setEsimPackageStatus
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.suspendLine
    ).not.toHaveBeenCalled();

    expect(
      fixture.prismaClient.$transaction
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.fetchEsimUsage
    ).not.toHaveBeenCalled();
  });

});

describe('replaceEsimForDevice safety ordering', () => {
  const args = {
    userId: 7,
    purchaseId: 50,
    idempotencyKey:
      'replacement-request-1',
    now: new Date('2026-10-13T16:00:00.000Z'),
  };

  test('exhausted authoritative balance cannot allocate or provision a replacement', async () => {
    const fixture = makeFixture();

    fixture.provider.fetchEsimUsage
      .mockResolvedValue({
        remainingMb: 0,
        expiresAt:
          '2026-11-01T00:00:00.000Z',
      });

    await expect(
      replaceEsimForDevice(args, {
        prismaClient:
          fixture.prismaClient,
        provider:
          fixture.provider,
        allocator:
          fixture.allocator,
      })
    ).rejects.toMatchObject({
      code:
        'ESIM_REPLACEMENT_EXHAUSTED',
    });

    expect(
      fixture.prismaClient.esimReplacement.create
    ).not.toHaveBeenCalled();

    expect(
      fixture.allocator
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.provisionEsimPack
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.setEsimPackageStatus
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.suspendLine
    ).not.toHaveBeenCalled();
  });

  test('usage failure consumes no new ICCID and leaves old service untouched', async () => {
    const fixture = makeFixture();

    fixture.provider.fetchEsimUsage.mockRejectedValue(
      Object.assign(
        new Error('Telna usage unavailable'),
        { code: 'TELNA_USAGE_FAILED' }
      )
    );

    await expect(
      replaceEsimForDevice(args, {
        prismaClient: fixture.prismaClient,
        provider: fixture.provider,
        allocator: fixture.allocator,
      })
    ).rejects.toMatchObject({
      code: 'TELNA_USAGE_FAILED',
    });

    expect(fixture.allocator).not.toHaveBeenCalled();
    expect(
      fixture.prismaClient.esimReplacement.create
    ).not.toHaveBeenCalled();
    expect(
      fixture.provider.provisionEsimPack
    ).not.toHaveBeenCalled();
    expect(
      fixture.provider.setEsimPackageStatus
    ).not.toHaveBeenCalled();
    expect(
      fixture.provider.suspendLine
    ).not.toHaveBeenCalled();
  });

  test('allocation failure leaves the old package and SIM untouched', async () => {
    const fixture = makeFixture();

    fixture.allocator.mockRejectedValue(
      Object.assign(
        new Error('No eSIM available'),
        { code: 'ESIM_NO_AVAILABLE_PROFILE' }
      )
    );

    await expect(
      replaceEsimForDevice(args, {
        prismaClient: fixture.prismaClient,
        provider: fixture.provider,
        allocator: fixture.allocator,
      })
    ).rejects.toMatchObject({
      code: 'ESIM_NO_AVAILABLE_PROFILE',
    });

    expect(
      fixture.provider.provisionEsimPack
    ).not.toHaveBeenCalled();
    expect(
      fixture.provider.setEsimPackageStatus
    ).not.toHaveBeenCalled();
    expect(
      fixture.provider.suspendLine
    ).not.toHaveBeenCalled();

    expect(
      fixture.prismaClient.esimReplacement.update
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'replacement-1' },
        data: expect.objectContaining({
          status: 'FAILED',
        }),
      })
    );
  });

  test('provisioning failure does not terminate or suspend old service', async () => {
    const fixture = makeFixture();

    fixture.provider.provisionEsimPack.mockRejectedValue(
      Object.assign(
        new Error('Provision failed'),
        { code: 'TELNA_PROVISION_FAILED' }
      )
    );

    await expect(
      replaceEsimForDevice(args, {
        prismaClient: fixture.prismaClient,
        provider: fixture.provider,
        allocator: fixture.allocator,
      })
    ).rejects.toMatchObject({
      code: 'TELNA_PROVISION_FAILED',
    });

    expect(
      fixture.provider.setEsimPackageStatus
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.suspendLine
    ).not.toHaveBeenCalled();

    expect(
      fixture.prismaClient.esimReplacement.update
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
        }),
      })
    );
  });

  test('Telna HTTP 400 provisioning rejection is a definite failure', async () => {
    const fixture = makeFixture();

    fixture.provider.provisionEsimPack.mockRejectedValue(
      Object.assign(
        new Error('Telna rejected package creation'),
        {
          code: 'TELNA_PROVISION_FAILED',
          status: 400,
          requestId: 'telna-request-400',
        }
      )
    );

    await expect(
      replaceEsimForDevice(args, {
        prismaClient: fixture.prismaClient,
        provider: fixture.provider,
        allocator: fixture.allocator,
      })
    ).rejects.toMatchObject({
      code: 'TELNA_PROVISION_FAILED',
      status: 400,
    });

    expect(
      fixture.provider.setEsimPackageStatus
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.suspendLine
    ).not.toHaveBeenCalled();

    expect(
      fixture.prismaClient.esimReplacement.update
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'replacement-1' },
        data: expect.objectContaining({
          status: 'FAILED',
        }),
      })
    );

    /*
     * Allocation must be durably attached to the audit before the
     * provider package POST is attempted. A definite provider rejection
     * can then retry this same Subscriber/ICCID without consuming
     * another inventory item.
     */
    expect(
      fixture.prismaClient.esimReplacement.update
    ).toHaveBeenCalledWith({
      where: {
        id: 'replacement-1',
      },
      data: expect.objectContaining({
        newSubscriberId:
          fixture.newSubscriber.id,
        newIccid:
          fixture.newSubscriber.iccid,
        newProviderProfileId:
          fixture.newSubscriber.providerProfileId,
        status: 'ALLOCATED',
      }),
    });

    const allocationAuditCall =
      fixture.prismaClient.esimReplacement.update.mock.calls
        .findIndex(
          ([call]) =>
            call?.data?.status ===
            'ALLOCATED'
        );

    const failedAuditCall =
      fixture.prismaClient.esimReplacement.update.mock.calls
        .findIndex(
          ([call]) =>
            call?.data?.status ===
            'FAILED'
        );

    expect(allocationAuditCall).toBeGreaterThanOrEqual(0);
    expect(failedAuditCall).toBeGreaterThan(
      allocationAuditCall
    );
  });

  test('Telna HTTP 500 during package creation requires reconciliation', async () => {
    const fixture = makeFixture();

    fixture.provider.provisionEsimPack.mockRejectedValue(
      Object.assign(
        new Error('Telna internal server error'),
        {
          code: 'TELNA_PROVISION_FAILED',
          status: 500,
          requestId: 'telna-request-500',
        }
      )
    );

    await expect(
      replaceEsimForDevice(args, {
        prismaClient: fixture.prismaClient,
        provider: fixture.provider,
        allocator: fixture.allocator,
      })
    ).rejects.toMatchObject({
      code: 'TELNA_PROVISION_FAILED',
      status: 500,
    });

    expect(
      fixture.provider.setEsimPackageStatus
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.suspendLine
    ).not.toHaveBeenCalled();

    expect(
      fixture.prismaClient.esimReplacement.update
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'replacement-1' },
        data: expect.objectContaining({
          status: 'REQUIRES_RECONCILIATION',
        }),
      })
    );
  });

  test('Telna timeout without an HTTP response requires reconciliation', async () => {
    const fixture = makeFixture();

    fixture.provider.provisionEsimPack.mockRejectedValue(
      Object.assign(
        new Error('Telna request timed out'),
        {
          code: 'TELNA_TIMEOUT',
          requestId: 'telna-request-timeout',
        }
      )
    );

    await expect(
      replaceEsimForDevice(args, {
        prismaClient: fixture.prismaClient,
        provider: fixture.provider,
        allocator: fixture.allocator,
      })
    ).rejects.toMatchObject({
      code: 'TELNA_TIMEOUT',
      requestId: 'telna-request-timeout',
    });

    expect(
      fixture.provider.setEsimPackageStatus
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.suspendLine
    ).not.toHaveBeenCalled();

    expect(
      fixture.prismaClient.esimReplacement.update
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'replacement-1' },
        data: expect.objectContaining({
          status: 'REQUIRES_RECONCILIATION',
        }),
      })
    );
  });

  test('missing Telna package id after package creation requires reconciliation', async () => {
    const fixture = makeFixture();

    fixture.provider.provisionEsimPack.mockRejectedValue(
      Object.assign(
        new Error(
          'Telna package creation did not return a package id'
        ),
        {
          code: 'TELNA_PACKAGE_ID_MISSING',
          requestId: 'telna-request-missing-id',
        }
      )
    );

    await expect(
      replaceEsimForDevice(args, {
        prismaClient: fixture.prismaClient,
        provider: fixture.provider,
        allocator: fixture.allocator,
      })
    ).rejects.toMatchObject({
      code: 'TELNA_PACKAGE_ID_MISSING',
    });

    expect(
      fixture.provider.setEsimPackageStatus
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.suspendLine
    ).not.toHaveBeenCalled();

    expect(
      fixture.prismaClient.esimReplacement.update
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'replacement-1' },
        data: expect.objectContaining({
          status: 'REQUIRES_RECONCILIATION',
        }),
      })
    );
  });

  test('termination failure preserves new service and requires reconciliation', async () => {
    const fixture = makeFixture();

    fixture.provider.setEsimPackageStatus.mockRejectedValue(
      Object.assign(
        new Error('Termination failed'),
        { code: 'TELNA_PACKAGE_UPDATE_FAILED' }
      )
    );

    await expect(
      replaceEsimForDevice(args, {
        prismaClient: fixture.prismaClient,
        provider: fixture.provider,
        allocator: fixture.allocator,
      })
    ).rejects.toMatchObject({
      code: 'TELNA_PACKAGE_UPDATE_FAILED',
    });

    expect(
      fixture.provider.provisionEsimPack
    ).toHaveBeenCalled();

    expect(
      fixture.provider.suspendLine
    ).not.toHaveBeenCalled();

    expect(
      fixture.prismaClient.esimReplacement.update
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REQUIRES_RECONCILIATION',
        }),
      })
    );

    expect(
      fixture.tx.mobileDataPackPurchase.update
    ).toHaveBeenCalledWith({
      where: { id: 50 },
      data: expect.objectContaining({
        iccid: 'NEW-ICCID',
        providerPurchaseId: 'NEW-PACKAGE',
      }),
    });
  });

  test('suspension failure requires reconciliation and does not discard new service', async () => {
    const fixture = makeFixture();

    fixture.provider.suspendLine.mockRejectedValue(
      Object.assign(
        new Error('Suspension failed'),
        { code: 'TELNA_SUSPEND_FAILED' }
      )
    );

    await expect(
      replaceEsimForDevice(args, {
        prismaClient: fixture.prismaClient,
        provider: fixture.provider,
        allocator: fixture.allocator,
      })
    ).rejects.toMatchObject({
      code: 'TELNA_SUSPEND_FAILED',
    });

    expect(
      fixture.provider.setEsimPackageStatus
    ).toHaveBeenCalledWith(
      'OLD-PACKAGE',
      'TERMINATED'
    );

    expect(
      fixture.prismaClient.esimReplacement.update
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REQUIRES_RECONCILIATION',
        }),
      })
    );

    expect(
      fixture.tx.mobileDataPackPurchase.update
    ).toHaveBeenCalledWith({
      where: { id: 50 },
      data: expect.objectContaining({
        iccid: 'NEW-ICCID',
        providerPurchaseId: 'NEW-PACKAGE',
      }),
    });
  });

  test('concurrent duplicate replacement returns the existing workflow without allocating again', async () => {
    const fixture = makeFixture();

    const existingReplacement = {
      id: 'replacement-winner',
      userId: 7,
      purchaseId: 50,
      oldProviderPurchaseId:
        'OLD-PACKAGE',
      status: 'PENDING',
      newSubscriber: null,
      oldSubscriber:
        fixture.oldSubscriber,
    };

    fixture.prismaClient.esimReplacement.create
      .mockRejectedValue(
        Object.assign(
          new Error(
            'Unique constraint failed'
          ),
          {
            code: 'P2002',
            meta: {
              target: [
                'oldProviderPurchaseId',
              ],
            },
          }
        )
      );

    fixture.prismaClient.esimReplacement.findUnique
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        existingReplacement
      );

    const result =
      await replaceEsimForDevice(args, {
        prismaClient:
          fixture.prismaClient,
        provider:
          fixture.provider,
        allocator:
          fixture.allocator,
      });

    expect(
      fixture.prismaClient.esimReplacement.findUnique
    ).toHaveBeenCalledWith({
      where: {
        oldProviderPurchaseId:
          'OLD-PACKAGE',
      },
      include: {
        newSubscriber: true,
        oldSubscriber: true,
      },
    });

    expect(result).toBe(
      existingReplacement
    );

    /*
     * This is the core anti-duplication guarantee:
     * the losing request stops at the database boundary.
     */
    expect(
      fixture.allocator
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.provisionEsimPack
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.setEsimPackageStatus
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.suspendLine
    ).not.toHaveBeenCalled();
  });

  test('Telna replacement never carries the old purchase QR into the new service', async () => {
    const fixture = makeFixture();

    /*
     * Telna package provisioning does not generate a QR SVG.
     * Installation credentials belong to the newly allocated
     * Subscriber instead.
     */
    fixture.provider.provisionEsimPack
      .mockResolvedValue({
        providerPurchaseId:
          'NEW-PACKAGE',
        iccid:
          'NEW-ICCID',
        expiresAt:
          fixture.purchase.expiresAt,
        qrCodeSvg:
          null,
      });

    await replaceEsimForDevice(
      {
        userId: 7,
        purchaseId: 50,
        idempotencyKey:
          'replacement-qr-request-1',
        now: new Date(
          '2026-10-13T00:00:00.000Z'
        ),
      },
      {
        prismaClient:
          fixture.prismaClient,
        provider:
          fixture.provider,
        allocator:
          fixture.allocator,
      }
    );

    expect(
      fixture.tx.mobileDataPackPurchase.update
    ).toHaveBeenCalledWith({
      where: {
        id: 50,
      },
      data: expect.objectContaining({
        iccid:
          'NEW-ICCID',
        esimProfileId:
          'NEW-PROFILE',
        providerPurchaseId:
          'NEW-PACKAGE',
        qrCodeSvg:
          null,
      }),
    });

    const purchaseUpdate =
      fixture.tx.mobileDataPackPurchase.update
        .mock.calls[0][0];

    expect(
      purchaseUpdate.data.qrCodeSvg
    ).not.toBe('<old-qr>');
  });

  test('same idempotency key returns the existing workflow before any purchase or provider work', async () => {
    const fixture = makeFixture();

    const existingReplacement = {
      ...fixture.replacement,
      id: 'existing-idempotent-replacement',
      purchaseId: 50,
      idempotencyKey:
        'replacement-request-1',
      status: 'COMPLETED',
      oldSubscriber:
        fixture.oldSubscriber,
      newSubscriber:
        fixture.newSubscriber,
    };

    fixture.prismaClient.esimReplacement.findUnique
      .mockReset()
      .mockResolvedValueOnce(
        existingReplacement
      );

    const result =
      await replaceEsimForDevice(args, {
        prismaClient:
          fixture.prismaClient,
        provider:
          fixture.provider,
        allocator:
          fixture.allocator,
      });

    expect(result).toBe(
      existingReplacement
    );

    expect(
      fixture.prismaClient.esimReplacement.findUnique
    ).toHaveBeenCalledWith({
      where: {
        userId_idempotencyKey: {
          userId: 7,
          idempotencyKey:
            'replacement-request-1',
        },
      },
      include: {
        newSubscriber: true,
        oldSubscriber: true,
      },
    });

    expect(
      fixture.prismaClient.mobileDataPackPurchase.findFirst
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.fetchEsimUsage
    ).not.toHaveBeenCalled();

    expect(
      fixture.prismaClient.esimReplacement.create
    ).not.toHaveBeenCalled();

    expect(
      fixture.allocator
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.provisionEsimPack
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.setEsimPackageStatus
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.suspendLine
    ).not.toHaveBeenCalled();
  });

  test('same idempotency key cannot be reused for another purchase', async () => {
    const fixture = makeFixture();

    fixture.prismaClient.esimReplacement.findUnique
      .mockReset()
      .mockResolvedValueOnce({
        ...fixture.replacement,
        purchaseId: 999,
        idempotencyKey:
          'replacement-request-1',
        oldSubscriber:
          fixture.oldSubscriber,
        newSubscriber:
          fixture.newSubscriber,
      });

    await expect(
      replaceEsimForDevice(args, {
        prismaClient:
          fixture.prismaClient,
        provider:
          fixture.provider,
        allocator:
          fixture.allocator,
      })
    ).rejects.toMatchObject({
      code:
        'ESIM_REPLACEMENT_IDEMPOTENCY_CONFLICT',
    });

    expect(
      fixture.prismaClient.mobileDataPackPurchase.findFirst
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.fetchEsimUsage
    ).not.toHaveBeenCalled();

    expect(
      fixture.allocator
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.provisionEsimPack
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.setEsimPackageStatus
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.suspendLine
    ).not.toHaveBeenCalled();
  });

  test('concurrent same-key P2002 race returns the winning workflow without allocating another ICCID', async () => {
    const fixture = makeFixture();

    const existingReplacement = {
      ...fixture.replacement,
      id: 'winning-idempotent-replacement',
      purchaseId: 50,
      idempotencyKey:
        'replacement-request-1',
      status: 'PENDING',
      oldSubscriber:
        fixture.oldSubscriber,
      newSubscriber: null,
    };

    fixture.prismaClient.esimReplacement.findUnique
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        existingReplacement
      );

    fixture.prismaClient.esimReplacement.create
      .mockRejectedValueOnce(
        Object.assign(
          new Error(
            'Unique constraint failed'
          ),
          {
            code: 'P2002',
            meta: {
              target: [
                'userId',
                'idempotencyKey',
              ],
            },
          }
        )
      );

    const result =
      await replaceEsimForDevice(args, {
        prismaClient:
          fixture.prismaClient,
        provider:
          fixture.provider,
        allocator:
          fixture.allocator,
      });

    expect(result).toBe(
      existingReplacement
    );

    expect(
      fixture.allocator
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.provisionEsimPack
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.setEsimPackageStatus
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.suspendLine
    ).not.toHaveBeenCalled();
  });

  test('checkpoints the known provider package before canonical persistence begins', async () => {
    const fixture = makeFixture();

    const events = [];

    fixture.prismaClient.esimReplacement.update
      .mockImplementation(async (call) => {
        if (
          call?.data?.newProviderPurchaseId ===
          'NEW-PACKAGE'
        ) {
          events.push('provider-checkpoint');
        }

        return {};
      });

    fixture.prismaClient.$transaction
      .mockImplementation(async (callback) => {
        events.push('canonical-transaction');
        return callback(fixture.tx);
      });

    await replaceEsimForDevice(args, {
      prismaClient: fixture.prismaClient,
      provider: fixture.provider,
      allocator: fixture.allocator,
    });

    expect(
      fixture.prismaClient.esimReplacement.update
    ).toHaveBeenCalledWith({
      where: {
        id: 'replacement-1',
      },
      data: expect.objectContaining({
        newSubscriberId: 101,
        newIccid: 'NEW-ICCID',
        newProviderProfileId:
          'NEW-PROFILE',
        newProviderPurchaseId:
          'NEW-PACKAGE',
      }),
    });

    expect(events).toContain(
      'provider-checkpoint'
    );
    expect(events).toContain(
      'canonical-transaction'
    );

    expect(
      events.indexOf('provider-checkpoint')
    ).toBeLessThan(
      events.indexOf('canonical-transaction')
    );
  });

  test('provider checkpoint failure best-effort preserves the known package id for reconciliation', async () => {
    const fixture = makeFixture();

    const checkpointError =
      Object.assign(
        new Error(
          'Provider checkpoint write failed'
        ),
        {
          code:
            'TEST_PROVIDER_CHECKPOINT_FAILED',
        }
      );

    /*
     * Standalone replacement writes occur in this order:
     *
     * 1. ALLOCATED checkpoint
     * 2. known provider-package checkpoint
     * 3. catch-path reconciliation checkpoint
     *
     * Fail only #2 after provisionEsimPack has returned NEW-PACKAGE.
     */
    fixture.prismaClient.esimReplacement.update
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(
        checkpointError
      )
      .mockResolvedValueOnce({});

    await expect(
      replaceEsimForDevice(args, {
        prismaClient:
          fixture.prismaClient,
        provider:
          fixture.provider,
        allocator:
          fixture.allocator,
      })
    ).rejects.toBe(
      checkpointError
    );

    expect(
      fixture.provider.provisionEsimPack
    ).toHaveBeenCalledTimes(1);

    /*
     * The catch path must make a best-effort attempt to preserve the
     * package identity that the provider already returned.
     */
    /*
     * Allocation identity was durably recorded before the provider call.
     */
    expect(
      fixture.prismaClient.esimReplacement.update
    ).toHaveBeenCalledWith({
      where: {
        id: 'replacement-1',
      },
      data: expect.objectContaining({
        status: 'ALLOCATED',
        newSubscriberId: 101,
        newIccid:
          'NEW-ICCID',
        newProviderProfileId:
          'NEW-PROFILE',
      }),
    });

    /*
     * After the dedicated provider checkpoint fails, the catch path
     * must make another best-effort attempt to preserve NEW-PACKAGE.
     */
    expect(
      fixture.prismaClient.esimReplacement.update
    ).toHaveBeenCalledWith({
      where: {
        id: 'replacement-1',
      },
      data: expect.objectContaining({
        status:
          'REQUIRES_RECONCILIATION',
        newIccid:
          'NEW-ICCID',
        newProviderPurchaseId:
          'NEW-PACKAGE',
        errorCode:
          'TEST_PROVIDER_CHECKPOINT_FAILED',
      }),
    });

    /*
     * Failure to checkpoint canonical provider state must never allow
     * destructive cleanup of the old service.
     */
    expect(
      fixture.provider.setEsimPackageStatus
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.suspendLine
    ).not.toHaveBeenCalled();

    /*
     * Canonical persistence was never reached.
     */
    expect(
      fixture.prismaClient.$transaction
    ).not.toHaveBeenCalled();
  });

  test('canonical persistence failure preserves known provider package and leaves old service untouched', async () => {
    const fixture = makeFixture();

    const canonicalError =
      Object.assign(
        new Error(
          'Canonical persistence failed'
        ),
        {
          code:
            'TEST_CANONICAL_PERSISTENCE_FAILED',
        }
      );

    /*
     * The first transaction is canonical persistence.
     * Fail it after Telna has returned NEW-PACKAGE and the standalone
     * provider checkpoint has already succeeded.
     */
    fixture.prismaClient.$transaction
      .mockRejectedValueOnce(
        canonicalError
      );

    await expect(
      replaceEsimForDevice(args, {
        prismaClient:
          fixture.prismaClient,
        provider:
          fixture.provider,
        allocator:
          fixture.allocator,
      })
    ).rejects.toBe(
      canonicalError
    );

    expect(
      fixture.provider.provisionEsimPack
    ).toHaveBeenCalledTimes(1);

    /*
     * The known external package must have been durably checkpointed
     * before the canonical transaction failed.
     */
    expect(
      fixture.prismaClient.esimReplacement.update
    ).toHaveBeenCalledWith({
      where: {
        id: 'replacement-1',
      },
      data: expect.objectContaining({
        newSubscriberId: 101,
        newIccid: 'NEW-ICCID',
        newProviderProfileId:
          'NEW-PROFILE',
        newProviderPurchaseId:
          'NEW-PACKAGE',
      }),
    });

    expect(
      fixture.prismaClient.esimReplacement.update
    ).toHaveBeenCalledWith({
      where: {
        id: 'replacement-1',
      },
      data: expect.objectContaining({
        status:
          'REQUIRES_RECONCILIATION',
        errorCode:
          'TEST_CANONICAL_PERSISTENCE_FAILED',
      }),
    });

    /*
     * The account may still point at OLD-PACKAGE because the canonical
     * transaction failed. Destructive cleanup is therefore forbidden.
     */
    expect(
      fixture.provider.setEsimPackageStatus
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.suspendLine
    ).not.toHaveBeenCalled();

    /*
     * provisionedAt belongs to successful canonical persistence.
     * The standalone provider checkpoint must not set it.
     */
    const checkpointCall =
      fixture.prismaClient.esimReplacement.update.mock.calls
        .find(
          ([call]) =>
            call?.data?.newProviderPurchaseId ===
            'NEW-PACKAGE'
        );

    expect(checkpointCall).toBeDefined();
    expect(
      checkpointCall[0].data.provisionedAt
    ).toBeUndefined();
  });

  test('full success switches canonical service only after new service exists', async () => {
    const fixture = makeFixture();

    const result =
      await replaceEsimForDevice(args, {
        prismaClient: fixture.prismaClient,
        provider: fixture.provider,
        allocator: fixture.allocator,
      });

    expect(
      fixture.provider.fetchEsimUsage
    ).toHaveBeenCalledWith(
      'OLD-PACKAGE'
    );

    expect(fixture.allocator).toHaveBeenCalledWith(
      expect.objectContaining({
        excludedIccids: ['OLD-ICCID'],
      }),
      expect.objectContaining({
        prismaClient: fixture.prismaClient,
        provider: fixture.provider,
      })
    );

    expect(
      fixture.provider.provisionEsimPack
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        iccid: 'NEW-ICCID',
        addonKind:
          'chatforia_esim_local_5_premium',
        planCode:
          'chatforia_esim_local_5_premium',
      })
    );

    expect(
      fixture.provider.setEsimPackageStatus
    ).toHaveBeenCalledWith(
      'OLD-PACKAGE',
      'TERMINATED'
    );

    expect(
      fixture.provider.suspendLine
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        iccid: 'OLD-ICCID',
      })
    );

    expect(
      fixture.tx.mobileDataPackPurchase.update
    ).toHaveBeenCalledWith({
      where: { id: 50 },
      data: expect.objectContaining({
        remainingDataMb: 4301,
        iccid: 'NEW-ICCID',
        esimProfileId: 'NEW-PROFILE',
        providerPurchaseId: 'NEW-PACKAGE',
        qrCodeSvg: '<new-qr>',
      }),
    });

    expect(
      fixture.tx.user.update
    ).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        iccid: 'NEW-ICCID',
      },
    });

    expect(
      fixture.tx.subscriber.update
    ).toHaveBeenCalledWith({
      where: { id: 100 },
      data: expect.objectContaining({
        status: 'SUSPENDED',
      }),
    });

    expect(
      fixture.tx.subscriber.update
    ).toHaveBeenCalledWith({
      where: { id: 101 },
      data: expect.objectContaining({
        status: 'PROVISIONING',
      }),
    });

    expect(
      fixture.tx.esimReplacement.update
    ).toHaveBeenCalledWith({
      where: {
        id: 'replacement-1',
      },
      data: expect.objectContaining({
        status: 'COMPLETED',
      }),
    });

    expect(result.status).toBe('COMPLETED');
  });

  test('refuses to reconcile an ambiguous package creation outcome', async () => {
    const fixture = makeFixture();

    const ambiguous = {
      ...fixture.replacement,
      status: 'REQUIRES_RECONCILIATION',
      newProviderPurchaseId: null,
      oldProviderPurchaseId: 'OLD-PACKAGE',
      oldPackageTerminatedAt: null,
      oldSubscriber: fixture.oldSubscriber,
      newSubscriber: null,
      purchase: fixture.purchase,
    };

    fixture.prismaClient.esimReplacement.findUnique
      .mockReset()
      .mockResolvedValueOnce(ambiguous);

    await expect(
      reconcileEsimReplacement(
        ambiguous.id,
        {
          prismaClient:
            fixture.prismaClient,
          provider:
            fixture.provider,
        }
      )
    ).rejects.toMatchObject({
      code:
        'ESIM_REPLACEMENT_PROVIDER_OUTCOME_UNKNOWN',
    });

    expect(
      fixture.provider.provisionEsimPack
    ).not.toHaveBeenCalled();

    expect(
      fixture.allocator
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.setEsimPackageStatus
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.suspendLine
    ).not.toHaveBeenCalled();
  });

  test('canonical recovery failure leaves old service untouched and remains reconcilable', async () => {
    const fixture = makeFixture();

    const reconciling = {
      ...fixture.replacement,
      status: 'REQUIRES_RECONCILIATION',
      userId: 7,
      purchaseId: 50,
      newProviderPurchaseId:
        'NEW-PACKAGE',
      provisionedAt: null,
      newSubscriberId:
        fixture.newSubscriber.id,
      newIccid:
        fixture.newSubscriber.iccid,
      newProviderProfileId:
        fixture.newSubscriber.providerProfileId,
      oldProviderPurchaseId:
        'OLD-PACKAGE',
      oldProviderProfileId:
        'OLD-PROFILE',
      oldIccid:
        'OLD-ICCID',
      oldPackageTerminatedAt: null,
      remainingDataMb: 4301,
      originalExpiresAt:
        fixture.purchase.expiresAt,
      oldSubscriber:
        fixture.oldSubscriber,
      newSubscriber:
        fixture.newSubscriber,
      purchase:
        fixture.purchase,
    };

    const recoveryError =
      Object.assign(
        new Error(
          'Canonical recovery transaction failed'
        ),
        {
          code:
            'TEST_CANONICAL_RECOVERY_FAILED',
        }
      );

    fixture.prismaClient.esimReplacement.findUnique
      .mockReset()
      .mockResolvedValueOnce(reconciling);

    fixture.prismaClient.$transaction
      .mockRejectedValueOnce(
        recoveryError
      );

    await expect(
      reconcileEsimReplacement(
        reconciling.id,
        {
          prismaClient:
            fixture.prismaClient,
          provider:
            fixture.provider,
        }
      )
    ).rejects.toBe(
      recoveryError
    );

    /*
     * Recovery never creates another provider package.
     */
    expect(
      fixture.provider.provisionEsimPack
    ).not.toHaveBeenCalled();

    /*
     * Canonical recovery did not commit, so destructive cleanup
     * remains forbidden.
     */
    expect(
      fixture.provider.setEsimPackageStatus
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.suspendLine
    ).not.toHaveBeenCalled();

    /*
     * The workflow must remain explicitly reconcilable.
     */
    expect(
      fixture.prismaClient.esimReplacement.update
    ).toHaveBeenCalledWith({
      where: {
        id: reconciling.id,
      },
      data: expect.objectContaining({
        status:
          'REQUIRES_RECONCILIATION',
        errorCode:
          'TEST_CANONICAL_RECOVERY_FAILED',
        errorMessage:
          'Canonical recovery transaction failed',
      }),
    });
  });

  test('reconciles a known provider package by restoring canonical persistence before old-service cleanup', async () => {
    const fixture = makeFixture();

    const reconciling = {
      ...fixture.replacement,
      status: 'REQUIRES_RECONCILIATION',
      userId: 7,
      purchaseId: 50,
      newProviderPurchaseId:
        'NEW-PACKAGE',
      provisionedAt: null,
      newSubscriberId:
        fixture.newSubscriber.id,
      newIccid:
        fixture.newSubscriber.iccid,
      newProviderProfileId:
        fixture.newSubscriber.providerProfileId,
      oldProviderPurchaseId:
        'OLD-PACKAGE',
      oldProviderProfileId:
        'OLD-PROFILE',
      oldIccid:
        'OLD-ICCID',
      oldPackageTerminatedAt: null,
      remainingDataMb: 4301,
      originalExpiresAt:
        fixture.purchase.expiresAt,
      oldSubscriber:
        fixture.oldSubscriber,
      newSubscriber:
        fixture.newSubscriber,
      purchase:
        fixture.purchase,
    };

    const completed = {
      ...reconciling,
      status: 'COMPLETED',
      provisionedAt:
        new Date(
          '2026-10-13T19:00:00.000Z'
        ),
    };

    fixture.prismaClient.esimReplacement.findUnique
      .mockReset()
      .mockResolvedValueOnce(reconciling)
      .mockResolvedValueOnce(completed);

    const events = [];

    fixture.prismaClient.$transaction
      .mockImplementation(async (callback) => {
        events.push('transaction');
        return callback(fixture.tx);
      });

    fixture.provider.setEsimPackageStatus
      .mockImplementation(async () => {
        events.push('terminate-old-package');
        return {
          providerPurchaseId:
            'OLD-PACKAGE',
          status: 'TERMINATED',
        };
      });

    const result =
      await reconcileEsimReplacement(
        reconciling.id,
        {
          prismaClient:
            fixture.prismaClient,
          provider:
            fixture.provider,
        }
      );

    /*
     * Recovery MUST NOT create another provider package.
     */
    expect(
      fixture.provider.provisionEsimPack
    ).not.toHaveBeenCalled();

    /*
     * The first transaction must restore canonical Chatforia state.
     */
    expect(
      fixture.tx.mobileDataPackPurchase.update
    ).toHaveBeenCalledWith({
      where: {
        id: 50,
      },
      data: expect.objectContaining({
        remainingDataMb: 4301,
        expiresAt:
          fixture.purchase.expiresAt,
        iccid: 'NEW-ICCID',
        esimProfileId:
          'NEW-PROFILE',
        providerPurchaseId:
          'NEW-PACKAGE',
      }),
    });

    expect(
      fixture.tx.user.update
    ).toHaveBeenCalledWith({
      where: {
        id: 7,
      },
      data: {
        iccid: 'NEW-ICCID',
      },
    });

    expect(
      fixture.tx.esimReplacement.update
    ).toHaveBeenCalledWith({
      where: {
        id: reconciling.id,
      },
      data: expect.objectContaining({
        status: 'PROVISIONED',
        provisionedAt:
          expect.any(Date),
      }),
    });

    /*
     * Canonical persistence must happen before destructive cleanup.
     */
    expect(events[0]).toBe(
      'transaction'
    );

    expect(
      events.indexOf('transaction')
    ).toBeLessThan(
      events.indexOf(
        'terminate-old-package'
      )
    );

    expect(
      fixture.provider.setEsimPackageStatus
    ).toHaveBeenCalledWith(
      'OLD-PACKAGE',
      'TERMINATED'
    );

    expect(
      fixture.provider.suspendLine
    ).toHaveBeenCalledTimes(1);

    expect(result.status).toBe(
      'COMPLETED'
    );
  });

  test('reconciles known replacement package by completing old-service cleanup only', async () => {
    const fixture = makeFixture();

    const reconciling = {
      ...fixture.replacement,
      status: 'REQUIRES_RECONCILIATION',
      newProviderPurchaseId: 'NEW-PACKAGE',
      provisionedAt:
        new Date('2026-10-13T17:00:00Z'),
      oldProviderPurchaseId: 'OLD-PACKAGE',
      oldProviderProfileId: 'OLD-PROFILE',
      oldIccid: 'OLD-ICCID',
      oldPackageTerminatedAt: null,
      oldSubscriber: fixture.oldSubscriber,
      newSubscriber: fixture.newSubscriber,
      purchase: fixture.purchase,
    };

    const completed = {
      ...reconciling,
      status: 'COMPLETED',
    };

    fixture.prismaClient.esimReplacement.findUnique
      .mockReset()
      .mockResolvedValueOnce(reconciling)
      .mockResolvedValueOnce(completed);

    const result =
      await reconcileEsimReplacement(
        reconciling.id,
        {
          prismaClient:
            fixture.prismaClient,
          provider:
            fixture.provider,
        }
      );

    expect(
      fixture.provider.provisionEsimPack
    ).not.toHaveBeenCalled();

    expect(
      fixture.allocator
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.setEsimPackageStatus
    ).toHaveBeenCalledTimes(1);

    expect(
      fixture.provider.setEsimPackageStatus
    ).toHaveBeenCalledWith(
      'OLD-PACKAGE',
      'TERMINATED'
    );

    expect(
      fixture.provider.suspendLine
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        providerProfileId:
          'OLD-PROFILE',
        iccid:
          'OLD-ICCID',
      })
    );

    expect(
      fixture.tx.subscriber.update
    ).toHaveBeenCalledWith({
      where: {
        id: fixture.oldSubscriber.id,
      },
      data: expect.objectContaining({
        status: 'SUSPENDED',
      }),
    });

    expect(
      fixture.tx.esimReplacement.update
    ).toHaveBeenCalledWith({
      where: {
        id: reconciling.id,
      },
      data: expect.objectContaining({
        status: 'COMPLETED',
        errorCode: null,
        errorMessage: null,
      }),
    });

    expect(result.status).toBe('COMPLETED');
  });

  test('does not terminate the old package again when termination was already recorded', async () => {
    const fixture = makeFixture();

    const reconciling = {
      ...fixture.replacement,
      status: 'REQUIRES_RECONCILIATION',
      newProviderPurchaseId: 'NEW-PACKAGE',
      provisionedAt:
        new Date('2026-10-13T17:00:00Z'),
      oldProviderPurchaseId: 'OLD-PACKAGE',
      oldProviderProfileId: 'OLD-PROFILE',
      oldIccid: 'OLD-ICCID',
      oldPackageTerminatedAt:
        new Date('2026-10-13T18:00:00Z'),
      oldSubscriber: fixture.oldSubscriber,
      newSubscriber: fixture.newSubscriber,
      purchase: fixture.purchase,
    };

    const completed = {
      ...reconciling,
      status: 'COMPLETED',
    };

    fixture.prismaClient.esimReplacement.findUnique
      .mockReset()
      .mockResolvedValueOnce(reconciling)
      .mockResolvedValueOnce(completed);

    await reconcileEsimReplacement(
      reconciling.id,
      {
        prismaClient:
          fixture.prismaClient,
        provider:
          fixture.provider,
      }
    );

    expect(
      fixture.provider.setEsimPackageStatus
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.suspendLine
    ).toHaveBeenCalledTimes(1);

    expect(
      fixture.provider.provisionEsimPack
    ).not.toHaveBeenCalled();

    expect(
      fixture.allocator
    ).not.toHaveBeenCalled();
  });

  test('completed reconciliation is idempotent and performs no provider actions', async () => {
    const fixture = makeFixture();

    const completed = {
      ...fixture.replacement,
      status: 'COMPLETED',
      newProviderPurchaseId: 'NEW-PACKAGE',
      oldProviderPurchaseId: 'OLD-PACKAGE',
      oldPackageTerminatedAt:
        new Date('2026-10-13T18:00:00Z'),
      oldSubscriber: fixture.oldSubscriber,
      newSubscriber: fixture.newSubscriber,
      purchase: fixture.purchase,
    };

    fixture.prismaClient.esimReplacement.findUnique
      .mockReset()
      .mockResolvedValueOnce(completed);

    const result =
      await reconcileEsimReplacement(
        completed.id,
        {
          prismaClient:
            fixture.prismaClient,
          provider:
            fixture.provider,
        }
      );

    expect(result).toBe(completed);

    expect(
      fixture.provider.setEsimPackageStatus
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.suspendLine
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.provisionEsimPack
    ).not.toHaveBeenCalled();

    expect(
      fixture.allocator
    ).not.toHaveBeenCalled();
  });


  test('records another termination failure as requiring reconciliation', async () => {
    const fixture = makeFixture();

    const reconciling = {
      ...fixture.replacement,
      status: 'REQUIRES_RECONCILIATION',
      newProviderPurchaseId: 'NEW-PACKAGE',
      provisionedAt:
        new Date('2026-10-13T17:00:00Z'),
      oldProviderPurchaseId: 'OLD-PACKAGE',
      oldPackageTerminatedAt: null,
      oldSubscriber: fixture.oldSubscriber,
      newSubscriber: fixture.newSubscriber,
      purchase: fixture.purchase,
    };

    const failure = Object.assign(
      new Error('termination failed again'),
      {
        code: 'TELNA_TERMINATION_FAILED',
      }
    );

    fixture.prismaClient.esimReplacement.findUnique
      .mockReset()
      .mockResolvedValueOnce(reconciling);

    fixture.provider.setEsimPackageStatus
      .mockRejectedValueOnce(failure);

    await expect(
      reconcileEsimReplacement(
        reconciling.id,
        {
          prismaClient:
            fixture.prismaClient,
          provider:
            fixture.provider,
        }
      )
    ).rejects.toBe(failure);

    expect(
      fixture.prismaClient.esimReplacement.update
    ).toHaveBeenCalledWith({
      where: {
        id: reconciling.id,
      },
      data: expect.objectContaining({
        status:
          'REQUIRES_RECONCILIATION',
        errorCode:
          'TELNA_TERMINATION_FAILED',
        errorMessage:
          'termination failed again',
      }),
    });

    expect(
      fixture.provider.suspendLine
    ).not.toHaveBeenCalled();

    expect(
      fixture.provider.provisionEsimPack
    ).not.toHaveBeenCalled();

    expect(
      fixture.allocator
    ).not.toHaveBeenCalled();
  });

  test('records another suspension failure without terminating the old package again', async () => {
    const fixture = makeFixture();

    const reconciling = {
      ...fixture.replacement,
      status: 'REQUIRES_RECONCILIATION',
      newProviderPurchaseId: 'NEW-PACKAGE',
      provisionedAt:
        new Date('2026-10-13T17:00:00Z'),
      oldProviderPurchaseId: 'OLD-PACKAGE',
      oldPackageTerminatedAt:
        new Date('2026-10-13T18:00:00Z'),
      oldSubscriber: fixture.oldSubscriber,
      newSubscriber: fixture.newSubscriber,
      purchase: fixture.purchase,
    };

    const failure = Object.assign(
      new Error('suspension failed again'),
      {
        code: 'TELNA_SUSPENSION_FAILED',
      }
    );

    fixture.prismaClient.esimReplacement.findUnique
      .mockReset()
      .mockResolvedValueOnce(reconciling);

    fixture.provider.suspendLine
      .mockRejectedValueOnce(failure);

    await expect(
      reconcileEsimReplacement(
        reconciling.id,
        {
          prismaClient:
            fixture.prismaClient,
          provider:
            fixture.provider,
        }
      )
    ).rejects.toBe(failure);

    expect(
      fixture.provider.setEsimPackageStatus
    ).not.toHaveBeenCalled();

    expect(
      fixture.prismaClient.esimReplacement.update
    ).toHaveBeenCalledWith({
      where: {
        id: reconciling.id,
      },
      data: expect.objectContaining({
        status:
          'REQUIRES_RECONCILIATION',
        errorCode:
          'TELNA_SUSPENSION_FAILED',
        errorMessage:
          'suspension failed again',
      }),
    });

    expect(
      fixture.provider.provisionEsimPack
    ).not.toHaveBeenCalled();

    expect(
      fixture.allocator
    ).not.toHaveBeenCalled();
  });

});
