import express from 'express';
import Stripe from 'stripe';
import prisma from '../utils/prismaClient.js';
import { getAddonConfig } from '../utils/billingProducts.js';
import { verifyAndApplyGooglePlaySubscription } from '../services/googlePlayEntitlementService.js';
import {
  assertAppSubscriptionProviderAvailable,
  recomputeUserAppEntitlement,
} from '../services/appEntitlementService.js';
import { verifyAndApplyAppleSubscription } from '../services/appleEntitlementService.js';

const router = express.Router();

function getProviderManagementAction(provider) {
  const normalizedProvider =
    String(provider || '').trim().toUpperCase();

  switch (normalizedProvider) {
    case 'STRIPE':
      return {
        provider: 'STRIPE',
        managedExternally: false,
        managementAction: 'OPEN_STRIPE_PORTAL',
        message:
          'Manage this subscription through Chatforia billing.',
      };

    case 'GOOGLE_PLAY':
      return {
        provider: 'GOOGLE_PLAY',
        managedExternally: true,
        managementAction:
          'OPEN_GOOGLE_PLAY_SUBSCRIPTIONS',
        message:
          'Manage this subscription through Google Play.',
      };

    case 'APPLE':
      return {
        provider: 'APPLE',
        managedExternally: true,
        managementAction:
          'OPEN_APP_STORE_SUBSCRIPTIONS',
        message:
          'Manage this subscription through the App Store.',
      };

    case 'MANUAL':
      return {
        provider: 'MANUAL',
        managedExternally: true,
        managementAction: 'CONTACT_SUPPORT',
        message:
          'This subscription must be managed by Chatforia support.',
      };

    default:
      return {
        provider: normalizedProvider || null,
        managedExternally: true,
        managementAction: 'CONTACT_SUPPORT',
        message:
          'Contact Chatforia support to manage this subscription.',
      };
  }
}


const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function normalizePlanCode(code) {
  return String(code || '').trim().toUpperCase();
}

function getPriceIdForPlan(plan) {
  switch (normalizePlanCode(plan)) {
    case 'PLUS_MONTHLY':
      return process.env.STRIPE_PRICE_PLUS_MONTHLY;
    case 'PREMIUM_MONTHLY':
      return process.env.STRIPE_PRICE_PREMIUM_MONTHLY;
    case 'PREMIUM_ANNUAL':
      return process.env.STRIPE_PRICE_PREMIUM_ANNUAL;
    
    // ---- Local eSIM Packs ----

    case 'WIRELESS_LOCAL_3':
      return process.env.STRIPE_PRICE_ESIM_LOCAL_3;

    case 'WIRELESS_LOCAL_5':
      return process.env.STRIPE_PRICE_ESIM_LOCAL_5;

    case 'WIRELESS_LOCAL_10':
      return process.env.STRIPE_PRICE_ESIM_LOCAL_10;

    case 'WIRELESS_LOCAL_20':
      return process.env.STRIPE_PRICE_ESIM_LOCAL_20;

    case 'WIRELESS_LOCAL_UNLIMITED':
      return process.env.STRIPE_PRICE_ESIM_LOCAL_UNLIMITED;

    // ---- Europe eSIM Packs ----

    case 'WIRELESS_EUROPE_3':
      return process.env.STRIPE_PRICE_ESIM_EUROPE_3;

    case 'WIRELESS_EUROPE_5':
      return process.env.STRIPE_PRICE_ESIM_EUROPE_5;

    case 'WIRELESS_EUROPE_10':
      return process.env.STRIPE_PRICE_ESIM_EUROPE_10;

    case 'WIRELESS_EUROPE_20':
      return process.env.STRIPE_PRICE_ESIM_EUROPE_20;

    case 'WIRELESS_EUROPE_UNLIMITED':
      return process.env.STRIPE_PRICE_ESIM_EUROPE_UNLIMITED;

    // ---- Global eSIM Packs ----

    case 'WIRELESS_GLOBAL_3':
      return process.env.STRIPE_PRICE_ESIM_GLOBAL_3;

    case 'WIRELESS_GLOBAL_5':
      return process.env.STRIPE_PRICE_ESIM_GLOBAL_5;

    case 'WIRELESS_GLOBAL_10':
      return process.env.STRIPE_PRICE_ESIM_GLOBAL_10;

    case 'WIRELESS_GLOBAL_UNLIMITED':
      return process.env.STRIPE_PRICE_ESIM_GLOBAL_UNLIMITED;
    default:
      return null;
  }
}

