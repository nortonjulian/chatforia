import express from 'express';
import prisma from '../utils/prismaClient.js';
import Stripe from 'stripe';

const router = express.Router();

/* ----------------------------------------------
 * Utilities
 * --------------------------------------------*/

// Lazily create a Stripe client (only when needed).
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  return new Stripe(key, { apiVersion: '2023-10-16' });
}

// Safe parse when we intentionally skip signature checks in dev/test.
function parseLoose(body) {
  if (!body) return {};
  if (Buffer.isBuffer(body)) {
    try {
      return JSON.parse(body.toString('utf8'));
    } catch {
      return {};
    }
  }
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body; // already parsed object
}

// Ensure the authed user has a Stripe Customer and return its id.
async function ensureStripeCustomerId(user) {
  if (user?.stripeCustomerId) return String(user.stripeCustomerId);
  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: user?.email || undefined,
    metadata: { userId: String(user.id) },
  });
  await prisma.user.update({
    where: { id: Number(user.id) },
    data: { stripeCustomerId: customer.id },
  });
  return customer.id;
}

/* ----------------------------------------------
 * Region-aware product/price helpers (core plans)
 * --------------------------------------------*/

// Map plan -> logical product key in your pricing table
function productForPlan(plan) {
  switch (plan) {
    case 'PLUS_MONTHLY':
      return 'chatforia_plus';
    case 'PREMIUM_MONTHLY':
      return 'chatforia_premium_monthly';
    case 'PREMIUM_ANNUAL':
      return 'chatforia_premium_annual';
    default:
      return null;
  }
}

// Env fallbacks (ROW/USD etc) for core plans
function priceIdForPlan(plan) {
  switch (plan) {
    case 'PLUS_MONTHLY':
      return process.env.STRIPE_PRICE_PLUS; // e.g. price_xxx
    case 'PREMIUM_MONTHLY':
      return process.env.STRIPE_PRICE_PREMIUM_MONTHLY; // e.g. price_yyy ($24.99/mo)
    case 'PREMIUM_ANNUAL':
      return process.env.STRIPE_PRICE_PREMIUM_ANNUAL; // e.g. price_zzz ($225/yr)
    default:
      return null;
  }
}

// Resolve a Stripe price_... from DB by (product, tier, currency) for this user
async function resolveStripePriceIdForUserPlan(user, plan, opts = {}) {
  const product = productForPlan(plan);
  if (!product) return null;

  const COUNTRY_CURRENCY = {
    US: 'USD',
    CA: 'CAD',
    GB: 'GBP',
    IE: 'EUR',
    DE: 'EUR',
    FR: 'EUR',
    NL: 'EUR',
    SE: 'SEK',
    NO: 'NOK',
    DK: 'DKK',
    FI: 'EUR',
    CH: 'CHF',
    AU: 'AUD',
    NZ: 'NZD',
    JP: 'JPY',
    KR: 'KRW',
    SG: 'SGD',
    PL: 'PLN',
    CZ: 'CZK',
    PT: 'EUR',
    ES: 'EUR',
    IT: 'EUR',
    ZA: 'ZAR',
    MX: 'MXN',
    CL: 'CLP',
    AR: 'ARS',
    AE: 'AED',
    IN: 'INR',
    BR: 'BRL',
    PH: 'PHP',
    TH: 'THB',
    VN: 'VND',
    ID: 'IDR',
    TR: 'TRY',
    CO: 'COP',
    PE: 'PEN',
    NG: 'NGN',
    KE: 'KES',
    EG: 'EGP',
    PK: 'PKR',
    BD: 'BDT',
  };

  // Determine country/tier/currency similarly to /pricing/quote
  const country = (user?.billingCountry || opts.country || 'US').toUpperCase();

  const rule = await prisma.regionRule.findUnique({ where: { countryCode: country } });
  const tier = user?.pricingRegion || rule?.tier || 'ROW';

  const currency = (user?.currency || COUNTRY_CURRENCY[country] || 'USD').toUpperCase();

  // Primary lookup
  let price = await prisma.price.findUnique({
    where: { product_tier_currency: { product, tier, currency } },
  });
  // Fallback 1: same tier in USD
  if (!price && currency !== 'USD') {
    price = await prisma.price.findUnique({
      where: { product_tier_currency: { product, tier, currency: 'USD' } },
    });
  }
  // Fallback 2: ROW/USD
  if (!price) {
    price = await prisma.price.findUnique({
      where: { product_tier_currency: { product, tier: 'ROW', currency: 'USD' } },
    });
  }
  return price?.stripePriceId || null;
}

