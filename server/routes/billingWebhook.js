import express from 'express';
import prisma from '../utils/prismaClient.js';
import Stripe from 'stripe';
import { reserveEsimProfile, topUpLineData } from '../services/providers/tealEsim.js';

const router = express.Router();

// Single Stripe client (used both for webhook verification & listLineItems)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

/**
 * Resolve the Chatforia user for a given Checkout Session.
 * - Prefer metadata.userId or client_reference_id (int)
 * - Fallback to stripeCustomerId lookup
 */
async function resolveUserForCheckoutSession({ customerId, session }) {
  // Try explicit metadata or client_reference_id first
  const rawId = session?.metadata?.userId ?? session?.client_reference_id;
  const uid = Number(rawId);
  if (Number.isFinite(uid)) {
    const user = await prisma.user.findUnique({ where: { id: uid } });
    if (user) {
      // Ensure we remember the Stripe customer id if not set yet
      if (customerId && !user.stripeCustomerId) {
        await prisma.user.update({
          where: { id: user.id },
          data: { stripeCustomerId: String(customerId) },
        });
      }
      return user;
    }
  }

  // Fallback: look up by stored stripeCustomerId
  if (customerId) {
    const user = await prisma.user.findFirst({
      where: { stripeCustomerId: String(customerId) },
    });
    if (user) return user;
  }

  return null;
}

/**
 * Handle a FAMILY pack purchase:
 * - Map product -> GB
 * - Create/ensure FamilyGroup + FamilyMember
 * - Top up totalDataMb
 * - Call Teal stub to allocate data
 */
async function handleFamilyPackPurchase({ user, priceRow }) {
  if (!user) {
    console.warn('Family pack purchase with no resolved user', {
      product: priceRow.product,
      priceId: priceRow.stripePriceId,
    });
    return;
  }

  let addedMb = 0;
  switch (priceRow.product) {
    case 'chatforia_family_small':
      addedMb = 5 * 1024; // 5 GB
      break;
    case 'chatforia_family_medium':
      addedMb = 15 * 1024; // 15 GB
      break;
    case 'chatforia_family_large':
      addedMb = 30 * 1024; // 30 GB
      break;
    default:
      console.warn('Unknown family product', priceRow.product);
      return;
  }

  let group;

  // Does this user already belong to a family?
  const existingMembership = await prisma.familyMember.findFirst({
    where: { userId: user.id },
    include: { group: true },
  });

  if (!existingMembership) {
    // Create a new family group and make the user the owner
    await prisma.$transaction(async (tx) => {
      group = await tx.familyGroup.create({
        data: {
          ownerId: user.id,
          name: `${user.displayName || 'My'} Chatforia Family`,
          totalDataMb: addedMb,
          usedDataMb: 0,
          packProduct: priceRow.product,
        },
      });

      await tx.familyMember.create({
        data: {
          groupId: group.id,
          userId: user.id,
          role: 'OWNER',
          usedDataMb: 0,
          limitDataMb: null,
        },
      });
    });
  } else {
    group = await prisma.familyGroup.update({
      where: { id: existingMembership.group.id },
      data: {
        totalDataMb: { increment: addedMb },
        packProduct: priceRow.product,
      },
    });
  }

  // Call Teal stub (safe no-op until wired)
  try {
    await allocateFamilyDataInTeal({ user, group, addedMb });
  } catch (e) {
    console.error('Teal allocation failed for family pack', e);
    // You might want to set a "needsSync" flag here in the DB
  }
}

/**
 * Handle a MOBILE (single-user) pack purchase.
 * For now this is a stub that just logs; once you have a field such as
 * user.mobileDataMb, you can increment it here similarly to FamilyGroup.
 */
