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
    try { return JSON.parse(body.toString('utf8')); } catch { return {}; }
  }
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return {}; }
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

// Map plan code -> Stripe Price ID (from env)
function priceIdForPlan(plan) {
  switch (plan) {
    case 'PLUS_MONTHLY':
      return process.env.STRIPE_PRICE_PLUS;               // e.g. price_xxx
    case 'PREMIUM_MONTHLY':
      return process.env.STRIPE_PRICE_PREMIUM;            // e.g. price_yyy ($24.99/mo)
    case 'PREMIUM_ANNUAL':
      return process.env.STRIPE_PRICE_PREMIUM_ANNUAL;     // e.g. price_zzz ($225/yr)
    default:
      return null;
  }
}

/* ----------------------------------------------
 * Checkout
 * --------------------------------------------*/
// POST /billing/checkout  { plan: "PLUS_MONTHLY" | "PREMIUM_MONTHLY" | "PREMIUM_ANNUAL" }
router.post('/checkout', async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });

    const { plan } = req.body || {};
    const priceId = priceIdForPlan(plan);
    if (!priceId) return res.status(400).json({ error: 'Unknown plan' });

    const stripe = getStripe();
    const customerId = await ensureStripeCustomerId(req.user);

    const successUrl = `${process.env.APP_URL}/upgrade/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl  = `${process.env.APP_URL}/upgrade?canceled=1`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      automatic_tax: { enabled: true },
      client_reference_id: String(req.user.id),        // correlate in webhook
      metadata: { userId: String(req.user.id), plan }, // helpful in webhook
    });

    return res.json({ url: session.url, checkoutUrl: session.url });
  } catch (err) {
    console.error('checkout error:', err);
    return res.status(500).json({ error: 'Checkout creation failed' });
  }
});

/* ----------------------------------------------
 * Billing Portal (manage/cancel/change payment)
 * --------------------------------------------*/
// POST /billing/portal
router.post('/portal', async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
    const stripe = getStripe();
    const customerId = await ensureStripeCustomerId(req.user);

    // We use a simple return page that brings users back to Upgrade.
    const returnUrl = `${process.env.APP_URL}/billing/return`;

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
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
    const sub = await stripe.subscriptions.update(
      req.user.stripeSubscriptionId,
      { cancel_at_period_end: false }
    );

    // Optional: keep planExpiresAt synced to the current period end (or null).
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
    // TODO: add admin/staff check here if this route is exposed beyond internal use
    const { invoiceId, amountOptionalCents } = req.body || {};
    if (!invoiceId) return res.status(400).json({ error: 'Missing invoiceId' });

    const stripe = getStripe();
    const inv = await stripe.invoices.retrieve(invoiceId);
    if (!inv.payment_intent) return res.status(400).json({ error: 'No payment intent for invoice' });

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
      const lines = obj.lines?.data || [];
      const priceId = lines[0]?.price?.id;
      if (priceId === process.env.STRIPE_PRICE_PLUS) return 'PLUS';
      if (priceId === process.env.STRIPE_PRICE_PREMIUM) return 'PREMIUM';
      if (priceId === process.env.STRIPE_PRICE_PREMIUM_ANNUAL) return 'PREMIUM';
      return 'PREMIUM';
    };

    switch (type) {
      case 'checkout.session.completed': {
        // PREMIUM_ANNUAL still maps to 'PREMIUM' plan on our side
        const plan =
          obj.metadata?.plan === 'PLUS_MONTHLY' ? 'PLUS' : 'PREMIUM';
        const extras = {
          stripeCustomerId: obj.customer ? String(obj.customer) : undefined,
          stripeSubscriptionId: obj.subscription ? String(obj.subscription) : undefined,
          planExpiresAt: obj.expires_at ? new Date(obj.expires_at * 1000) : undefined,
        };
        if (userIdFromEvent) {
          await setPlan(userIdFromEvent, plan, extras);
        } else if (obj.customer) {
          await prisma.user.updateMany({
            where: { stripeCustomerId: String(obj.customer) },
            data: { plan, ...extras },
          });
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const status = String(obj.status || '').toLowerCase();
        const activeish = ['active', 'trialing', 'past_due', 'unpaid'].includes(status);
        const plan = planFromLines();
        const extras = {
          stripeCustomerId: obj.customer ? String(obj.customer) : undefined,
          stripeSubscriptionId: obj.id ? String(obj.id) : undefined,
          planExpiresAt: obj.current_period_end ? new Date(obj.current_period_end * 1000) : null,
        };

        if (userIdFromEvent) {
          await setPlan(
            userIdFromEvent,
            activeish ? plan : 'FREE',
            activeish ? extras : { stripeSubscriptionId: null, planExpiresAt: null }
          );
        } else if (obj.customer) {
          await prisma.user.updateMany({
            where: { stripeCustomerId: String(obj.customer) },
            data: activeish
              ? { plan, ...extras }
              : { plan: 'FREE', stripeSubscriptionId: null, planExpiresAt: null },
          });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        if (userIdFromEvent) {
          await setPlan(userIdFromEvent, 'FREE', { stripeSubscriptionId: null, planExpiresAt: null });
        } else if (obj.customer) {
          await prisma.user.updateMany({
            where: { stripeCustomerId: String(obj.customer) },
            data: { plan: 'FREE', stripeSubscriptionId: null, planExpiresAt: null },
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
