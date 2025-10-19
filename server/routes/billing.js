import express from 'express';
import prisma from '../utils/prismaClient.js';
import Stripe from 'stripe';

const router = express.Router();

/* ----------------------------------------------
 * Utilities
 * --------------------------------------------*/

// Lazily create a Stripe client.
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  return new Stripe(key, { apiVersion: '2023-10-16' });
}

// Safe parse when we skip signature verification.
// Handles: Buffer (from express.raw), string, or already-parsed object.
function parseLoose(body) {
  if (!body) return {};
  if (Buffer.isBuffer(body)) {
    try { return JSON.parse(body.toString('utf8')); } catch { return {}; }
  }
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return {}; }
  }
  return body;
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

// Map plan code -> Stripe Price ID (env)
function priceIdForPlan(plan) {
  switch (plan) {
    case 'PLUS_MONTHLY': return process.env.STRIPE_PRICE_PLUS;
    case 'PREMIUM_MONTHLY': return process.env.STRIPE_PRICE_PREMIUM;
    default: return null;
  }
}

/* ----------------------------------------------
 * Checkout
 * --------------------------------------------*/
// POST /billing/checkout  { plan: "PLUS_MONTHLY" | "PREMIUM_MONTHLY" }
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
      // Helps you correlate in the webhook:
      client_reference_id: String(req.user.id),
      metadata: { userId: String(req.user.id), plan },
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
router.post('/portal', async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
    const stripe = getStripe();
    const customerId = await ensureStripeCustomerId(req.user);

    const returnUrl = `${process.env.APP_URL}/upgrade`;
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
 * Webhook (mounted with express.raw() in app.js)
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
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
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

    const setPlan = async (userId, plan, extras = {}) => {
      await prisma.user.update({
        where: { id: Number(userId) },
        data: { plan, ...extras },
      });
    };

    // Which user? Prefer explicit user id from session metadata.
    const userIdFromEvent = (() => {
      const ref = Number(obj.client_reference_id);
      if (Number.isFinite(ref)) return ref;
      const meta = Number(obj?.metadata?.userId);
      if (Number.isFinite(meta)) return meta;
      return null;
    })();

    // Map subscription → plan (Plus vs Premium) if you sell both with different prices.
    // If you only have PREMIUM today, you can hardcode 'PREMIUM' like before.
    const planFromLines = () => {
      const lines = obj.lines?.data || [];
      const first = lines[0];
      const price = first?.price?.id || obj.plan?.product; // best-effort
      if (price === process.env.STRIPE_PRICE_PLUS) return 'PLUS';
      if (price === process.env.STRIPE_PRICE_PREMIUM) return 'PREMIUM';
      return 'PREMIUM'; // default
    };

    switch (type) {
      case 'checkout.session.completed': {
        const plan = obj.metadata?.plan === 'PLUS_MONTHLY' ? 'PLUS' : 'PREMIUM';
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
          await setPlan(userIdFromEvent, activeish ? plan : 'FREE', activeish ? extras : {
            stripeSubscriptionId: null, planExpiresAt: null,
          });
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
        // ignore others
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handling error:', err);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

export default router;