/* ----------------------------------------------
 * Add-on config (eSIM + Family data packs)
 * Using Prisma pricing (product column) instead of env prices.
 * --------------------------------------------*/

const ADDON_CONFIG = {
  // eSIM packs (Telna-backed in the future; today just one-time data packs)
  ESIM_STARTER: {
    type: 'ESIM',
    product: 'chatforia_mobile_small',   // matches your Prisma price.product
    providerPlanEnv: 'TELNA_PLAN_ESIM_STARTER', // placeholder for Telna later
    dataMb: 3072, // 3 GB
    daysValid: 30,
  },
  ESIM_TRAVELER: {
    type: 'ESIM',
    product: 'chatforia_mobile_medium',
    providerPlanEnv: 'TELNA_PLAN_ESIM_TRAVELER',
    dataMb: 5120, // 5 GB
    daysValid: 30,
  },
  ESIM_POWER: {
    type: 'ESIM',
    product: 'chatforia_mobile_large',
    providerPlanEnv: 'TELNA_PLAN_ESIM_POWER',
    dataMb: 10240, // 10 GB
    daysValid: 30,
  },

  // Family shared packs
  FAMILY_SMALL: {
    type: 'FAMILY',
    product: 'chatforia_family_small',
    dataMb: 10240, // 10 GB shared
    daysValid: 30,
  },
  FAMILY_MEDIUM: {
    type: 'FAMILY',
    product: 'chatforia_family_medium',
    dataMb: 25600, // 25 GB shared
    daysValid: 30,
  },
  FAMILY_LARGE: {
    type: 'FAMILY',
    product: 'chatforia_family_large',
    dataMb: 51200, // 50 GB shared
    daysValid: 30,
  },
};

// Resolve Stripe price for any add-on using Prisma (same pattern as main plans)
async function getStripePriceIdForAddon(addonKind, user, opts = {}) {
  const cfg = ADDON_CONFIG[addonKind];
  if (!cfg?.product) return null;

  const COUNTRY_CURRENCY = {
    US: 'USD',
    CA: 'CAD',
    GB: 'GBP',
    IE: 'EUR',
    DE: 'EUR',
    FR: 'EUR',
    NL: 'EUR',
    SE: 'SEK',
    NO: 'NOK',
    DK: 'DKK',
    FI: 'EUR',
    CH: 'CHF',
    AU: 'AUD',
    NZ: 'NZD',
    JP: 'JPY',
    KR: 'KRW',
    SG: 'SGD',
    PL: 'PLN',
    CZ: 'CZK',
    PT: 'EUR',
    ES: 'EUR',
    IT: 'EUR',
    ZA: 'ZAR',
    MX: 'MXN',
    CL: 'CLP',
    AR: 'ARS',
    AE: 'AED',
    IN: 'INR',
    BR: 'BRL',
    PH: 'PHP',
    TH: 'THB',
    VN: 'VND',
    ID: 'IDR',
    TR: 'TRY',
    CO: 'COP',
    PE: 'PEN',
    NG: 'NGN',
    KE: 'KES',
    EG: 'EGP',
    PK: 'PKR',
    BD: 'BDT',
  };

  const country = (user?.billingCountry || opts.country || 'US').toUpperCase();
  const rule = await prisma.regionRule.findUnique({ where: { countryCode: country } });
  const tier = user?.pricingRegion || rule?.tier || 'ROW';
  const currency = (user?.currency || COUNTRY_CURRENCY[country] || 'USD').toUpperCase();

  let price = await prisma.price.findUnique({
    where: {
      product_tier_currency: {
        product: cfg.product,
        tier,
        currency,
      },
    },
  });

  if (!price && currency !== 'USD') {
    price = await prisma.price.findUnique({
      where: {
        product_tier_currency: {
          product: cfg.product,
          tier,
          currency: 'USD',
        },
      },
    });
  }

  if (!price) {
    price = await prisma.price.findUnique({
      where: {
        product_tier_currency: {
          product: cfg.product,
          tier: 'ROW',
          currency: 'USD',
        },
      },
    });
  }

  return price?.stripePriceId || null;
}

