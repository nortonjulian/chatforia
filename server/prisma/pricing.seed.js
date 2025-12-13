// Prereqs in your Prisma schema:
// 1) model RegionRule { countryCode String @id @db.VarChar(2) tier String }
// 2) model Price {
//      id            Int     @id @default(autoincrement())
//      product       String
//      tier          String   // e.g. "T1" | "T2" | "T3" | "T4" | "ROW"
//      currency      String
//      unitAmount    Int      // smallest currency unit
//      active        Boolean  @default(true)
//      stripePriceId String?
//      appleSku      String?
//      googleSku     String?
//      @@unique([product, tier, currency], name: "product_tier_currency")
//    }

import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';

const prisma = new PrismaClient();

/**
 * Helper: upsert for a (product, tier, currency) price row
 */
async function upsertPrice(p) {
  const {
    product,
    tier,        // "T1" | "T2" | "T3" | "T4" | "ROW"
    currency,    // e.g. "USD"
    unitAmount,  // in minor units
    active = true,
    stripePriceId = null,
    appleSku = null,
    googleSku = null,
  } = p;

  await prisma.price.upsert({
    where: { product_tier_currency: { product, tier, currency } },
    create: { active, product, tier, currency, unitAmount, stripePriceId, appleSku, googleSku },
    update: { active, unitAmount, stripePriceId, appleSku, googleSku },
  });
}

/**
 * Money helpers
 */
function dollarsToMinor(dollars) {
  // USD only for now; when we add currencies later, we’ll swap per-currency divisors.
  return Math.round(Number(dollars) * 100);
}

function applyDiscountMinor(amountMinor, discountPct) {
  const mult = 1 - (discountPct / 100);
  return Math.round(amountMinor * mult);
}

/**
 * Keep "nice" endings like .99 when converting/discounting.
 * This takes a minor-unit integer (cents) and forces it to end in 99 cents (if >= $1).
 */
function force99(amountMinor) {
  const cents = amountMinor % 100;
  const dollars = Math.floor(amountMinor / 100);
  if (dollars <= 0) return amountMinor; // don’t mess with tiny values
  return dollars * 100 + 99;
}

/**
 * Optional: deactivate legacy products so they don’t show up in DB queries if you list prices.
 * (Safe even if those rows don’t exist.)
 */
async function deactivateLegacyProducts() {
  const legacyPrefixes = [
    'chatforia_mobile_', // old single-user packs
    'chatforia_family_', // old shared packs
  ];

  await prisma.price.updateMany({
    where: {
      OR: legacyPrefixes.map((prefix) => ({
        product: { startsWith: prefix },
      })),
    },
    data: { active: false },
  });
}