function getPriceIdForAddon(addonKind) {
  const value = String(addonKind || '')
    .trim()
    .toLowerCase();

  const match =
    /^chatforia_esim_(local|europe|global)_(3|5|10|20|unlimited)_premium$/.exec(
      value
    );

  if (!match) {
    return null;
  }

  const scope = match[1].toUpperCase();
  const amount = match[2].toUpperCase();

  const environmentVariable =
    `STRIPE_PRICE_ESIM_${scope}_${amount}`;

  return process.env[environmentVariable] || null;
}


function isSubscriptionPlan(plan) {
  return ['PLUS_MONTHLY', 'PREMIUM_MONTHLY', 'PREMIUM_ANNUAL'].includes(
    normalizePlanCode(plan)
  );
}

function planLabel(code) {
  switch (normalizePlanCode(code)) {
    case 'PLUS':
      return 'Chatforia Plus';
    case 'PREMIUM':
      return 'Chatforia Premium';
    case 'WIRELESS':
      return 'Chatforia Wireless';
    case 'FREE':
    default:
      return 'Chatforia Free';
  }
}

async function migrateStripeAppSubscriptionToGooglePlay(
  userId
) {
  const normalizedUserId = Number(userId);
  const now = new Date();

  const stripeEntitlement =
    await prisma.appSubscription.findFirst({
      where: {
        userId: normalizedUserId,
        provider: 'STRIPE',
        grantsAccess: true,
        plan: {
          in: ['PLUS', 'PREMIUM'],
        },
        AND: [
          {
            OR: [
              { startsAt: null },
              { startsAt: { lte: now } },
            ],
          },
          {
            OR: [
              { endsAt: null },
              { endsAt: { gt: now } },
            ],
          },
        ],
      },
      orderBy: [
        { endsAt: 'desc' },
        { updatedAt: 'desc' },
      ],
      select: {
        providerSubscriptionKey: true,
      },
    });

  const stripeSubscriptionId =
    stripeEntitlement?.providerSubscriptionKey;

  if (!stripeSubscriptionId) {
    const error = new Error(
      'No active Stripe app subscription was found to migrate.'
    );

    error.statusCode = 409;
    error.code = 'NO_STRIPE_APP_SUBSCRIPTION';

    throw error;
  }

  // Cancel the actual Stripe app subscription first.
  // This does not affect wireless/eSIM purchases.
  const canceledSubscription =
    await stripe.subscriptions.cancel(
      stripeSubscriptionId
    );

  const entitlementResult =
    await prisma.$transaction(async (tx) => {
      await tx.appSubscription.updateMany({
        where: {
          userId: normalizedUserId,
          provider: 'STRIPE',
          providerSubscriptionKey:
            stripeSubscriptionId,
        },
        data: {
          status: String(
            canceledSubscription?.status ||
              'canceled'
          ).toUpperCase(),
          grantsAccess: false,
          autoRenewEnabled: false,
          endsAt: now,
          lastVerifiedAt: now,
          rawResponse: {
            source:
              'google-play-provider-migration',
            migratedTo: 'GOOGLE_PLAY',
            livemode: Boolean(
              canceledSubscription?.livemode
            ),
          },
        },
      });

      return recomputeUserAppEntitlement(
        normalizedUserId,
        {
          db: tx,
          now,
        }
      );
    });

  return {
    stripeSubscriptionId,
    entitlementResult,
  };
}

