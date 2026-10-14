import { jest } from '@jest/globals';
import {
  PrismaClient,
} from '@prisma/client';

import {
  replaceEsimForDevice,
  reconcileEsimReplacement,
} from '../esimReplacementService.js';

const EXPECTED_DATABASE =
  'chatforia_wireless_test_20261013';

const TEST_PREFIX =
  'ZERO-TELNA-INTEGRATION';

let prisma;

/*
 * Absolutely no production database and absolutely no real Telna
 * provider are permitted in this integration test.
 */
function assertSafeDatabaseUrl() {
  const raw =
    process.env.TEST_DATABASE_URL;

  if (!raw) {
    throw new Error(
      'TEST_DATABASE_URL is required'
    );
  }

  const url = new URL(raw);
  const database =
    url.pathname.replace(/^\/+/, '');

  if (database !== EXPECTED_DATABASE) {
    throw new Error(
      `SAFETY ABORT: expected ${EXPECTED_DATABASE}, got ${database}`
    );
  }

  if (database === 'defaultdb') {
    throw new Error(
      'SAFETY ABORT: production database selected'
    );
  }

  process.env.DATABASE_URL = raw;
}

async function cleanupSyntheticRows() {
  /*
   * Delete children before parents because EsimReplacement has
   * RESTRICT foreign keys to purchases/subscribers.
   */
  const users =
    await prisma.user.findMany({
      where: {
        username: {
          startsWith:
            TEST_PREFIX,
        },
      },
      select: {
        id: true,
      },
    });

  const userIds =
    users.map((user) => user.id);

  if (!userIds.length) {
    return;
  }

  await prisma.esimReplacement.deleteMany({
    where: {
      userId: {
        in: userIds,
      },
    },
  });

  await prisma.subscriber.deleteMany({
    where: {
      userId: {
        in: userIds,
      },
    },
  });

  await prisma.mobileDataPackPurchase.deleteMany({
    where: {
      userId: {
        in: userIds,
      },
    },
  });

  await prisma.user.deleteMany({
    where: {
      id: {
        in: userIds,
      },
    },
  });
}

