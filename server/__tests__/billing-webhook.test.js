import prisma from '../utils/prismaClient.js';
import {
  makeAgent,
} from './helpers/testServer.js';

const ENDPOINTS = {
  webhook: '/billing/webhook',
};

const TEST_USER_ID = 999;
const PLUS_PRICE_ID = 'price_plus';

function unixSeconds(date = new Date()) {
  return Math.floor(date.getTime() / 1000);
}

function makeStripeEvent({
  id,
  type,
  object,
}) {
  return {
    id,
    object: 'event',
    type,
    api_version: '2022-11-15',
    created: unixSeconds(),
    livemode: false,

    data: {
      object,
    },

    request: {
      id: null,
      idempotency_key: null,
    },

    pending_webhooks: 1,
  };
}

function makeActiveStripeSubscription({
  id = 'sub_live_abc',
  userId = TEST_USER_ID,
  customer = 'cus_live_999',
  priceId = PLUS_PRICE_ID,
} = {}) {
  const now = Date.now();

  const currentPeriodStart =
    unixSeconds(
      new Date(now - 60_000)
    );

  const currentPeriodEnd =
    unixSeconds(
      new Date(
        now +
          30 *
            24 *
            60 *
            60 *
            1000
      )
    );

  return {
    object: 'subscription',
    id,
    customer,
    status: 'active',
    cancel_at_period_end: false,

    metadata: {
      userId: String(userId),
    },

    items: {
      data: [
        {
          object: 'subscription_item',

          current_period_start:
            currentPeriodStart,

          current_period_end:
            currentPeriodEnd,

          price: {
            id: priceId,
          },
        },
      ],
    },

    livemode: false,
  };
}


function makeCanceledStripeSubscription({
  id = 'sub_live_abc',
  userId = TEST_USER_ID,
  customer = 'cus_live_999',
} = {}) {
  const currentPeriodEnd =
    unixSeconds();

  return {
    object: 'subscription',
    id,
    customer,
    status: 'canceled',
    cancel_at_period_end: false,

    metadata: {
      userId: String(userId),
    },

    items: {
      data: [
        {
          object: 'subscription_item',
          current_period_end:
            currentPeriodEnd,
        },
      ],
    },

    livemode: false,
  };
}

async function createTestUser(data = {}) {
  return prisma.user.create({
    data: {
      id: TEST_USER_ID,
      username:
        'billing_webhook_test',
      email:
        'billing-webhook-test@chatforia.test',
      passwordHash:
        'test-password-hash',
      plan: 'FREE',
      subscriptionStatus:
        'INACTIVE',

      ...data,
    },
  });
}

async function createAppSubscription({
  userId = TEST_USER_ID,
  provider,
  providerSubscriptionKey,
  productId,
  plan = 'PLUS',
  status = 'ACTIVE',
  grantsAccess = true,
  customerReference = null,

  startsAt =
    new Date(
      Date.now() - 60_000
    ),

  endsAt =
    new Date(
      Date.now() +
        30 *
          24 *
          60 *
          60 *
          1000
    ),
}) {
  return prisma.appSubscription.create({
    data: {
      userId,
      provider,
      providerSubscriptionKey,
      customerReference,
      productId,
      basePlanId: null,
      plan,
      status,
      grantsAccess,
      autoRenewEnabled: true,
      startsAt,
      endsAt,
      lastVerifiedAt:
        new Date(),

      rawResponse: {
        source:
          'billing-webhook-test',
      },
    },
  });
}