/* ----------------------------------------------
 * My Plan – return the current user's plan info
 * --------------------------------------------*/
router.get('/my-plan', async (req, res) => {
  try {
    const userId = req.user?.id ? Number(req.user.id) : null;

    // Helper to normalize plan code -> label
    const labelForPlan = (code) => {
      switch ((code || '').toUpperCase()) {
        case 'PLUS':
          return 'Chatforia Plus';
        case 'PREMIUM':
          return 'Chatforia Premium';
        case 'FREE':
        default:
          return 'Chatforia Free';
      }
    };

    let user = null;

    if (userId) {
      user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          plan: true,
          stripeCustomerId: true,
          stripeSubscriptionId: true,
          planExpiresAt: true,
        },
      });
    }

    // If we have no user (not authed, or not found), just treat as Free.
    if (!user) {
      const baseCode = 'FREE';
      return res.json({
        plan: {
          id: null,
          code: baseCode,
          label: labelForPlan(baseCode),
          isFree: true,
          status: 'inactive',
          amount: 0,
          amountFormatted: '0.00',
          currency: null,
          interval: null,
          renewsAt: null,
        },
      });
    }

    const baseCode = (user.plan || 'FREE').toUpperCase();

    const stripeKeyConfigured = !!process.env.STRIPE_SECRET_KEY;
    const hasStripeSub = !!user.stripeSubscriptionId && stripeKeyConfigured;

    // If no subscription OR Stripe not configured yet, return a simple view.
    if (!hasStripeSub) {
      return res.json({
        plan: {
          id: user.stripeSubscriptionId || null,
          code: baseCode,
          label: labelForPlan(baseCode),
          isFree: baseCode === 'FREE',
          status: user.stripeSubscriptionId ? 'active' : 'inactive',
          amount: 0,
          amountFormatted: '0.00',
          currency: null,
          interval: null,
          renewsAt: user.planExpiresAt
            ? user.planExpiresAt.toISOString()
            : null,
        },
      });
    }

    // Full details from Stripe (only if everything is wired)
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(
      user.stripeSubscriptionId,
      { expand: ['items.data.price.product'] }
    );

    const price = sub.items?.data?.[0]?.price;
    const amount = price?.unit_amount ?? 0;
    const currency = price?.currency ?? 'usd';
    const interval = price?.recurring?.interval ?? null;

    let productName = null;
    if (price?.product && typeof price.product === 'object') {
      productName = price.product.name || null;
    }

    const label = productName || labelForPlan(baseCode);

    return res.json({
      plan: {
        id: sub.id,
        code: baseCode,
        label,
        isFree: baseCode === 'FREE',
        status: sub.status,
        amount,
        amountFormatted: amount ? (amount / 100).toFixed(2) : '0.00',
        currency: currency.toUpperCase(),
        interval,
        renewsAt: sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : user.planExpiresAt
          ? user.planExpiresAt.toISOString()
          : null,
      },
    });
  } catch (err) {
    console.error('my-plan error:', err);

    return res.json({
      plan: {
        id: null,
        code: 'FREE',
        label: 'Chatforia Free',
        isFree: true,
        status: 'inactive',
        amount: 0,
        amountFormatted: '0.00',
        currency: null,
        interval: null,
        renewsAt: null,
      },
    });
  }
});

/* ----------------------------------------------
 * Checkout (subscriptions + one-time)
 * --------------------------------------------*/