export async function seedPricing() {
  // 1) Region rules (country -> tier). Extend as needed.
  const regionEntries = [
    // T1: high income
    { countryCode: 'US', tier: 'T1' },
    { countryCode: 'CA', tier: 'T1' },
    { countryCode: 'GB', tier: 'T1' },
    { countryCode: 'IE', tier: 'T1' },
    { countryCode: 'DE', tier: 'T1' },
    { countryCode: 'FR', tier: 'T1' },
    { countryCode: 'NL', tier: 'T1' },
    { countryCode: 'SE', tier: 'T1' },
    { countryCode: 'NO', tier: 'T1' },
    { countryCode: 'DK', tier: 'T1' },
    { countryCode: 'FI', tier: 'T1' },
    { countryCode: 'CH', tier: 'T1' },
    { countryCode: 'AU', tier: 'T1' },
    { countryCode: 'NZ', tier: 'T1' },
    { countryCode: 'JP', tier: 'T1' },
    { countryCode: 'KR', tier: 'T1' },
    { countryCode: 'SG', tier: 'T1' },

    // T2: mid-high
    { countryCode: 'PL', tier: 'T2' },
    { countryCode: 'CZ', tier: 'T2' },
    { countryCode: 'PT', tier: 'T2' },
    { countryCode: 'ES', tier: 'T2' },
    { countryCode: 'IT', tier: 'T2' },
    { countryCode: 'ZA', tier: 'T2' },
    { countryCode: 'MX', tier: 'T2' },
    { countryCode: 'CL', tier: 'T2' },
    { countryCode: 'AR', tier: 'T2' },
    { countryCode: 'AE', tier: 'T2' },

    // T3: large emerging
    { countryCode: 'BR', tier: 'T3' },
    { countryCode: 'PH', tier: 'T3' },
    { countryCode: 'TH', tier: 'T3' },
    { countryCode: 'VN', tier: 'T3' },
    { countryCode: 'ID', tier: 'T3' },
    { countryCode: 'TR', tier: 'T3' },
    { countryCode: 'CO', tier: 'T3' },
    { countryCode: 'PE', tier: 'T3' },

    // T4: lower income
    { countryCode: 'NG', tier: 'T4' },
    { countryCode: 'KE', tier: 'T4' },
    { countryCode: 'EG', tier: 'T4' },
    { countryCode: 'PK', tier: 'T4' },
    { countryCode: 'BD', tier: 'T4' },
  ];

  await Promise.all(
    regionEntries.map((r) =>
      prisma.regionRule.upsert({
        where: { countryCode: r.countryCode },
        create: r,
        update: { tier: r.tier },
      })
    )
  );

  // 2) App subscription products (unchanged)
  const PLUS = 'chatforia_plus';
  const PREMIUM_M = 'chatforia_premium_monthly';
  const PREMIUM_Y = 'chatforia_premium_annual';

  const T1 = [
    [
      'USD',
      499,
      2499,
      22500,
      null,
      null,
      null,
    ],
    ['EUR', 499, 2499, 22500, null, null, null],
    ['GBP', 449, 2199, 19900, null, null, null],
    ['AUD', 799, 3499, 31500, null, null, null],
    ['JPY', 600, 3200, 28800, null, null, null],
    ['CAD', 599, 2999, 27000, null, null, null],
    ['CHF', 499, 2499, 22500, null, null, null],
    ['SEK', 5900, 24900, 225000, null, null, null],
    ['NOK', 5900, 24900, 225000, null, null, null],
    ['DKK', 3900, 17900, 159000, null, null, null],
    ['SGD', 690, 2990, 26900, null, null, null],
    ['KRW', 6500, 33000, 300000, null, null, null],
  ];

  const T2 = [
    ['EUR', 399, 1999, 17900, null, null, null],
    ['PLN', 1499, 2999, 26900, null, null, null],
    ['MXN', 6900, 12900, 115000, null, null, null],
    ['ZAR', 5900, 10900, 99000, null, null, null],
  ];

  const T3 = [
    ['INR', 19900, 39900, 359000, null, null, null],
    ['BRL', 990, 1990, 17900, null, null, null],
    ['PHP', 7900, 14900, 135000, null, null, null],
    ['THB', 5900, 12900, 115000, null, null, null],
    ['IDR', 59000, 129000, 1150000, null, null, null],
    ['TRY', 9900, 19900, 179000, null, null, null],
    ['COP', 19900, 39900, 359000, null, null, null],
    ['PEN', 1490, 2990, 26900, null, null, null],
  ];

  const T4 = [
    ['NGN', 69000, 120000, 1080000, null, null, null],
    ['EGP', 4900, 7900, 69900, null, null, null],
    ['KES', 14900, 29900, 269000, null, null, null],
    ['PKR', 14900, 29900, 269000, null, null, null],
    ['BDT', 39900, 79900, 719000, null, null, null],
  ];

  const ROW = [
    [
      'USD',
      499,
      2499,
      22500,
      null,
      null,
      null,
    ],
  ];

  async function seedTierRows(tier, rows) {
    for (const [currency, plusAmt, premMAmt, premYAmt, plusId, premMId, premYId] of rows) {
      await upsertPrice({ product: PLUS, tier, currency, unitAmount: plusAmt, stripePriceId: plusId });
      await upsertPrice({ product: PREMIUM_M, tier, currency, unitAmount: premMAmt, stripePriceId: premMId });
      await upsertPrice({ product: PREMIUM_Y, tier, currency, unitAmount: premYAmt, stripePriceId: premYId });
    }
  }

  await seedTierRows('T1', T1);
  await seedTierRows('T2', T2);
  await seedTierRows('T3', T3);
  await seedTierRows('T4', T4);
  await seedTierRows('ROW', ROW);

  // 3) eSIM packs by COVERAGE SCOPE (Local / Europe / Global)
  //    IMPORTANT RULE: no plans under 3GB.

  // Base “headline” retail prices (ROW + T1), USD.
  // Adjust these anytime; all tier discounts derive from these.
  const ESIM_BASE_ROW_USD = {
    local: {
      '3gb': 9.99,
      '5gb': 14.99,
      '10gb': 24.99,
      '20gb': 44.99,
    },
    europe: {
      '3gb': 14.99,
      '5gb': 24.99,
      '10gb': 44.99,
      // Your earlier point: Europe 20GB cost was 64.99.
      // Setting retail above that so you’re not break-even.
      '20gb': 66.99,
    },
    global: {
      // Global: only offer 3GB and 5GB (no 1GB; no 10/20 for launch)
      '3gb': 19.99,
      '5gb': 29.99,
    },
  };

  // Tier discounts from the ROW/T1 headline prices.
  // You can change these percentages without touching product lists.
  const ESIM_TIER_DISCOUNTS_PCT = {
    ROW: 0,
    T1: 0,
    T2: 10,
    T3: 20,
    T4: 30,
  };

  function productKey(scope, sizeKey) {
    return `chatforia_esim_${scope}_${sizeKey}`;
  }

  function sizeSuffix(sizeKey) {
    // "3gb" -> "3gb" (kept as-is)
    return sizeKey.toLowerCase();
  }

  function buildEsimProductsFromBase() {
    const products = [];

    for (const scope of Object.keys(ESIM_BASE_ROW_USD)) {
      const sizes = ESIM_BASE_ROW_USD[scope];

      for (const sizeKey of Object.keys(sizes)) {
        // enforce minimum 3GB (in case someone adds 1gb later by mistake)
        if (String(sizeKey).includes('1gb')) continue;

        const baseDollars = sizes[sizeKey];
        const baseMinor = dollarsToMinor(baseDollars);

        // seed for each tier in USD
        for (const tier of Object.keys(ESIM_TIER_DISCOUNTS_PCT)) {
          const discountPct = ESIM_TIER_DISCOUNTS_PCT[tier] || 0;
          let amt = applyDiscountMinor(baseMinor, discountPct);
          amt = force99(amt);

          products.push({
            product: productKey(scope, sizeSuffix(sizeKey)),
            tier,
            currency: 'USD',
            unitAmount: amt,
            active: true,
            stripePriceId: null, // Stripe later
          });
        }
      }
    }

    return products;
  }

  // Deactivate legacy packs so you don’t accidentally show them
  await deactivateLegacyProducts();

  // Insert new eSIM scope packs
  const ESIM_PACKS = buildEsimProductsFromBase();
  for (const p of ESIM_PACKS) {
    await upsertPrice(p);
  }

  console.log('✅ Pricing seeds completed for Plus/Premium + eSIM scope packs (Local/Europe/Global).');
}

const isMain = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isMain) {
  seedPricing()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