router.get('/my-plan', async (req, res) => {
  try {
    const userId = req.user?.id ? Number(req.user.id) : null;

    if (!userId) {
      return res.json({
        plan: {
          id: null,
          code: 'FREE',
          label: 'Chatforia Free',
          isFree: true,
          status: 'INACTIVE',
          renewsAt: null,
          provider: null,
        },
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        plan: true,
        subscriptionStatus: true,
        subscriptionEndsAt: true,
        billingProvider: true,
      },
    });

    const code = normalizePlanCode(user?.plan || 'FREE');

    return res.json({
      plan: {
        id: code === 'FREE' ? null : code,
        code,
        label: planLabel(code),
        isFree: code === 'FREE',
        status: user?.subscriptionStatus || 'INACTIVE',
        renewsAt: user?.subscriptionEndsAt
          ? new Date(user.subscriptionEndsAt).toISOString()
          : null,
        provider: user?.billingProvider || null,
      },
    });
  } catch (err) {
    console.error('[billing/my-plan] error:', err);
    return res.status(500).json({ error: 'Unable to load plan' });
  }
});

router.get('/checkout-status', async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        error: 'Unauthorized',
      });
    }

    const userId = Number(req.user.id);

    const sessionId = String(
      req.query?.session_id || ''
    ).trim();

    if (!sessionId) {
      return res.status(400).json({
        error: 'session_id is required',
      });
    }

    if (!sessionId.startsWith('cs_')) {
      return res.status(400).json({
        error: 'Invalid checkout session ID',
      });
    }

    const session =
      await stripe.checkout.sessions.retrieve(
        sessionId
      );

    const sessionUserId =
      Number(session.metadata?.userId) ||
      Number(session.client_reference_id) ||
      null;

    if (
      !sessionUserId ||
      sessionUserId !== userId
    ) {
      return res.status(403).json({
        error:
          'This checkout session does not belong to the authenticated user',
      });
    }

    const addonConfig = getAddonConfig(
      session.metadata?.product
    );

    if (
      session.mode !== 'payment' ||
      addonConfig?.type !== 'ESIM'
    ) {
      return res.status(400).json({
        error:
          'This checkout session is not an eSIM purchase',
      });
    }

    const paymentStatus = String(
      session.payment_status || ''
    )
      .trim()
      .toLowerCase();

    const sessionStatus = String(
      session.status || ''
    )
      .trim()
      .toLowerCase();

    const paid =
      paymentStatus === 'paid';

    const expired =
      sessionStatus === 'expired';

    const pendingResponse = {
      status: expired ? 'EXPIRED' : 'PENDING',
      complete: false,
      paid,
      provisioned: false,
      sessionId: session.id,
      paymentStatus: paymentStatus || null,
      sessionStatus: sessionStatus || null,
      purchase: null,
    };

    if (!paid) {
      return res.json(pendingResponse);
    }

    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id || null;

    if (!paymentIntentId) {
      return res.json(pendingResponse);
    }

    const purchase =
      await prisma.mobileDataPackPurchase.findFirst({
        where: {
          userId,
          billingTransactionId:
            paymentIntentId,
        },
        select: {
          id: true,
          addonKind: true,
          totalDataMb: true,
          remainingDataMb: true,
          expiresAt: true,
          esimProfileId: true,
        },
      });

    let subscriber = null;

    if (purchase) {
      subscriber =
        await prisma.subscriber.findFirst({
          where: {
            userId,
            purchaseId: purchase.id,
          },
          orderBy: [
            {
              activatedAt: 'desc',
            },
            {
              createdAt: 'desc',
            },
          ],
          select: {
            id: true,
            status: true,
            providerProfileId: true,
            providerMeta: true,
          },
        });
    }

    const webhookApplied = Boolean(
      purchase?.esimProfileId &&
      subscriber?.providerProfileId &&
      subscriber?.providerMeta
        ?.stripeSessionId === session.id
    );

    if (!webhookApplied) {
      return res.json(pendingResponse);
    }

    return res.json({
      status: 'COMPLETE',
      complete: true,
      paid: true,
      provisioned: true,
      sessionId: session.id,
      paymentStatus,
      sessionStatus,
      purchase: {
        id: purchase.id,
        addonKind: purchase.addonKind,
        totalDataMb:
          purchase.totalDataMb,
        remainingDataMb:
          purchase.remainingDataMb,
        expiresAt:
          purchase.expiresAt,
      },
    });
  } catch (err) {
    if (err?.code === 'resource_missing') {
      return res.status(404).json({
        error:
          'Checkout session not found',
      });
    }

    console.error(
      '[billing/checkout-status] error:',
      {
        message: err?.message,
        type: err?.type,
        code: err?.code,
      }
    );

    return res.status(500).json({
      error:
        'Unable to check checkout status',
    });
  }
});