// POST /billing/checkout  { plan?: "PLUS_MONTHLY"|"PREMIUM_MONTHLY"|"PREMIUM_ANNUAL", priceId?: "price_..." }
router.post('/checkout', async (req, res) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const stripe = getStripe();
  const { plan, priceId } = req.body || {};

  try {
    // 1) Decide which price to use
    let stripePriceId = null;

    if (priceId && typeof priceId === 'string' && priceId.startsWith('price_')) {
      // New flow: client passes explicit Stripe price id
      stripePriceId = priceId;
    } else if (plan) {
      // Preferred flow: derive price from plan + region via DB
      stripePriceId = await resolveStripePriceIdForUserPlan(user, plan);

      // Fallback: env-based price ids if DB is missing
      if (!stripePriceId) {
        stripePriceId = priceIdForPlan(plan);
      }

      if (!stripePriceId) {
        console.error('[billing/checkout] No price for plan', {
          plan,
          userId: user.id,
        });
        return res
          .status(400)
          .json({ error: 'No Stripe price configured for this plan.' });
      }
    }

    if (!stripePriceId) {
      return res
        .status(400)
        .json({ error: 'Missing plan or priceId for checkout.' });
    }

    console.log('[billing/checkout] Using Stripe price:', stripePriceId);

    // 2) Decide if this is a subscription or one-time price
    let isSubscription = false;

    // Prefer explicit plan, since we know which codes are subscriptions
    if (plan) {
      const code = String(plan).toUpperCase();
      isSubscription = ['PLUS_MONTHLY', 'PREMIUM_MONTHLY', 'PREMIUM_ANNUAL'].includes(code);
    } else if (priceId) {
      // No plan provided – inspect the Stripe Price to see if it is recurring
      const priceObj = await stripe.prices.retrieve(stripePriceId);
      isSubscription = !!priceObj.recurring;
    }

    const mode = isSubscription ? 'subscription' : 'payment';

    // 3) Ensure the user has a Stripe customer
    const customerId = await ensureStripeCustomerId(user);

    const frontendOrigin =
      process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

    const session = await stripe.checkout.sessions.create({
      mode,
      customer: customerId,
      line_items: [
        {
          price: stripePriceId,
          quantity: 1,
        },
      ],
      allow_promotion_codes: false,
      client_reference_id: String(user.id),
      success_url: `${frontendOrigin}/upgrade?success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendOrigin}/upgrade?canceled=1`,
    });

    console.log(
      '[billing/checkout] Created session',
      session.id,
      '→',
      session.url
    );

    return res.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error('[billing/checkout] Stripe error:', {
      message: err.message,
      type: err.type,
      code: err.code,
      statusCode: err.statusCode,
      raw: err.raw,
    });

    return res
      .status(500)
      .json({ error: 'Checkout creation failed', detail: err.message });
  }
});

/* ----------------------------------------------
 * Checkout (add-ons: eSIM & Family packs)
 * --------------------------------------------*/
router.post('/checkout-addon', async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { addonKind } = req.body || {};
    if (!addonKind || !ADDON_CONFIG[addonKind]) {
      return res.status(400).json({ error: 'Unknown or missing addonKind' });
    }

    // ✅ IMPORTANT: await the DB lookup, and pass the user
    const priceId = await getStripePriceIdForAddon(addonKind, req.user);
    if (!priceId) {
      console.error('[billing/checkout-addon] No Stripe price configured for', addonKind);
      return res
        .status(500)
        .json({ error: 'Stripe price not configured for this add-on' });
    }

    const stripe = getStripe();
    const customerId = await ensureStripeCustomerId(req.user);

    const frontendOrigin =
      process.env.FRONTEND_ORIGIN ||
      process.env.WEB_URL ||
      'http://localhost:5173';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment', // one-time purchase
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],

      // 🔐 Tax: let Stripe handle it and collect address
      automatic_tax: { enabled: true },
      billing_address_collection: 'auto',
      customer_update: {
        address: 'auto',   // save the address from Checkout to the Customer
      },

      success_url: `${frontendOrigin}/wireless/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendOrigin}/wireless?canceled=1`,
      client_reference_id: String(req.user.id),
      metadata: {
        userId: String(req.user.id),
        addonKind,
        kind: 'ADDON',
      },
    });


    console.log(
      '[billing/checkout-addon] Created session',
      session.id,
      '→',
      session.url
    );

    return res.json({ url: session.url, checkoutUrl: session.url });
  } catch (err) {
    console.error('[billing/checkout-addon] Stripe error:', {
      message: err.message,
      type: err.type,
      code: err.code,
      statusCode: err.statusCode,
      raw: err.raw,
    });

    return res
      .status(500)
      .json({ error: 'Add-on checkout creation failed', detail: err.message });
  }
});

