import { PrismaClient, RegionTier } from '@prisma/client';

const prisma = new PrismaClient();

async function upsertPrice({ product, tier, currency, unitAmount, stripePriceId = null }) {
  return prisma.price.upsert({
    where: {
      product_tier_currency: { product, tier, currency },
    },
    update: {
      unitAmount,
      stripePriceId,
      active: true,
    },
    create: {
      product,
      tier,
      currency,
      unitAmount,
      stripePriceId,
      active: true,
    },
  });
}

async function main() {
  //
  // --------------------------------------------------------------------
  //  MOBILE PACKS  (Single-User Data Packs)
  // --------------------------------------------------------------------
  //

  // ROW fallback (global default)
  await upsertPrice({
    product: 'chatforia_mobile_small',
    tier: RegionTier.ROW,
    currency: 'USD',
    unitAmount: 799,
    stripePriceId: null,
  });

  await upsertPrice({
    product: 'chatforia_mobile_medium',
    tier: RegionTier.ROW,
    currency: 'USD',
    unitAmount: 1799,
    stripePriceId: null,
  });

  await upsertPrice({
    product: 'chatforia_mobile_large',
    tier: RegionTier.ROW,
    currency: 'USD',
    unitAmount: 2499,
    stripePriceId: null,
  });

  // T1 (US / CA / rich EU cluster)
  await upsertPrice({
    product: 'chatforia_mobile_small',
    tier: RegionTier.T1,
    currency: 'USD',
    unitAmount: 799,
    stripePriceId: null,
  });

  await upsertPrice({
    product: 'chatforia_mobile_medium',
    tier: RegionTier.T1,
    currency: 'USD',
    unitAmount: 1799,
    stripePriceId: null,
  });

  await upsertPrice({
    product: 'chatforia_mobile_large',
    tier: RegionTier.T1,
    currency: 'USD',
    unitAmount: 2499,
    stripePriceId: null,
  });

  // T3 (India / SEA / Africa value pricing)
  await upsertPrice({
    product: 'chatforia_mobile_small',
    tier: RegionTier.T3,
    currency: 'INR',
    unitAmount: 199,
    stripePriceId: null,
  });

  await upsertPrice({
    product: 'chatforia_mobile_medium',
    tier: RegionTier.T3,
    currency: 'INR',
    unitAmount: 449,
    stripePriceId: null,
  });

  await upsertPrice({
    product: 'chatforia_mobile_large',
    tier: RegionTier.T3,
    currency: 'INR',
    unitAmount: 599,
    stripePriceId: null,
  });

  //
  // --------------------------------------------------------------------
  //  FAMILY PACKS  (Shared Data Pool Packs)
  // --------------------------------------------------------------------
  //

  // ROW fallback (global default)
  await upsertPrice({
    product: 'chatforia_family_small',    // ~5 GB
    tier: RegionTier.ROW,
    currency: 'USD',
    unitAmount: 1499,                     // $14.99
    stripePriceId: null,
  });

  await upsertPrice({
    product: 'chatforia_family_medium',   // ~15 GB
    tier: RegionTier.ROW,
    currency: 'USD',
    unitAmount: 2999,                     // $29.99
    stripePriceId: null,
  });

  await upsertPrice({
    product: 'chatforia_family_large',    // ~30 GB
    tier: RegionTier.ROW,
    currency: 'USD',
    unitAmount: 4999,                     // $49.99
    stripePriceId: null,
  });

  // T1 — same pricing for now (easy to change later)
  await upsertPrice({
    product: 'chatforia_family_small',
    tier: RegionTier.T1,
    currency: 'USD',
    unitAmount: 1499,
    stripePriceId: null,
  });

  await upsertPrice({
    product: 'chatforia_family_medium',
    tier: RegionTier.T1,
    currency: 'USD',
    unitAmount: 2999,
    stripePriceId: null,
  });

  await upsertPrice({
    product: 'chatforia_family_large',
    tier: RegionTier.T1,
    currency: 'USD',
    unitAmount: 4999,
    stripePriceId: null,
  });

  // T3 — lower-cost regions
  await upsertPrice({
    product: 'chatforia_family_small',
    tier: RegionTier.T3,
    currency: 'INR',
    unitAmount: 499,     // ₹499 (~$6)
    stripePriceId: null,
  });

  await upsertPrice({
    product: 'chatforia_family_medium',
    tier: RegionTier.T3,
    currency: 'INR',
    unitAmount: 999,     // ₹999 (~$12)
    stripePriceId: null,
  });

  await upsertPrice({
    product: 'chatforia_family_large',
    tier: RegionTier.T3,
    currency: 'INR',
    unitAmount: 1499,    // ₹1499 (~$18)
    stripePriceId: null,
  });

  console.log('Seeded Chatforia Mobile + Family Shared Data prices ✅');
}

main()
  .catch((e) => {
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
