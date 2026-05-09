import express from 'express';
import Stripe from 'stripe';
import prisma from '../utils/prismaClient.js';

const router = express.Router();

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
        billingSubscriptionId: true,
      },
    });

    const code = normalizePlanCode(user?.plan || 'FREE');

    return res.json({
      plan: {
        id: user?.billingSubscriptionId || null,
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

router.post('/checkout', async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = Number(req.user.id);
    const plan = normalizePlanCode(req.body?.plan);

    const isSubscription = isSubscriptionPlan(plan);
    const sessionMode = isSubscription ? 'subscription' : 'payment';

    let priceId =
      req.body?.priceId ||
      getPriceIdForPlan(plan);

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
        billingCustomerId: true,
        billingSubscriptionId: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const frontendOrigin =
      process.env.FRONTEND_ORIGIN ||
      process.env.WEB_URL ||
      'https://chatforia.com';

      if (isSubscription && user.billingSubscriptionId) {
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
          billingProvider: 'STRIPE',
          billingCustomerId: customerId,
        },
      });
    }

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

      metadata: {
        userId: String(user.id),
        plan,
        checkoutType: sessionMode,
      },

      success_url:
        `${frontendOrigin}/upgrade-success?session_id={CHECKOUT_SESSION_ID}`,

      cancel_url:
        `${frontendOrigin}/upgrade?canceled=1`,
    };

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
      raw: err?.raw,
    });
    return res.status(500).json({ error: 'Failed to start checkout' });
  }
});

router.post('/portal', async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await prisma.user.findUnique({
      where: { id: Number(req.user.id) },
      select: {
        billingCustomerId: true,
      },
    });

    if (!user?.billingCustomerId) {
      return res.status(400).json({ error: 'No billing customer found' });
    }

    const frontendOrigin =
      process.env.FRONTEND_ORIGIN ||
      process.env.WEB_URL ||
      'https://chatforia.com';

    const portal = await stripe.billingPortal.sessions.create({
      customer: user.billingCustomerId,
      return_url: `${frontendOrigin}/account/plan`,
    });

    return res.json({
      url: portal.url,
      portalUrl: portal.url,
    });
  } catch (err) {
    console.error('[billing/portal] error:', err);
    return res.status(500).json({ error: 'Failed to open billing portal' });
  }
});

router.post('/cancel-now', async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = Number(req.user.id);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        billingSubscriptionId: true,
      },
    });

    if (!user?.billingSubscriptionId) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    await stripe.subscriptions.cancel(user.billingSubscriptionId);

    await prisma.user.update({
      where: { id: userId },
      data: {
        plan: 'FREE',
        subscriptionStatus: 'CANCELED',
        subscriptionEndsAt: new Date(),
        billingSubscriptionId: null,
      },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[billing/cancel-now] error:', {
      message: err?.message,
      type: err?.type,
      code: err?.code,
      raw: err?.raw,
    });

    return res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

export default router;