router.post('/checkout', async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = Number(req.user.id);
    const plan = normalizePlanCode(req.body?.plan);
    const product = String(req.body?.product || '').trim();

    const requestedPlatform = String(
      req.body?.platform || 'web'
    )
      .trim()
      .toLowerCase();

    const platform = ['web', 'android', 'ios'].includes(requestedPlatform)
      ? requestedPlatform
      : 'web';

    const addonConfig = product ? getAddonConfig(product) : null;

    if (plan && product) {
      return res.status(400).json({
        error: 'Checkout cannot include both a subscription plan and an add-on product',
      });
    }

    if (product && !addonConfig) {
      return res.status(400).json({
        error: 'Invalid or unknown add-on product',
      });
    }

    const isSubscription = isSubscriptionPlan(plan);
    const isAddon = Boolean(addonConfig);

    const sessionMode = isSubscription ? 'subscription' : 'payment';

    if (!isSubscription && !isAddon) {
      return res.status(400).json({
        error: 'Checkout must be for a known subscription or add-on product',
      });
    }

    const priceId = isAddon
      ? getPriceIdForAddon(addonConfig.addonKind)
      : getPriceIdForPlan(plan);

    if (!priceId) {
      return res.status(400).json({
        error: 'Invalid or unconfigured plan/price',
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        plan: true,
        billingProvider: true,
        billingCustomerId: true,
        billingSubscriptionId: true,
        subscriptionStatus: true,
        subscriptionEndsAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (
      isSubscription &&
      platform === 'android'
    ) {
      return res.status(409).json({
        error:
          'Android app subscriptions must be purchased through Google Play.',
        code: 'USE_GOOGLE_PLAY',
        provider: 'GOOGLE_PLAY',
      });
    }

    if (
      isSubscription &&
      platform === 'ios'
    ) {
      return res.status(409).json({
        error:
          'iOS app subscriptions must be purchased through the App Store.',
        code: 'USE_APPLE',
        provider: 'APPLE',
      });
    }

    const frontendOrigin =
      process.env.FRONTEND_ORIGIN ||
      process.env.WEB_URL ||
      'https://chatforia.com';

    const isIOSAddonCheckout =
      isAddon && platform === 'ios';

    const addonSuccessURL =
      isIOSAddonCheckout
        ? `${frontendOrigin}/mobile/esim/checkout-complete?session_id={CHECKOUT_SESSION_ID}`
        : `${frontendOrigin}/account/esim?session_id={CHECKOUT_SESSION_ID}`;

    const addonCancelURL =
      isIOSAddonCheckout
        ? `${frontendOrigin}/mobile/esim/checkout-canceled`
        : `${frontendOrigin}/upgrade?canceled=1`;

    const effectiveProvider =
      String(user.billingProvider || '')
        .trim()
        .toUpperCase();

    const hasPaidAppPlan =
      ['PLUS', 'PREMIUM'].includes(
        String(user.plan || '').toUpperCase()
      );

    if (
      isSubscription &&
      hasPaidAppPlan &&
      effectiveProvider &&
      effectiveProvider !== 'STRIPE'
    ) {
      return res.status(409).json({
        error:
          'Your current Chatforia subscription is managed by another provider.',
        code: 'SUBSCRIPTION_MANAGED_BY_PROVIDER',
        ...getProviderManagementAction(
          effectiveProvider
        ),
      });
    }

    if (
      isSubscription &&
      effectiveProvider === 'STRIPE' &&
      user.billingSubscriptionId
    ) {
        try {
          const existingSub = await stripe.subscriptions.retrieve(
            user.billingSubscriptionId
          );

          if (
            ['active', 'trialing', 'past_due'].includes(existingSub.status)
          ) {
            const portal = await stripe.billingPortal.sessions.create({
              customer: user.billingCustomerId,
              return_url: `${frontendOrigin}/account/plan`,
            });

            return res.json({
              url: portal.url,
              portalUrl: portal.url,
              redirectToPortal: true,
              reason: 'existing_subscription',
            });
          }
        } catch {
          // allow fresh checkout if Stripe subscription no longer exists
        }
      }

    let customerId = user.billingCustomerId;

    if (isSubscription) {
      await assertAppSubscriptionProviderAvailable(
        userId,
        'STRIPE'
      );
    }

    if (!customerId || !String(customerId).startsWith('cus_')) {
      const customer = await stripe.customers.create({
        email: user.email || undefined,
        name: user.username || undefined,
        metadata: {
          userId: String(user.id),
          app: 'chatforia',
        },
      });

      customerId = customer.id;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          billingCustomerId: customerId,
        },
      });
    }

    const checkoutMetadata = {
      userId: String(user.id),
      plan: plan || '',
      product: product || '',
      addonKind: addonConfig?.addonKind || '',
      addonType: addonConfig?.type || '',
      checkoutType: sessionMode,
      platform,
    };

    const sessionPayload = {
      mode: sessionMode,
      customer: customerId,
      client_reference_id: String(user.id),

      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],

      allow_promotion_codes: true,
      automatic_tax: { enabled: true },

      billing_address_collection: 'auto',

      customer_update: {
        address: 'auto',
        name: 'auto',
      },

      metadata: checkoutMetadata,

      success_url: isAddon
        ? addonSuccessURL
        : `${frontendOrigin}/upgrade-success?session_id={CHECKOUT_SESSION_ID}`,

      cancel_url: isAddon
        ? addonCancelURL
        : `${frontendOrigin}/upgrade?canceled=1`,
    };

    if (!isSubscription) {
      sessionPayload.payment_intent_data = {
        metadata: checkoutMetadata,
      };
    }

    if (isSubscription) {
      sessionPayload.subscription_data = {
        metadata: {
          userId: String(user.id),
          plan,
        },
      };
    }

    const session =
      await stripe.checkout.sessions.create(sessionPayload);

    return res.json({
      url: session.url,
      checkoutUrl: session.url,
      sessionId: session.id,
      plan,
    });
  } catch (err) {
    console.error('[billing/checkout] error:', {
      message: err?.message,
      type: err?.type,
      code: err?.code,
    });

    if (
      err?.code ===
      'APP_SUBSCRIPTION_PROVIDER_CONFLICT'
    ) {
      return res.status(409).json({
        error: err.message,
        code: err.code,

        currentProvider:
          err.currentProvider ?? null,

        requestedProvider:
          err.requestedProvider ?? null,

        currentPlan:
          err.currentPlan ?? null,

        currentSubscriptionEndsAt:
          err.currentSubscriptionEndsAt
            ?.toISOString?.() ?? null,

        ...getProviderManagementAction(
          err.currentProvider
        ),
      });
    }

    if (Number.isInteger(err?.statusCode)) {
      return res
        .status(err.statusCode)
        .json({
          error:
            err.message ||
            'Failed to start checkout',

          code:
            err.code ||
            'BILLING_CHECKOUT_FAILED',
        });
    }

    return res.status(500).json({
      error: 'Failed to start checkout',
    });
  }
});

