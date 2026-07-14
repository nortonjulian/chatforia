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

  return {
    object: 'subscription',
    id,
    customer,
    status: 'active',

    current_period_start:
      unixSeconds(
        new Date(now - 60_000)
      ),

    current_period_end:
      unixSeconds(
        new Date(
          now +
            30 *
              24 *
              60 *
              60 *
              1000
        )
      ),

    cancel_at_period_end: false,

    metadata: {
      userId: String(userId),
    },

    items: {
      data: [
        {
          object: 'subscription_item',

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
  return {
    object: 'subscription',
    id,
    customer,
    status: 'canceled',
    current_period_end:
      unixSeconds(),
    cancel_at_period_end: false,

    metadata: {
      userId: String(userId),
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
              expect.any(Date),
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