/* ----------------------------------------------
 * Billing Portal (manage/cancel/change payment)
 * --------------------------------------------*/
router.all('/portal', async (req, res) => {
  console.log('🔥 /billing/portal hit', {
    method: req.method,
    user: req.user,
  });

  try {
    if (!req.user?.id) {
      console.log('❌ /billing/portal: no user on req');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const stripe = getStripe();
    const customerId = await ensureStripeCustomerId(req.user);

    const returnUrl = `${process.env.WEB_URL || process.env.FRONTEND_ORIGIN || 'http://localhost:5173'}/billing/return`;

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    // GET  -> redirect to Stripe
    // POST -> return JSON (for axios in UserProfile)
    if (req.method === 'GET') {
      console.log('➡️  /billing/portal GET -> redirect to Stripe');
      return res.redirect(303, portal.url);
    }

    console.log('📦 /billing/portal POST -> JSON');
    return res.json({ url: portal.url, portalUrl: portal.url });
  } catch (err) {
    console.error('portal error:', err);
    return res.status(500).json({ error: 'Portal creation failed' });
  }
});

/* ----------------------------------------------
 * Cancel at period end (opt out of next month)
 * --------------------------------------------*/
// POST /billing/cancel
router.post('/cancel', async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
    const stripe = getStripe();

    const subId = req.user.stripeSubscriptionId;
    if (!subId) return res.status(400).json({ error: 'No active subscription' });

    const sub = await stripe.subscriptions.update(subId, { cancel_at_period_end: true });

    await prisma.user.update({
      where: { id: req.user.id },
      data: { planExpiresAt: new Date(sub.current_period_end * 1000) },
    });

    res.json({ ok: true, currentPeriodEnd: sub.current_period_end });
  } catch (err) {
    console.error('cancel error:', err);
    return res.status(500).json({ error: 'Cancel failed' });
  }
});

/* ----------------------------------------------
 * Un-cancel (keep subscription next month)
 * --------------------------------------------*/
// POST /billing/uncancel
router.post('/uncancel', async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });

    if (!req.user?.stripeSubscriptionId) {
      return res.status(400).json({ error: 'No active subscription' });
    }

    const stripe = getStripe();
    const sub = await stripe.subscriptions.update(req.user.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    await prisma.user.update({
      where: { id: req.user.id },
      data: { planExpiresAt: new Date(sub.current_period_end * 1000) },
    });

    return res.json({ ok: true, currentPeriodEnd: sub.current_period_end });
  } catch (err) {
    console.error('uncancel error:', err);
    return res.status(500).json({ error: 'Uncancel failed' });
  }
});

/* ----------------------------------------------
 * Cancel now (immediate) + optional refund
 * --------------------------------------------*/
// POST /billing/cancel-now
router.post('/cancel-now', async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
    const stripe = getStripe();

    const subId = req.user.stripeSubscriptionId;
    if (!subId) return res.status(400).json({ error: 'No active subscription' });

    const deleted = await stripe.subscriptions.del(subId);

    // Optional: refund the latest invoice
    if (process.env.REFUND_ON_IMMEDIATE_CANCEL === 'true' && deleted.latest_invoice) {
      const inv = await stripe.invoices.retrieve(deleted.latest_invoice);
      if (inv.payment_intent) {
        await stripe.refunds.create({ payment_intent: inv.payment_intent });
      }
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: { plan: 'FREE', stripeSubscriptionId: null, planExpiresAt: null },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('cancel-now error:', err);
    return res.status(500).json({ error: 'Immediate cancel failed' });
  }
});