router.post('/portal', async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        error: 'Unauthorized',
        code: 'UNAUTHORIZED',
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        id: Number(req.user.id),
      },
      select: {
        id: true,
        plan: true,
        billingProvider: true,
        billingCustomerId: true,
        billingSubscriptionId: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    const effectiveProvider =
      String(user.billingProvider || '')
        .trim()
        .toUpperCase();

    const hasPaidAppPlan =
      ['PLUS', 'PREMIUM'].includes(
        String(user.plan || '').toUpperCase()
      );

    if (
      hasPaidAppPlan &&
      effectiveProvider &&
      effectiveProvider !== 'STRIPE'
    ) {
      return res.status(409).json({
        error:
          'This subscription is managed by another provider.',
        code: 'SUBSCRIPTION_MANAGED_BY_PROVIDER',
        ...getProviderManagementAction(
          effectiveProvider
        ),
      });
    }

    if (
      effectiveProvider !== 'STRIPE' ||
      !user.billingSubscriptionId ||
      !user.billingCustomerId
    ) {
      return res.status(400).json({
        error:
          'No Stripe app subscription was found.',
        code: 'NO_STRIPE_SUBSCRIPTION',
      });
    }

    const frontendOrigin =
      process.env.FRONTEND_ORIGIN ||
      process.env.WEB_URL ||
      'https://chatforia.com';

    const portal =
      await stripe.billingPortal.sessions.create({
        customer: user.billingCustomerId,
        return_url:
          `${frontendOrigin}/account/plan`,
      });

    return res.json({
      url: portal.url,
      portalUrl: portal.url,
      provider: 'STRIPE',
      managedExternally: false,
      managementAction:
        'OPEN_STRIPE_PORTAL',
    });
  } catch (err) {
    console.error('[billing/portal] error:', {
      message: err?.message ?? null,
      type: err?.type ?? null,
      code: err?.code ?? null,
    });

    return res.status(500).json({
      error: 'Failed to open billing portal',
      code: 'BILLING_PORTAL_FAILED',
    });
  }
});