describe(
  'eSIM replacement PostgreSQL integration — ZERO TELNA',
  () => {
    beforeAll(async () => {
      assertSafeDatabaseUrl();

      prisma = new PrismaClient({
        datasources: {
          db: {
            url:
              process.env.TEST_DATABASE_URL,
          },
        },
      });

      const identity =
        await prisma.$queryRawUnsafe(`
          SELECT
            current_database()
              AS database_name
        `);

      expect(
        identity[0]?.database_name
      ).toBe(EXPECTED_DATABASE);

      await cleanupSyntheticRows();
    });

    afterAll(async () => {
      if (prisma) {
        await cleanupSyntheticRows();
        await prisma.$disconnect();
      }
    });

    test(
      'real PostgreSQL replacement completes without contacting Telna',
      async () => {
        const suffix =
          `${Date.now()}-${Math.random()
            .toString(16)
            .slice(2)}`;

        const oldIccid =
          `${TEST_PREFIX}-OLD-${suffix}`;

        const newIccid =
          `${TEST_PREFIX}-NEW-${suffix}`;

        const oldProfile =
          `${TEST_PREFIX}-OLD-PROFILE-${suffix}`;

        const newProfile =
          `${TEST_PREFIX}-NEW-PROFILE-${suffix}`;

        const oldPackage =
          `${TEST_PREFIX}-OLD-PACKAGE-${suffix}`;

        const newPackage =
          `${TEST_PREFIX}-NEW-PACKAGE-${suffix}`;

        const expiry =
          new Date(
            '2026-11-13T16:00:00.000Z'
          );

        const now =
          new Date(
            '2026-10-13T16:00:00.000Z'
          );

        /*
         * Minimal real database fixtures.
         */
        const user =
          await prisma.user.create({
            data: {
              username:
                `${TEST_PREFIX}-${suffix}`,
              passwordHash:
                'integration-test-not-a-real-password',
              isTestAccount: true,
              iccid: oldIccid,
            },
          });

        const purchase =
          await prisma.mobileDataPackPurchase.create({
            data: {
              userId: user.id,
              kind: 'LOCAL',
              addonKind:
                'chatforia_esim_local_5_premium',
              totalDataMb:
                5 * 1024,
              remainingDataMb:
                4301,
              expiresAt: expiry,
              iccid: oldIccid,
              esimProfileId:
                oldProfile,
              providerPurchaseId:
                oldPackage,
            },
          });

        const oldSubscriber =
          await prisma.subscriber.create({
            data: {
              userId: user.id,
              purchaseId:
                purchase.id,
              provider: 'TELNA',
              providerProfileId:
                oldProfile,
              iccid: oldIccid,
              status: 'ACTIVE',
              activatedAt:
                new Date(
                  '2026-10-01T16:00:00.000Z'
                ),
              expiresAt: expiry,
            },
          });

        /*
         * FAKE PROVIDER.
         *
         * This object has no HTTP implementation and no Telna
         * credentials. Every provider-side action is local memory.
         */
        const providerCalls = [];

        const fakeProvider = {
          fetchEsimUsage:
            jest.fn(
              async (
                providerPurchaseId
              ) => {
                providerCalls.push({
                  action:
                    'fetchEsimUsage',
                  providerPurchaseId,
                });

                expect(
                  providerPurchaseId
                ).toBe(oldPackage);

                return {
                  remainingMb: 4301,
                  expiresAt: expiry,
                };
              }
            ),

          provisionEsimPack:
            jest.fn(
              async (input) => {
                providerCalls.push({
                  action:
                    'provisionEsimPack',
                  input,
                });

                expect(
                  input.iccid
                ).toBe(newIccid);

                expect(
                  input.providerProfileId
                ).toBe(newProfile);

                return {
                  providerPurchaseId:
                    newPackage,
                  iccid: newIccid,
                  expiresAt: expiry,
                  qrCodeSvg:
                    '<svg>ZERO-TELNA-TEST</svg>',
                };
              }
            ),

          setEsimPackageStatus:
            jest.fn(
              async (
                providerPurchaseId,
                status
              ) => {
                providerCalls.push({
                  action:
                    'setEsimPackageStatus',
                  providerPurchaseId,
                  status,
                });

                expect(
                  providerPurchaseId
                ).toBe(oldPackage);

                expect(status).toBe(
                  'TERMINATED'
                );

                return {
                  ok: true,
                };
              }
            ),

          suspendLine:
            jest.fn(
              async (input) => {
                providerCalls.push({
                  action:
                    'suspendLine',
                  input,
                });

                return {
                  ok: true,
                };
              }
            ),
        };

        /*
         * FAKE ALLOCATOR.
         *
         * It writes a synthetic Subscriber directly to the real
         * test database. It never calls reserveEsimProfile().
         */
        const fakeAllocator =
          jest.fn(
            async (
              input,
              dependencies
            ) => {
              expect(
                input.excludedIccids
              ).toContain(oldIccid);

              expect(
                dependencies.prismaClient
              ).toBe(prisma);

              expect(
                dependencies.provider
              ).toBe(fakeProvider);

              const subscriber =
                await prisma.subscriber.create({
                  data: {
                    userId: user.id,
                    purchaseId:
                      purchase.id,
                    provider:
                      'TELNA-FAKE',
                    providerProfileId:
                      newProfile,
                    iccid:
                      newIccid,
                    smdp:
                      'fake.smdp.example',
                    activationCode:
                      'ZERO-TELNA-ACTIVATION',
                    lpaUri:
                      'LPA:1$fake.smdp.example$ZERO-TELNA',
                    qrPayload:
                      'LPA:1$fake.smdp.example$ZERO-TELNA',
                    status:
                      'PENDING',
                    expiresAt:
                      expiry,
                  },
                });

              return {
                subscriber,
                providerProfile: {
                  providerProfileId:
                    newProfile,
                  iccid:
                    newIccid,
                  smdp:
                    'fake.smdp.example',
                  activationCode:
                    'ZERO-TELNA-ACTIVATION',
                  lpaUri:
                    'LPA:1$fake.smdp.example$ZERO-TELNA',
                  qrPayload:
                    'LPA:1$fake.smdp.example$ZERO-TELNA',
                },
              };
            }
          );

        /*
         * REAL replacement service.
         *
         * Only its external Telna boundaries are replaced.
         */
        const result =
          await replaceEsimForDevice(
            {
              userId:
                user.id,
              purchaseId:
                purchase.id,
              idempotencyKey:
                `${TEST_PREFIX}-KEY-${suffix}`,
              reason:
                'ZERO_TELNA_INTEGRATION_TEST',
              now,
            },
            {
              prismaClient:
                prisma,
              provider:
                fakeProvider,
              allocator:
                fakeAllocator,
            }
          );

        expect(result.status).toBe(
          'COMPLETED'
        );

        /*
         * Read the actual persisted PostgreSQL state.
         */
        const [
          persistedUser,
          persistedPurchase,
          persistedOldSubscriber,
          persistedNewSubscriber,
          replacement,
        ] = await Promise.all([
          prisma.user.findUnique({
            where: {
              id: user.id,
            },
          }),

          prisma.mobileDataPackPurchase.findUnique({
            where: {
              id: purchase.id,
            },
          }),

          prisma.subscriber.findUnique({
            where: {
              id:
                oldSubscriber.id,
            },
          }),

          prisma.subscriber.findUnique({
            where: {
              iccid:
                newIccid,
            },
          }),

          prisma.esimReplacement.findFirst({
            where: {
              userId:
                user.id,
              purchaseId:
                purchase.id,
            },
          }),
        ]);

        /*
         * Canonical account/purchase moved to the new eSIM.
         */
        expect(
          persistedUser.iccid
        ).toBe(newIccid);

        expect(
          persistedPurchase.iccid
        ).toBe(newIccid);

        expect(
          persistedPurchase.esimProfileId
        ).toBe(newProfile);

        expect(
          persistedPurchase.providerPurchaseId
        ).toBe(newPackage);

        expect(
          persistedPurchase.remainingDataMb
        ).toBe(4301);

        /*
         * New service exists; activation itself remains a separate
         * provider-confirmed lifecycle event.
         */
        expect(
          persistedNewSubscriber
        ).not.toBeNull();

        expect(
          persistedNewSubscriber.status
        ).toBe('PROVISIONING');

        /*
         * Old service was cleaned up only after canonical persistence.
         */
        expect(
          persistedOldSubscriber.status
        ).toBe('SUSPENDED');

        expect(
          persistedOldSubscriber.suspendedAt
        ).not.toBeNull();

        /*
         * Permanent replacement audit completed.
         */
        expect(replacement).toMatchObject({
          userId:
            user.id,
          purchaseId:
            purchase.id,
          oldSubscriberId:
            oldSubscriber.id,
          newSubscriberId:
            persistedNewSubscriber.id,
          oldIccid,
          newIccid,
          oldProviderPurchaseId:
            oldPackage,
          newProviderPurchaseId:
            newPackage,
          remainingDataMb:
            4301,
          replacementDataMb:
            5 * 1024,
          replacementAddonKind:
            'chatforia_esim_local_5_premium',
          status:
            'COMPLETED',
        });

        expect(
          replacement.provisionedAt
        ).not.toBeNull();

        expect(
          replacement.oldPackageTerminatedAt
        ).not.toBeNull();

        expect(
          replacement.completedAt
        ).not.toBeNull();

        /*
         * Exactly one fake allocation and exactly one fake package
         * creation occurred.
         */
        expect(
          fakeAllocator
        ).toHaveBeenCalledTimes(1);

        expect(
          fakeProvider.fetchEsimUsage
        ).toHaveBeenCalledTimes(1);

        expect(
          fakeProvider.provisionEsimPack
        ).toHaveBeenCalledTimes(1);

        expect(
          fakeProvider.setEsimPackageStatus
        ).toHaveBeenCalledTimes(1);

        expect(
          fakeProvider.suspendLine
        ).toHaveBeenCalledTimes(1);

        expect(
          providerCalls.map(
            (entry) =>
              entry.action
          )
        ).toEqual([
          'fetchEsimUsage',
          'provisionEsimPack',
          'setEsimPackageStatus',
          'suspendLine',
        ]);

        console.log(
          '\nZERO-TELNA INTEGRATION RESULT'
        );

        console.table([
          {
            database:
              EXPECTED_DATABASE,
            replacementStatus:
              replacement.status,
            oldSubscriberStatus:
              persistedOldSubscriber.status,
            newSubscriberStatus:
              persistedNewSubscriber.status,
            remainingDataMb:
              persistedPurchase.remainingDataMb,
            realTelnaCalls: 0,
          },
        ]);
      }
    );


    test(
      'known fake provider package survives canonical failure and reconciles without reprovisioning',
      async () => {
        const suffix =
          `${Date.now()}-${Math.random()
            .toString(16)
            .slice(2)}`;

        const oldIccid =
          `${TEST_PREFIX}-RECOVERY-OLD-${suffix}`;

        const newIccid =
          `${TEST_PREFIX}-RECOVERY-NEW-${suffix}`;

        const oldProfile =
          `${TEST_PREFIX}-RECOVERY-OLD-PROFILE-${suffix}`;

        const newProfile =
          `${TEST_PREFIX}-RECOVERY-NEW-PROFILE-${suffix}`;

        const oldPackage =
          `${TEST_PREFIX}-RECOVERY-OLD-PACKAGE-${suffix}`;

        const newPackage =
          `${TEST_PREFIX}-RECOVERY-NEW-PACKAGE-${suffix}`;

        const expiry =
          new Date(
            '2026-11-13T16:00:00.000Z'
          );

        const now =
          new Date(
            '2026-10-13T16:00:00.000Z'
          );

        const user =
          await prisma.user.create({
            data: {
              username:
                `${TEST_PREFIX}-RECOVERY-${suffix}`,
              passwordHash:
                'integration-test-not-a-real-password',
              isTestAccount: true,
              iccid: oldIccid,
            },
          });

        const purchase =
          await prisma.mobileDataPackPurchase.create({
            data: {
              userId: user.id,
              kind: 'LOCAL',
              addonKind:
                'chatforia_esim_local_5_premium',
              totalDataMb:
                5 * 1024,
              remainingDataMb: 4301,
              expiresAt: expiry,
              iccid: oldIccid,
              esimProfileId:
                oldProfile,
              providerPurchaseId:
                oldPackage,
            },
          });

        const oldSubscriber =
          await prisma.subscriber.create({
            data: {
              userId: user.id,
              purchaseId:
                purchase.id,
              provider: 'TELNA',
              providerProfileId:
                oldProfile,
              iccid: oldIccid,
              status: 'ACTIVE',
              activatedAt:
                new Date(
                  '2026-10-01T16:00:00.000Z'
                ),
              expiresAt: expiry,
            },
          });

        /*
         * ZERO-TELNA fake provider.
         *
         * provisionEsimPack returns one synthetic package ID.
         * Reconciliation must NEVER call it a second time.
         */
        const providerCalls = [];

        const fakeProvider = {
          fetchEsimUsage:
            jest.fn(
              async (
                providerPurchaseId
              ) => {
                providerCalls.push({
                  action:
                    'fetchEsimUsage',
                  providerPurchaseId,
                });

                expect(
                  providerPurchaseId
                ).toBe(oldPackage);

                return {
                  remainingMb: 4301,
                  expiresAt: expiry,
                };
              }
            ),

          provisionEsimPack:
            jest.fn(
              async (input) => {
                providerCalls.push({
                  action:
                    'provisionEsimPack',
                  input,
                });

                expect(
                  input.iccid
                ).toBe(newIccid);

                expect(
                  input.providerProfileId
                ).toBe(newProfile);

                return {
                  providerPurchaseId:
                    newPackage,
                  iccid: newIccid,
                  expiresAt: expiry,
                  qrCodeSvg:
                    '<svg>ZERO-TELNA-RECOVERY</svg>',
                };
              }
            ),

          setEsimPackageStatus:
            jest.fn(
              async (
                providerPurchaseId,
                status
              ) => {
                providerCalls.push({
                  action:
                    'setEsimPackageStatus',
                  providerPurchaseId,
                  status,
                });

                expect(
                  providerPurchaseId
                ).toBe(oldPackage);

                expect(status).toBe(
                  'TERMINATED'
                );

                return {
                  ok: true,
                };
              }
            ),

          suspendLine:
            jest.fn(
              async (input) => {
                providerCalls.push({
                  action:
                    'suspendLine',
                  input,
                });

                return {
                  ok: true,
                };
              }
            ),
        };

        const fakeAllocator =
          jest.fn(
            async (
              input,
              dependencies
            ) => {
              expect(
                input.excludedIccids
              ).toContain(oldIccid);

              expect(
                dependencies.provider
              ).toBe(fakeProvider);

              const subscriber =
                await prisma.subscriber.create({
                  data: {
                    userId: user.id,
                    purchaseId:
                      purchase.id,
                    provider:
                      'TELNA-FAKE',
                    providerProfileId:
                      newProfile,
                    iccid:
                      newIccid,
                    smdp:
                      'fake.smdp.example',
                    activationCode:
                      'ZERO-TELNA-RECOVERY-ACTIVATION',
                    lpaUri:
                      'LPA:1$fake.smdp.example$ZERO-TELNA-RECOVERY',
                    qrPayload:
                      'LPA:1$fake.smdp.example$ZERO-TELNA-RECOVERY',
                    status:
                      'PENDING',
                    expiresAt:
                      expiry,
                  },
                });

              return {
                subscriber,
                providerProfile: {
                  providerProfileId:
                    newProfile,
                  iccid:
                    newIccid,
                  smdp:
                    'fake.smdp.example',
                  activationCode:
                    'ZERO-TELNA-RECOVERY-ACTIVATION',
                  lpaUri:
                    'LPA:1$fake.smdp.example$ZERO-TELNA-RECOVERY',
                  qrPayload:
                    'LPA:1$fake.smdp.example$ZERO-TELNA-RECOVERY',
                },
              };
            }
          );

        /*
         * Proxy the real Prisma client.
         *
         * Every normal model operation still reaches PostgreSQL.
         * Only the first canonical $transaction is deliberately
         * rejected after the fake provider package is known.
         */
        let failCanonicalTransaction =
          true;

        const failingPrisma =
          new Proxy(prisma, {
            get(target, property) {
              if (
                property ===
                '$transaction'
              ) {
                return async (...args) => {
                  if (
                    failCanonicalTransaction
                  ) {
                    failCanonicalTransaction =
                      false;

                    const error =
                      new Error(
                        'ZERO-TELNA forced canonical persistence failure'
                      );

                    error.code =
                      'ZERO_TELNA_CANONICAL_FAILURE';

                    throw error;
                  }

                  return target.$transaction(
                    ...args
                  );
                };
              }

              const value =
                target[property];

              if (
                typeof value ===
                'function'
              ) {
                return value.bind(target);
              }

              return value;
            },
          });

        /*
         * First attempt:
         * fake provider succeeds, canonical persistence fails.
         */
        await expect(
          replaceEsimForDevice(
            {
              userId:
                user.id,
              purchaseId:
                purchase.id,
              idempotencyKey:
                `${TEST_PREFIX}-RECOVERY-KEY-${suffix}`,
              reason:
                'ZERO_TELNA_RECOVERY_TEST',
              now,
            },
            {
              prismaClient:
                failingPrisma,
              provider:
                fakeProvider,
              allocator:
                fakeAllocator,
            }
          )
        ).rejects.toMatchObject({
          code:
            'ZERO_TELNA_CANONICAL_FAILURE',
        });

        const failedReplacement =
          await prisma.esimReplacement.findFirst({
            where: {
              userId:
                user.id,
              purchaseId:
                purchase.id,
            },
            include: {
              oldSubscriber: true,
              newSubscriber: true,
              purchase: true,
            },
          });

        expect(
          failedReplacement
        ).not.toBeNull();

        expect(
          failedReplacement.status
        ).toBe(
          'REQUIRES_RECONCILIATION'
        );

        /*
         * The known fake provider package must already be durable,
         * while provisionedAt remains null because canonical
         * persistence did not complete.
         */
        expect(
          failedReplacement.newProviderPurchaseId
        ).toBe(newPackage);

        expect(
          failedReplacement.provisionedAt
        ).toBeNull();

        /*
         * Old service must still be untouched after canonical failure.
         */
        const oldAfterFailure =
          await prisma.subscriber.findUnique({
            where: {
              id:
                oldSubscriber.id,
            },
          });

        expect(
          oldAfterFailure.status
        ).toBe('ACTIVE');

        expect(
          oldAfterFailure.suspendedAt
        ).toBeNull();

        expect(
          fakeProvider.setEsimPackageStatus
        ).not.toHaveBeenCalled();

        expect(
          fakeProvider.suspendLine
        ).not.toHaveBeenCalled();

        expect(
          fakeProvider.provisionEsimPack
        ).toHaveBeenCalledTimes(1);

        /*
         * Recovery uses the REAL Prisma client.
         *
         * It must restore canonical persistence from the known
         * package checkpoint and then clean up the old service.
         * It must NOT provision another package.
         */
        const reconciled =
          await reconcileEsimReplacement(
            failedReplacement.id,
            {
              prismaClient:
                prisma,
              provider:
                fakeProvider,
              testMode: true,
            }
          );

        expect(
          reconciled.status
        ).toBe('COMPLETED');

        expect(
          fakeProvider.provisionEsimPack
        ).toHaveBeenCalledTimes(1);

        expect(
          fakeAllocator
        ).toHaveBeenCalledTimes(1);

        expect(
          fakeProvider.fetchEsimUsage
        ).toHaveBeenCalledTimes(1);

        expect(
          fakeProvider.setEsimPackageStatus
        ).toHaveBeenCalledTimes(1);

        expect(
          fakeProvider.suspendLine
        ).toHaveBeenCalledTimes(1);

        const [
          persistedUser,
          persistedPurchase,
          persistedOldSubscriber,
          persistedNewSubscriber,
          finalReplacement,
        ] = await Promise.all([
          prisma.user.findUnique({
            where: {
              id: user.id,
            },
          }),

          prisma.mobileDataPackPurchase.findUnique({
            where: {
              id: purchase.id,
            },
          }),

          prisma.subscriber.findUnique({
            where: {
              id:
                oldSubscriber.id,
            },
          }),

          prisma.subscriber.findUnique({
            where: {
              iccid:
                newIccid,
            },
          }),

          prisma.esimReplacement.findUnique({
            where: {
              id:
                failedReplacement.id,
            },
          }),
        ]);

        expect(
          persistedUser.iccid
        ).toBe(newIccid);

        expect(
          persistedPurchase.iccid
        ).toBe(newIccid);

        expect(
          persistedPurchase.providerPurchaseId
        ).toBe(newPackage);

        expect(
          persistedPurchase.remainingDataMb
        ).toBe(4301);

        expect(
          persistedNewSubscriber.status
        ).toBe('PROVISIONING');

        expect(
          persistedOldSubscriber.status
        ).toBe('SUSPENDED');

        expect(
          persistedOldSubscriber.suspendedAt
        ).not.toBeNull();

        expect(
          finalReplacement.status
        ).toBe('COMPLETED');

        expect(
          finalReplacement.newProviderPurchaseId
        ).toBe(newPackage);

        expect(
          finalReplacement.provisionedAt
        ).not.toBeNull();

        expect(
          finalReplacement.oldPackageTerminatedAt
        ).not.toBeNull();

        expect(
          finalReplacement.completedAt
        ).not.toBeNull();

        /*
         * Critical invariant:
         *
         * failure + reconciliation created exactly ONE package.
         */
        expect(
          providerCalls.filter(
            (entry) =>
              entry.action ===
              'provisionEsimPack'
          )
        ).toHaveLength(1);

        expect(
          providerCalls.map(
            (entry) =>
              entry.action
          )
        ).toEqual([
          'fetchEsimUsage',
          'provisionEsimPack',
          'setEsimPackageStatus',
          'suspendLine',
        ]);

        console.log(
          '\nZERO-TELNA RECOVERY INTEGRATION RESULT'
        );

        console.table([
          {
            database:
              EXPECTED_DATABASE,
            afterFailure:
              'REQUIRES_RECONCILIATION',
            finalStatus:
              finalReplacement.status,
            packageCreations:
              fakeProvider
                .provisionEsimPack
                .mock.calls.length,
            oldSubscriberStatus:
              persistedOldSubscriber.status,
            newSubscriberStatus:
              persistedNewSubscriber.status,
            realTelnaCalls: 0,
          },
        ]);
      }
    );
  }
);