/* ----------------------------------------------
 * Refund a specific invoice (admin/back-office)
 * --------------------------------------------*/
// POST /billing/refund-invoice   { invoiceId, amountOptionalCents }
router.post('/refund-invoice', async (req, res) => {
  try {
    const { invoiceId, amountOptionalCents } = req.body || {};
    if (!invoiceId) return res.status(400).json({ error: 'Missing invoiceId' });

    const stripe = getStripe();
    const inv = await stripe.invoices.retrieve(invoiceId);
    if (!inv.payment_intent)
      return res.status(400).json({ error: 'No payment intent for invoice' });

    await stripe.refunds.create({
      payment_intent: inv.payment_intent,
      amount: amountOptionalCents || undefined, // full refund if omitted
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('refund-invoice error:', err);
    return res.status(500).json({ error: 'Refund failed' });
  }
});

/* ----------------------------------------------
 * Helper: record add-on purchases (eSIM & Family)
 * --------------------------------------------*/

async function handleAddonCheckoutCompleted({ userId, addonKind, session }) {
  const cfg = ADDON_CONFIG[addonKind];
  if (!cfg) {
    console.warn('Unknown addonKind in webhook:', addonKind);
    return;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + cfg.daysValid * 24 * 60 * 60 * 1000);

  const baseData = {
    userId: Number(userId),
    kind: cfg.type, // "ESIM" | "FAMILY"
    addonKind, // "ESIM_STARTER", "FAMILY_SMALL", etc.
    purchasedAt: now,
    expiresAt,
    totalDataMb: cfg.dataMb,
    remainingDataMb: cfg.dataMb,
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId: session.payment_intent ? String(session.payment_intent) : null,
    tealProfileId: null, // reused column; will store Telna profile id later if desired
    tealIccid: null,
    qrCodeSvg: null,
  };

  // ESIM: Telna provisioning placeholder (NO external call yet).
  if (cfg.type === 'ESIM') {
    try {
      // TODO: Telna API integration.
    } catch (err) {
      console.error('Telna provisioning failed for addon', addonKind, err);
    }
  }

  await prisma.mobileDataPackPurchase.create({ data: baseData });

  // If FAMILY: you can also increase the Family shared pool here (if schema supports it).
}

/* ----------------------------------------------
 * Stripe Webhook (mount with express.raw in app.js)
 * --------------------------------------------*/
router.post('/webhook', async (req, res) => {
  const stripe = getStripe();
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const skipSig =
    process.env.STRIPE_SKIP_SIG_CHECK === 'true' || process.env.NODE_ENV === 'test';
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    if (!skipSig) {
      if (!endpointSecret) return res.status(500).end();
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret); // req.body must be Buffer
    } else {
      event = parseLoose(req.body);
    }
  } catch (_err) {
    // In tests or if parsing fails, fall back to loose parse.
    event = parseLoose(req.body);
  }

  try {
    const obj = event?.data?.object || {};
    const type = event?.type || '';

    // Helper
    const setPlan = async (userId, plan, extras = {}) => {
      await prisma.user.update({
        where: { id: Number(userId) },
        data: { plan, ...extras },
      });
    };

    // Identify user
    const userIdFromEvent = (() => {
      const ref = Number(obj.client_reference_id);
      if (Number.isFinite(ref)) return ref;
      const meta = Number(obj?.metadata?.userId);
      if (Number.isFinite(meta)) return meta;
      return null;
    })();

    // Infer PLUS vs PREMIUM based on price ids (support monthly + annual)
    const planFromLines = () => {
      // Works for invoice.* events
      const lines = obj.lines?.data || [];
      const priceId =
        lines[0]?.price?.id ??
        // Fallbacks for subscription.* objects
        obj.items?.data?.[0]?.price?.id;

      if (priceId === process.env.STRIPE_PRICE_PLUS) return 'PLUS';
      if (priceId === process.env.STRIPE_PRICE_PREMIUM_MONTHLY) return 'PREMIUM';
      if (priceId === process.env.STRIPE_PRICE_PREMIUM_ANNUAL) return 'PREMIUM';
      // Optional: DB lookup could go here if you want perfect mapping
      return 'PREMIUM';
    };

    switch (type) {
      case 'checkout.session.completed': {
        const meta = obj.metadata || {};

        const mode =
          obj.mode ||
          (meta.kind === 'ADDON'
            ? 'payment'
            : obj.subscription
            ? 'subscription'
            : undefined);

        // 1) Add-on one-time purchase (eSIM or Family)
        if (mode === 'payment' && meta.kind === 'ADDON' && meta.addonKind) {
          const addonUserId =
            userIdFromEvent || (meta.userId && Number(meta.userId)) || null;

          if (addonUserId) {
            try {
              await handleAddonCheckoutCompleted({
                userId: addonUserId,
                addonKind: meta.addonKind,
                session: obj,
              });
            } catch (err) {
              console.error('Failed to handle add-on checkout completion:', err);
            }
          } else {
            console.warn(
              'checkout.session.completed for ADDON without userId',
              obj.id
            );
          }
          break;
        }

        // 2) Normal subscription flow (Plus / Premium)
        if (mode === 'subscription') {
          const plan = meta.plan === 'PLUS_MONTHLY' ? 'PLUS' : 'PREMIUM';
          const extras = {
            stripeCustomerId: obj.customer ? String(obj.customer) : undefined,
            stripeSubscriptionId: obj.subscription
              ? String(obj.subscription)
              : undefined,
            planExpiresAt: obj.expires_at
              ? new Date(obj.expires_at * 1000)
              : undefined,
          };
          if (userIdFromEvent) {
            await setPlan(userIdFromEvent, plan, extras);
          } else if (obj.customer) {
            await prisma.user.updateMany({
              where: { stripeCustomerId: String(obj.customer) },
              data: { plan, ...extras },
            });
          }
        }

        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const status = String(obj.status || '').toLowerCase();
        const activeish = ['active', 'trialing', 'past_due', 'unpaid'].includes(
          status
        );
        const plan = planFromLines();
        const extras = {
          stripeCustomerId: obj.customer ? String(obj.customer) : undefined,
          stripeSubscriptionId: obj.id ? String(obj.id) : undefined,
          planExpiresAt: obj.current_period_end
            ? new Date(obj.current_period_end * 1000)
            : null,
        };

        if (userIdFromEvent) {
          await setPlan(
            userIdFromEvent,
            activeish ? plan : 'FREE',
            activeish
              ? extras
              : { stripeSubscriptionId: null, planExpiresAt: null }
          );
        } else if (obj.customer) {
          await prisma.user.updateMany({
            where: { stripeCustomerId: String(obj.customer) },
            data: activeish
              ? { plan, ...extras }
              : {
                  plan: 'FREE',
                  stripeSubscriptionId: null,
                  planExpiresAt: null,
                },
          });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        if (userIdFromEvent) {
          await setPlan(userIdFromEvent, 'FREE', {
            stripeSubscriptionId: null,
            planExpiresAt: null,
          });
        } else if (obj.customer) {
          await prisma.user.updateMany({
            where: { stripeCustomerId: String(obj.customer) },
            data: {
              plan: 'FREE',
              stripeSubscriptionId: null,
              planExpiresAt: null,
            },
          });
        }
        break;
      }

      case 'invoice.paid': {
        const customerId = obj.customer ? String(obj.customer) : null;
        const currentPeriodEnd = obj.lines?.data?.[0]?.period?.end;
        if (customerId && currentPeriodEnd) {
          await prisma.user.updateMany({
            where: { stripeCustomerId: customerId },
            data: { planExpiresAt: new Date(currentPeriodEnd * 1000) },
          });
        }
        break;
      }

      case 'invoice.payment_failed': {
        const customerId = obj.customer ? String(obj.customer) : null;
        if (customerId) {
          await prisma.user.updateMany({
            where: { stripeCustomerId: customerId },
            data: {
              // e.g. billingPastDue: true
            },
          });
        }
        break;
      }

      default:
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handling error:', err);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

export default router;