router.post('/cancel-now', async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        error: 'Unauthorized',
        code: 'UNAUTHORIZED',
      });
    }

    const userId = Number(req.user.id);

    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        plan: true,
        billingProvider: true,
        billingSubscriptionId: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    const effectiveProvider =
      String(user.billingProvider || '')
        .trim()
        .toUpperCase();

    const hasPaidAppPlan =
      ['PLUS', 'PREMIUM'].includes(
        String(user.plan || '').toUpperCase()
      );

    if (
      hasPaidAppPlan &&
      effectiveProvider &&
      effectiveProvider !== 'STRIPE'
    ) {
      return res.status(409).json({
        error:
          'This subscription must be canceled through its billing provider.',
        code: 'SUBSCRIPTION_MANAGED_BY_PROVIDER',
        ...getProviderManagementAction(
          effectiveProvider
        ),
      });
    }

    if (
      effectiveProvider !== 'STRIPE' ||
      !user.billingSubscriptionId
    ) {
      return res.status(400).json({
        error:
          'No active Stripe subscription was found.',
        code: 'NO_STRIPE_SUBSCRIPTION',
      });
    }

    const stripeSubscriptionId =
      user.billingSubscriptionId;

    const canceledSubscription =
      await stripe.subscriptions.cancel(
        stripeSubscriptionId
      );

    const now = new Date();

    const entitlementResult =
      await prisma.$transaction(async (tx) => {
        await tx.appSubscription.updateMany({
          where: {
            provider: 'STRIPE',
            providerSubscriptionKey:
              stripeSubscriptionId,
          },
          data: {
            status: String(
              canceledSubscription?.status ||
              'canceled'
            ).toUpperCase(),
            grantsAccess: false,
            autoRenewEnabled: false,
            endsAt: now,
            lastVerifiedAt: now,
            rawResponse: {
              source: 'billing-cancel-now',
              livemode:
                Boolean(
                  canceledSubscription?.livemode
                ),
            },
          },
        });

        return recomputeUserAppEntitlement(
          userId,
          {
            db: tx,
            now,
          }
        );
      });

    return res.json({
      ok: true,
      canceledProvider: 'STRIPE',
      plan:
        entitlementResult.user.plan,
      status:
        entitlementResult.user
          .subscriptionStatus,
      provider:
        entitlementResult.user
          .billingProvider,
      endsAt:
        entitlementResult.user
          .subscriptionEndsAt
          ?.toISOString() ?? null,
    });
  } catch (err) {
    console.error('[billing/cancel-now] error:', {
      message: err?.message ?? null,
      type: err?.type ?? null,
      code: err?.code ?? null,
    });

    return res.status(500).json({
      error: 'Failed to cancel subscription',
      code: 'SUBSCRIPTION_CANCEL_FAILED',
    });
  }
});