async function handleMobilePackPurchase({ user, priceRow }) {
  if (!user) {
    console.warn('Mobile pack purchase with no resolved user', {
      product: priceRow.product,
      priceId: priceRow.stripePriceId,
    });
    return;
  }

  // Example mapping — adjust once you decide exact MB amounts
  let addedMb = 0;
  switch (priceRow.product) {
    case 'chatforia_mobile_small':
      addedMb = 1 * 1024; // 1 GB
      break;
    case 'chatforia_mobile_medium':
      addedMb = 3 * 1024; // 3 GB
      break;
    case 'chatforia_mobile_large':
      addedMb = 5 * 1024; // 5 GB
      break;
    default:
      console.warn('Unknown mobile product', priceRow.product);
      return;
  }

  // TODO: once you add a field, e.g. user.mobileDataMb, update it here:
  // await prisma.user.update({
  //   where: { id: user.id },
  //   data: { mobileDataMb: { increment: addedMb } },
  // });

  console.log('Mobile pack purchased (stub)', {
    userId: user.id,
    product: priceRow.product,
    addedMb,
  });
}

/**
 * Teal stub: allocate data in Teal for a family.
 * Replace this with real Teal API calls later.
 */
async function allocateFamilyDataInTeal({ user, group, addedMb }) {
  // We treat the family owner’s Teal line as the “anchor” for the shared pool.
  // Later you can move to per-member lines if you want.

  if (!process.env.TEAL_BASE_URL || !process.env.TEAL_API_KEY) {
    console.warn('Teal not configured; skipping Teal allocation');
    return;
  }

  // 1) Ensure we have an ICCID for this user
  let iccid = user.tealIccid;

  if (!iccid) {
    // You can derive region from user.billingCountry, profile, etc.
    const region = user.billingCountry || 'GLOBAL';

    const profile = await reserveEsimProfile({
      userId: user.id,
      region,
    });

    // Adjust these property names to match the Teal response shape
    iccid = profile.iccid || profile.lineIccid;

    if (!iccid) {
      console.warn('Teal reserveEsimProfile did not return an ICCID', profile);
      return;
    }

    // Persist ICCID on the user so future packs just top up
    await prisma.user.update({
      where: { id: user.id },
      data: { tealIccid: iccid },
    });
  }

  // 2) Top up that line with addedMb
  try {
    await topUpLineData({ iccid, mb: addedMb });
    console.log('Teal line topped up for family pack', {
      userId: user.id,
      familyGroupId: group.id,
      iccid,
      addedMb,
    });
  } catch (e) {
    console.error('Teal top-up failed for family pack', {
      userId: user.id,
      familyGroupId: group.id,
      iccid,
      addedMb,
      error: e?.message,
    });
    // Optional: mark group as needing sync
    // await prisma.familyGroup.update({ where: { id: group.id }, data: { needsTealSync: true } });
  }
}


// -------------------- Webhook route --------------------

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
            where: { stripeCustomerId: String(customerId) },
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
          const mode = obj.mode || 'subscription';

          // Resolve the app user (used for family/mobile handling)
          const user = await resolveUserForCheckoutSession({
            customerId,
            session: obj,
          });

          // 1) Handle subscriptions (app plans: Plus/Premium)
          if (mode === 'subscription') {
            // For now, keep your existing logic: treat as PREMIUM.
            // Later you can differentiate PLUS vs PREMIUM based on priceRow.product.
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
              await upsertPlanByEvent({
                customerId,
                subscriptionId: subId,
                plan: 'PREMIUM',
              });
            }
          }

          // 2) Handle one-time products (Family packs + Mobile packs)
          //    We always inspect line items, because a session may include both
          //    a subscription and add-on packs.
          try {
            const lineItems = await stripe.checkout.sessions.listLineItems(obj.id, {
              expand: ['data.price'],
            });

            for (const line of lineItems.data) {
              const priceId = line.price?.id;
              if (!priceId) continue;

              const priceRow = await prisma.price.findUnique({
                where: { stripePriceId: priceId },
              });
              if (!priceRow) continue;

              if (priceRow.product.startsWith('chatforia_family_')) {
                await handleFamilyPackPurchase({ user, priceRow });
              } else if (priceRow.product.startsWith('chatforia_mobile_')) {
                await handleMobilePackPurchase({ user, priceRow });
              }
              // Other products (e.g. plain Plus/Premium prices) are handled by the
              // subscription logic above and can be ignored here.
            }
          } catch (e) {
            console.error('Error handling line items in checkout.session.completed', e);
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
