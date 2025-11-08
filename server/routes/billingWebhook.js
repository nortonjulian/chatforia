import express from 'express';
import prisma from '../utils/prismaClient.js';
import Stripe from 'stripe';

const router = express.Router();

// We’ll still mount this under /billing in app.js
// IMPORTANT: keep express.raw here so it also works if you ever hit this route directly.
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res, next) => {
    try {
      const skipSig = String(process.env.STRIPE_SKIP_SIG_CHECK || '').toLowerCase() === 'true';
      let event;

      if (skipSig) {
        // Tests post JSON; depending on where json/raw ran, req.body may be:
        // - a Buffer (from express.raw)
        // - already an object (if a previous json() touched it)
        if (Buffer.isBuffer(req.body)) {
          event = JSON.parse(req.body.toString('utf8'));
        } else if (typeof req.body === 'string') {
          event = JSON.parse(req.body);
        } else {
          event = req.body;
        }
      } else {
        // Real signature verification path (works in prod)
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
        const sig = req.headers['stripe-signature'];
        event = stripe.webhooks.constructEvent(
          req.body, // Buffer (express.raw)
          sig,
          process.env.STRIPE_WEBHOOK_SECRET
        );
      }

      const type = event?.type;
      const obj = event?.data?.object || {};

      // Helper to update a user's plan by Stripe customer id or explicit user id
      async function upsertPlanByEvent({ customerId, subscriptionId, plan }) {
        // Prefer explicit metadata userId if present
        const metaUserId = Number(obj?.metadata?.userId);
        if (Number.isFinite(metaUserId)) {
          await prisma.user.update({
            where: { id: metaUserId },
            data: {
              plan,
              stripeCustomerId: customerId ?? undefined,
              stripeSubscriptionId: subscriptionId ?? undefined,
            },
          });
          return;
        }

        // Otherwise, look up by customer id
        if (customerId) {
          await prisma.user.updateMany({
            where: { stripeCustomerId: customerId },
            data: {
              plan,
              stripeSubscriptionId: subscriptionId ?? undefined,
            },
          });
        }
      }

      switch (type) {
        case 'checkout.session.completed': {
          const customerId = obj.customer || null;
          const subId = obj.subscription || null;
          // Tests put the app user id in client_reference_id
          const uid = Number(obj.client_reference_id);
          if (Number.isFinite(uid)) {
            await prisma.user.update({
              where: { id: uid },
              data: {
                plan: 'PREMIUM',
                stripeCustomerId: customerId,
                stripeSubscriptionId: subId,
              },
            });
          } else {
            await upsertPlanByEvent({ customerId, subscriptionId: subId, plan: 'PREMIUM' });
          }
          break;
        }

        case 'customer.subscription.updated': {
          const subStatus = String(obj.status || '').toLowerCase();
          const customerId = obj.customer || null;
          const subId = obj.id || null;

          const activeStates = new Set(['active', 'trialing', 'past_due', 'unpaid']); // treat as paid for UX
          const plan = activeStates.has(subStatus) ? 'PREMIUM' : 'FREE';

          await upsertPlanByEvent({ customerId, subscriptionId: subId, plan });
          break;
        }

        default:
          // No-op for unhandled events
          break;
      }

      return res.status(200).json({ received: true });
    } catch (err) {
      // Surface in tests; return 500 so we see it
      return next(err);
    }
  }
);

export default router;