describe(
  'Billing webhook provider separation',
  () => {
    let agent;

    beforeAll(() => {
      process.env
        .STRIPE_SKIP_SIG_CHECK =
        'true';

      process.env
        .STRIPE_PRICE_PLUS_MONTHLY =
        PLUS_PRICE_ID;

      agent = makeAgent().agent;
    });

    beforeEach(async () => {
  await prisma.stripeWebhookEvent.deleteMany({});

  await prisma.appSubscription.deleteMany({
    where: {
      userId: TEST_USER_ID,
    },
  });

  await prisma.subscriber.deleteMany({
    where: {
      userId: TEST_USER_ID,
    },
  });

  await prisma.mobileDataPackPurchase.deleteMany({
    where: {
      userId: TEST_USER_ID,
    },
  });

  await prisma.user.deleteMany({
    where: {
      id: TEST_USER_ID,
    },
  });
});

    test(
      'checkout.session.completed is accepted and recorded',
      async () => {
        const evt =
          makeStripeEvent({
            id:
              'evt_cs_completed',

            type:
              'checkout.session.completed',

            object: {
              object:
                'checkout.session',

              id:
                'cs_test_123',

              mode:
                'subscription',

              status:
                'complete',

              customer:
                'cus_test_123',

              client_reference_id:
                String(
                  TEST_USER_ID
                ),

              subscription:
                'sub_test_456',

              customer_details: {
                email:
                  'payer@example.com',
              },
            },
          });

        await agent
          .post(
            ENDPOINTS.webhook
          )
          .set(
            'Stripe-Signature',
            't=0,v1=testsig'
          )
          .set(
            'Content-Type',
            'application/json'
          )
          .send(JSON.stringify(evt))
          .expect(200);

        const processedEvent =
          await prisma
            .stripeWebhookEvent
            .findUnique({
              where: {
                id: evt.id,
              },
            });

        expect(
          processedEvent
        ).not.toBeNull();

        expect(
          processedEvent.type
        ).toBe(
          'checkout.session.completed'
        );
      }
    );

    test(
      'Sandbox eSIM top-up carries forward balance exactly once',
      async () => {
        await createTestUser();

        const priorPurchasedAt =
          new Date(
            Date.now() -
              24 * 60 * 60 * 1000
          );

        const priorExpiresAt =
          new Date(
            Date.now() +
              20 *
                24 *
                60 *
                60 *
                1000
          );

        const priorPurchase =
          await prisma.mobileDataPackPurchase.create({
            data: {
              userId: TEST_USER_ID,
              kind: 'ESIM',
              addonKind:
                'chatforia_esim_local_3_premium',
              purchasedAt:
                priorPurchasedAt,
              expiresAt:
                priorExpiresAt,
              totalDataMb:
                3 * 1024,
              remainingDataMb:
                2 * 1024,
              billingTransactionId:
                'pi_existing_local_3',
              esimProfileId:
                'mock-telna-existing',
              iccid:
                '89000000000000999',
            },
          });

        const subscriber =
          await prisma.subscriber.create({
            data: {
              userId: TEST_USER_ID,
              purchaseId:
                priorPurchase.id,
              provider: 'telna',
              providerProfileId:
                'mock-telna-existing',
              iccid:
                '89000000000000999',
              iccidHint:
                '890000••••••',
              region: 'US',
              status: 'ACTIVE',
              activatedAt:
                priorPurchasedAt,
              expiresAt:
                priorExpiresAt,
              providerMeta: {
                mock: true,
              },
            },
          });

        const checkoutSession = {
          object:
            'checkout.session',
          id:
            'cs_esim_topup_local_5',
          mode:
            'payment',
          status:
            'complete',
          payment_status:
            'paid',
          payment_intent:
            'pi_esim_topup_local_5',
          client_reference_id:
            String(TEST_USER_ID),
          livemode:
            false,

          metadata: {
            userId:
              String(TEST_USER_ID),
            product:
              'chatforia_esim_local_5',
            platform:
              'ios',
          },
        };

        const postWebhook = (event) =>
          agent
            .post(
              ENDPOINTS.webhook
            )
            .set(
              'Stripe-Signature',
              't=0,v1=testsig'
            )
            .set(
              'Content-Type',
              'application/json'
            )
            .send(
              JSON.stringify(event)
            );

        const firstEvent =
          makeStripeEvent({
            id:
              'evt_esim_topup_local_5',
            type:
              'checkout.session.completed',
            object:
              checkoutSession,
          });

        await postWebhook(
          firstEvent
        ).expect(200);

        const topUpPurchase =
          await prisma.mobileDataPackPurchase.findUnique({
            where: {
              billingTransactionId:
                'pi_esim_topup_local_5',
            },
          });

        expect(
          topUpPurchase
        ).toEqual(
          expect.objectContaining({
            userId:
              TEST_USER_ID,
            totalDataMb:
              8 * 1024,
            remainingDataMb:
              7 * 1024,
            esimProfileId:
              'mock-telna-existing',
          })
        );

        const transferredPrior =
          await prisma.mobileDataPackPurchase.findUnique({
            where: {
              id:
                priorPurchase.id,
            },
          });

        expect(
          transferredPrior.remainingDataMb
        ).toBe(0);

        const updatedSubscriber =
          await prisma.subscriber.findUnique({
            where: {
              id:
                subscriber.id,
            },
          });

        expect(
          updatedSubscriber
        ).toEqual(
          expect.objectContaining({
            purchaseId:
              topUpPurchase.id,
            providerProfileId:
              'mock-telna-existing',
          })
        );

        expect(
          updatedSubscriber
            .providerMeta
            .topUp
        ).toEqual(
          expect.objectContaining({
            previousPurchaseId:
              priorPurchase.id,
            carriedTotalDataMb:
              3 * 1024,
            carriedRemainingDataMb:
              2 * 1024,
            creditedDataMb:
              5 * 1024,
            combinedTotalDataMb:
              8 * 1024,
            combinedRemainingDataMb:
              7 * 1024,
            sandbox:
              true,
          })
        );

        // Simulate Stripe delivering the same
        // checkout under another event ID.
        const retryEvent =
          makeStripeEvent({
            id:
              'evt_esim_topup_local_5_retry',
            type:
              'checkout.session.completed',
            object:
              checkoutSession,
          });

        await postWebhook(
          retryEvent
        ).expect(200);

        const purchaseAfterRetry =
          await prisma.mobileDataPackPurchase.findUnique({
            where: {
              billingTransactionId:
                'pi_esim_topup_local_5',
            },
          });

        expect(
          purchaseAfterRetry.totalDataMb
        ).toBe(
          8 * 1024
        );

        expect(
          purchaseAfterRetry.remainingDataMb
        ).toBe(
          7 * 1024
        );

        const purchaseCount =
          await prisma.mobileDataPackPurchase.count({
            where: {
              userId:
                TEST_USER_ID,
            },
          });

        expect(
          purchaseCount
        ).toBe(2);
      }
    );

    test(
      'Sandbox eSIM purchase reuses an active subscriber after its prior pack expires',
      async () => {
        const existingIccid =
          '89000000000009997';

        await createTestUser({
          iccid:
            existingIccid,
        });

        const oldExpiry =
          new Date(
            Date.now() -
              60 * 60 * 1000
          );

        const activeSubscriber =
          await prisma.subscriber.create({
            data: {
              userId:
                TEST_USER_ID,

              provider:
                'telna',

              providerProfileId:
                'mock-telna-active-expired-pack',

              iccid:
                existingIccid,

              iccidHint:
                '890000••••••',

              region:
                'US',

              status:
                'ACTIVE',

              activatedAt:
                new Date(
                  Date.now() -
                    24 *
                      60 *
                      60 *
                      1000
                ),

              expiresAt:
                oldExpiry,

              providerMeta: {
                mock:
                  true,

                priorPackExpired:
                  true,
              },
            },
          });

        const checkoutSession = {
          object:
            'checkout.session',

          id:
            'cs_esim_active_expired_pack_topup',

          mode:
            'payment',

          status:
            'complete',

          payment_status:
            'paid',

          payment_intent:
            'pi_esim_active_expired_pack_topup',

          client_reference_id:
            String(TEST_USER_ID),

          livemode:
            false,

          metadata: {
            userId:
              String(TEST_USER_ID),

            product:
              'chatforia_esim_local_3_premium',

            platform:
              'web',
          },
        };

        const event =
          makeStripeEvent({
            id:
              'evt_esim_active_expired_pack_topup',

            type:
              'checkout.session.completed',

            object:
              checkoutSession,
          });

        await agent
          .post(
            ENDPOINTS.webhook
          )
          .set(
            'Stripe-Signature',
            't=0,v1=testsig'
          )
          .set(
            'Content-Type',
            'application/json'
          )
          .send(
            JSON.stringify(event)
          )
          .expect(200);

        const purchase =
          await prisma
            .mobileDataPackPurchase
            .findUnique({
              where: {
                billingTransactionId:
                  checkoutSession
                    .payment_intent,
              },
            });

        const subscribers =
          await prisma.subscriber.findMany({
            where: {
              userId:
                TEST_USER_ID,
            },

            orderBy: {
              createdAt:
                'asc',
            },
          });

        expect(
          subscribers
        ).toHaveLength(1);

        expect(
          subscribers[0]
        ).toEqual(
          expect.objectContaining({
            id:
              activeSubscriber.id,

            status:
              'ACTIVE',

            purchaseId:
              purchase.id,

            providerProfileId:
              'mock-telna-active-expired-pack',

            iccid:
              existingIccid,
          })
        );

        expect(
          subscribers[0].expiresAt
        ).not.toEqual(
          oldExpiry
        );

        expect(
          purchase
        ).toEqual(
          expect.objectContaining({
            userId:
              TEST_USER_ID,

            addonKind:
              'chatforia_esim_local_3_premium',

            totalDataMb:
              3 * 1024,

            remainingDataMb:
              3 * 1024,

            esimProfileId:
              'mock-telna-active-expired-pack',

            iccid:
              existingIccid,
          })
        );

        const user =
          await prisma.user.findUnique({
            where: {
              id:
                TEST_USER_ID,
            },

            select: {
              iccid:
                true,
            },
          });

        expect(
          user.iccid
        ).toBe(
          existingIccid
        );
      }
    );

    test(
      'Sandbox eSIM purchase does not reuse a canceled subscriber',
      async () => {
        await createTestUser();

        const canceledSubscriber =
          await prisma.subscriber.create({
            data: {
              userId:
                TEST_USER_ID,

              provider:
                'telna',

              providerProfileId:
                'mock-telna-canceled',

              iccid:
                '89000000000009998',

              iccidHint:
                '890000••••••',

              region:
                'US',

              status:
                'CANCELLED',

              activatedAt:
                new Date(
                  Date.now() -
                    24 *
                      60 *
                      60 *
                      1000
                ),

              expiresAt:
                new Date(
                  Date.now() +
                    24 *
                      60 *
                      60 *
                      1000
                ),

              providerMeta: {
                mock:
                  true,

                canceled:
                  true,
              },
            },
          });

        const checkoutSession = {
          object:
            'checkout.session',

          id:
            'cs_esim_after_canceled_subscriber',

          mode:
            'payment',

          status:
            'complete',

          payment_status:
            'paid',

          payment_intent:
            'pi_esim_after_canceled_subscriber',

          client_reference_id:
            String(TEST_USER_ID),

          livemode:
            false,

          metadata: {
            userId:
              String(TEST_USER_ID),

            product:
              'chatforia_esim_local_3_premium',

            platform:
              'web',
          },
        };

        const event =
          makeStripeEvent({
            id:
              'evt_esim_after_canceled_subscriber',

            type:
              'checkout.session.completed',

            object:
              checkoutSession,
          });

        await agent
          .post(
            ENDPOINTS.webhook
          )
          .set(
            'Stripe-Signature',
            't=0,v1=testsig'
          )
          .set(
            'Content-Type',
            'application/json'
          )
          .send(
            JSON.stringify(event)
          )
          .expect(200);

        const purchase =
          await prisma
            .mobileDataPackPurchase
            .findUnique({
              where: {
                billingTransactionId:
                  checkoutSession
                    .payment_intent,
              },
            });

        const subscribers =
          await prisma.subscriber.findMany({
            where: {
              userId:
                TEST_USER_ID,
            },

            orderBy: {
              createdAt:
                'asc',
            },
          });

        const originalSubscriber =
          subscribers.find(
            (subscriber) =>
              subscriber.id ===
              canceledSubscriber.id
          );

        const replacementSubscriber =
          subscribers.find(
            (subscriber) =>
              subscriber.id !==
              canceledSubscriber.id
          );

        expect(
          subscribers
        ).toHaveLength(2);

        expect(
          originalSubscriber
        ).toEqual(
          expect.objectContaining({
            status:
              'CANCELLED',

            providerProfileId:
              'mock-telna-canceled',

            purchaseId:
              null,
          })
        );

        expect(
          replacementSubscriber
        ).toEqual(
          expect.objectContaining({
            status:
              'PENDING',

            purchaseId:
              purchase.id,

            provider:
              'telna',
          })
        );

        expect(
          replacementSubscriber
            .providerProfileId
        ).toMatch(
          /^mock-telna-/
        );

        expect(
          replacementSubscriber
            .providerProfileId
        ).not.toBe(
          canceledSubscriber
            .providerProfileId
        );

        expect(
          purchase
        ).toEqual(
          expect.objectContaining({
            userId:
              TEST_USER_ID,

            addonKind:
              'chatforia_esim_local_3_premium',

            totalDataMb:
              3 * 1024,

            remainingDataMb:
              3 * 1024,

            esimProfileId:
              replacementSubscriber
                .providerProfileId,

            iccid:
              replacementSubscriber
                .iccid,
          })
        );

        const user =
          await prisma.user.findUnique({
            where: {
              id:
                TEST_USER_ID,
            },

            select: {
              iccid:
                true,
            },
          });

        expect(
          user.iccid
        ).toBe(
          replacementSubscriber.iccid
        );
      }
    );

    test(
      'active Stripe subscription creates an AppSubscription and projects the user plan',
      async () => {
        await createTestUser();

        const subscription =
          makeActiveStripeSubscription({
            id:
              'sub_active_plus',
          });

        const evt =
          makeStripeEvent({
            id:
              'evt_sub_active_plus',

            type:
              'customer.subscription.updated',

            object:
              subscription,
          });

        await agent
          .post(
            ENDPOINTS.webhook
          )
          .set(
            'Stripe-Signature',
            't=0,v1=testsig'
          )
          .set(
            'Content-Type',
            'application/json'
          )
          .send(JSON.stringify(evt))
          .expect(200);

        const appSubscription =
          await prisma
            .appSubscription
            .findUnique({
              where: {
                provider_providerSubscriptionKey: {
                  provider:
                    'STRIPE',

                  providerSubscriptionKey:
                    subscription.id,
                },
              },
            });


        const subscriptionItem =
          subscription.items.data[0];

        expect(
          appSubscription.startsAt
        ).toEqual(
          new Date(
            subscriptionItem.current_period_start *
              1000
          )
        );

        expect(
          appSubscription.endsAt
        ).toEqual(
          new Date(
            subscriptionItem.current_period_end *
              1000
          )
        );

        expect(
          appSubscription
        ).toEqual(
          expect.objectContaining({
            userId:
              TEST_USER_ID,

            provider:
              'STRIPE',

            providerSubscriptionKey:
              subscription.id,

            customerReference:
              subscription.customer,

            productId:
              PLUS_PRICE_ID,

            plan:
              'PLUS',

            status:
              'ACTIVE',

            grantsAccess:
              true,

            autoRenewEnabled:
              true,
          })
        );

        const user =
          await prisma.user.findUnique({
            where: {
              id:
                TEST_USER_ID,
            },

            select: {
              plan: true,
              billingProvider:
                true,
              billingCustomerId:
                true,
              billingSubscriptionId:
                true,
              subscriptionStatus:
                true,
              subscriptionEndsAt:
                true,
            },
          });

        expect(user).toEqual(
          expect.objectContaining({
            plan:
              'PLUS',

            billingProvider:
              'STRIPE',

            billingCustomerId:
              subscription.customer,

            billingSubscriptionId:
              subscription.id,

            subscriptionStatus:
              'ACTIVE',

            subscriptionEndsAt:
              new Date(
                subscription.items.data[0]
                  .current_period_end * 1000
              ),
          })
        );
      }
    );

    test(
      'active Google Play entitlement prevents a new Stripe app subscription',
      async () => {
        const googleEndsAt =
          new Date(
            Date.now() +
              30 *
                24 *
                60 *
                60 *
                1000
          );

        await createTestUser({
          plan:
            'PLUS',

          billingProvider:
            'GOOGLE_PLAY',

          billingSubscriptionId:
            null,

          subscriptionStatus:
            'ACTIVE',

          subscriptionEndsAt:
            googleEndsAt,
        });

        await createAppSubscription({
          provider:
            'GOOGLE_PLAY',

          providerSubscriptionKey:
            'google-play:test-active',

          productId:
            'chatforia_plus',

          endsAt:
            googleEndsAt,
        });

        const subscription =
          makeActiveStripeSubscription({
            id:
              'sub_should_be_blocked',
          });

        const evt =
          makeStripeEvent({
            id:
              'evt_stripe_blocked_by_google',

            type:
              'customer.subscription.updated',

            object:
              subscription,
          });

        await agent
          .post(
            ENDPOINTS.webhook
          )
          .set(
            'Stripe-Signature',
            't=0,v1=testsig'
          )
          .set(
            'Content-Type',
            'application/json'
          )
          .send(JSON.stringify(evt))
          .expect(200);

        const stripeEntitlement =
          await prisma
            .appSubscription
            .findUnique({
              where: {
                provider_providerSubscriptionKey: {
                  provider:
                    'STRIPE',

                  providerSubscriptionKey:
                    subscription.id,
                },
              },
            });

        expect(
          stripeEntitlement
        ).toBeNull();

        const user =
          await prisma.user.findUnique({
            where: {
              id:
                TEST_USER_ID,
            },

            select: {
              plan: true,
              billingProvider:
                true,
              billingSubscriptionId:
                true,
              subscriptionStatus:
                true,
            },
          });

        expect(user).toEqual({
          plan:
            'PLUS',

          billingProvider:
            'GOOGLE_PLAY',

          billingSubscriptionId:
            null,

          subscriptionStatus:
            'ACTIVE',
        });
      }
    );

    test(
      'canceling Stripe preserves an active Google Play entitlement',
      async () => {
        const futureDate =
          new Date(
            Date.now() +
              30 *
                24 *
                60 *
                60 *
                1000
          );

        await createTestUser({
          plan:
            'PLUS',

          billingProvider:
            'STRIPE',

          billingCustomerId:
            'cus_legacy',

          billingSubscriptionId:
            'sub_legacy_stripe',

          subscriptionStatus:
            'ACTIVE',

          subscriptionEndsAt:
            futureDate,
        });

        await createAppSubscription({
          provider:
            'STRIPE',

          providerSubscriptionKey:
            'sub_legacy_stripe',

          customerReference:
            'cus_legacy',

          productId:
            PLUS_PRICE_ID,

          endsAt:
            futureDate,
        });

        await createAppSubscription({
          provider:
            'GOOGLE_PLAY',

          providerSubscriptionKey:
            'google-play:legacy-active',

          productId:
            'chatforia_plus',

          endsAt:
            futureDate,
        });

        const subscription =
          makeCanceledStripeSubscription({
            id:
              'sub_legacy_stripe',

            customer:
              'cus_legacy',
          });

        const evt =
          makeStripeEvent({
            id:
              'evt_cancel_stripe_keep_google',

            type:
              'customer.subscription.updated',

            object:
              subscription,
          });

        await agent
          .post(
            ENDPOINTS.webhook
          )
          .set(
            'Stripe-Signature',
            't=0,v1=testsig'
          )
          .set(
            'Content-Type',
            'application/json'
          )
          .send(JSON.stringify(evt))
          .expect(200);

        const stripeEntitlement =
          await prisma
            .appSubscription
            .findUnique({
              where: {
                provider_providerSubscriptionKey: {
                  provider:
                    'STRIPE',

                  providerSubscriptionKey:
                    subscription.id,
                },
              },
            });

        expect(
          stripeEntitlement
        ).toEqual(
          expect.objectContaining({
            status:
              'CANCELED',

            grantsAccess:
              false,

            autoRenewEnabled:
              false,
          })
        );

        const user =
          await prisma.user.findUnique({
            where: {
              id:
                TEST_USER_ID,
            },

            select: {
              plan: true,
              billingProvider:
                true,
              billingSubscriptionId:
                true,
              subscriptionStatus:
                true,
            },
          });

        expect(user).toEqual({
          plan:
            'PLUS',

          billingProvider:
            'GOOGLE_PLAY',

          billingSubscriptionId:
            null,

          subscriptionStatus:
            'ACTIVE',
        });
      }
    );

    test(
      'canceling the only Stripe entitlement downgrades the user to FREE',
      async () => {
        const futureDate =
          new Date(
            Date.now() +
              30 *
                24 *
                60 *
                60 *
                1000
          );

        await createTestUser({
          plan:
            'PLUS',

          billingProvider:
            'STRIPE',

          billingCustomerId:
            'cus_only_stripe',

          billingSubscriptionId:
            'sub_only_stripe',

          subscriptionStatus:
            'ACTIVE',

          subscriptionEndsAt:
            futureDate,
        });

        await createAppSubscription({
          provider:
            'STRIPE',

          providerSubscriptionKey:
            'sub_only_stripe',

          customerReference:
            'cus_only_stripe',

          productId:
            PLUS_PRICE_ID,

          endsAt:
            futureDate,
        });

        const subscription =
          makeCanceledStripeSubscription({
            id:
              'sub_only_stripe',

            customer:
              'cus_only_stripe',
          });

        const evt =
          makeStripeEvent({
            id:
              'evt_cancel_only_stripe',

            type:
              'customer.subscription.updated',

            object:
              subscription,
          });

        await agent
          .post(
            ENDPOINTS.webhook
          )
          .set(
            'Stripe-Signature',
            't=0,v1=testsig'
          )
          .set(
            'Content-Type',
            'application/json'
          )
          .send(JSON.stringify(evt))
          .expect(200);

        const user =
          await prisma.user.findUnique({
            where: {
              id:
                TEST_USER_ID,
            },

            select: {
              plan: true,
              billingProvider:
                true,
              billingSubscriptionId:
                true,
              subscriptionStatus:
                true,
              subscriptionEndsAt:
                true,
            },
          });

        expect(user).toEqual({
          plan:
            'FREE',

          billingProvider:
            null,

          billingSubscriptionId:
            null,

          subscriptionStatus:
            'INACTIVE',

          subscriptionEndsAt:
            null,
        });
      }
    );
  }
);