router.post('/ios-sync', async (req, res) => {
  if (!req.user?.id) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
    });
  }

  const signedTransactionInfo =
    typeof req.body?.signedTransactionInfo === 'string'
      ? req.body.signedTransactionInfo.trim()
      : '';

  if (!signedTransactionInfo) {
    return res.status(400).json({
      ok: false,
      error: 'A signed Apple transaction is required.',
      code: 'APPLE_TRANSACTION_REQUIRED',
    });
  }

  try {
    const result =
      await verifyAndApplyAppleSubscription({
        userId: req.user.id,
        signedTransactionInfo,
      });

    return res.json({
      ok: true,
      provider: 'APPLE',
      plan: result.user.plan,
      status:
        result.user.subscriptionStatus,
      expiresAt:
        result.user.subscriptionEndsAt
          ?.toISOString?.() ?? null,
      productId:
        result.transaction.productId,
      grantsAccess:
        result.grantsAccess,
      alreadyLinked:
        result.alreadyLinked,
    });
  } catch (err) {
    const statusCode =
      Number.isInteger(err?.statusCode)
        ? err.statusCode
        : 500;

    console.error(
      '[billing/ios-sync] error:',
      {
        message: err?.message ?? null,
        code: err?.code ?? null,
        userId: req.user?.id ?? null,
      }
    );

    return res.status(statusCode).json({
      ok: false,
      error:
        err?.message ||
        'Apple subscription verification failed.',
      code:
        err?.code ||
        'APPLE_SUBSCRIPTION_VERIFICATION_FAILED',
    });
  }
});

router.post('/google-play/verify', async (req, res) => {
  if (!req.user?.id) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
    });
  }

  const purchaseToken =
    typeof req.body?.purchaseToken === 'string'
      ? req.body.purchaseToken.trim()
      : '';

  if (!purchaseToken) {
    return res.status(400).json({
      ok: false,
      error: 'A Google Play purchase token is required.',
      code: 'PURCHASE_TOKEN_REQUIRED',
    });
  }

  const allowProviderMigration =
    req.body?.allowProviderMigration === true;

    try {
      let result;

      try {
        result =
          await verifyAndApplyGooglePlaySubscription({
            userId: req.user.id,
            purchaseToken,
          });
      } catch (error) {
        const canMigrateFromStripe =
          allowProviderMigration &&
          error?.code ===
            'APP_SUBSCRIPTION_PROVIDER_CONFLICT' &&
          error?.currentProvider === 'STRIPE';

        if (!canMigrateFromStripe) {
          throw error;
        }

        await migrateStripeAppSubscriptionToGooglePlay(
          req.user.id
        );

        // The valid Google purchase can now become the
        // authoritative app entitlement.
        result =
          await verifyAndApplyGooglePlaySubscription({
            userId: req.user.id,
            purchaseToken,
          });
      }

    return res.json({
      ok: true,
      plan: result.user.plan,
      entitlementPlan: result.verified.entitlementPlan,
      status: result.verified.subscriptionState,
      expiresAt:
        result.verified.expiryTime?.toISOString() ?? null,
      acknowledged: result.acknowledged,
      acknowledgementPending:
        result.acknowledgementPending,
      productId: result.verified.productId,
      basePlanId: result.verified.basePlanId,
      autoRenewEnabled:
        result.verified.autoRenewEnabled,
      grantsAccess: result.verified.grantsAccess,
    });
  } catch (err) {
    const googleStatus = Number(
      err?.response?.status ?? err?.code
    );

    let statusCode = 500;
    let code = 'GOOGLE_PLAY_VERIFICATION_FAILED';
    let message =
      'Google Play subscription verification failed.';

    if (Number.isInteger(err?.statusCode)) {
      statusCode = err.statusCode;
      code =
        typeof err.code === 'string'
          ? err.code
          : code;
      message = err.message;
    } else if (
      googleStatus === 400 ||
      googleStatus === 404
    ) {
      statusCode = 400;
      code = 'GOOGLE_PLAY_PURCHASE_NOT_FOUND';
      message =
        'Google Play could not verify this purchase.';
    } else if (
      googleStatus === 401 ||
      googleStatus === 403
    ) {
      statusCode = 503;
      code = 'GOOGLE_PLAY_API_UNAVAILABLE';
      message =
        'Google Play verification is temporarily unavailable.';
    }

    console.error('[billing/google-play/verify] error:', {
      message: err?.message,
      code: err?.code,
      googleStatus:
        Number.isFinite(googleStatus)
          ? googleStatus
          : null,
      userId: req.user?.id,
    });

    return res.status(statusCode).json({
      ok: false,
      error: message,
      code,
    });
  }
});

export default router;
