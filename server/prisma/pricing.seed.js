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

// Helper: quick upsert for a (product, tier, currency) price row
async function upsertPrice(p) {
  const {
    product,
    tier,        // "T1" | "T2" | "T3" | "T4" | "ROW"
    currency,    // e.g. "USD"
    unitAmount,  // in minor units
    stripePriceId = null,
    appleSku = null,
    googleSku = null,
  } = p;

  await prisma.price.upsert({
    where: { product_tier_currency: { product, tier, currency } },
    create: { active: true, product, tier, currency, unitAmount, stripePriceId, appleSku, googleSku },
    update: { active: true, unitAmount, stripePriceId, appleSku, googleSku },
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

  // 2) Price matrices for three app subscription products:
  //    - chatforia_plus            (entry plan)
  //    - chatforia_premium_monthly (full premium monthly)
  //    - chatforia_premium_annual  (discounted annual)
  //
  // NOTE: unitAmount is in the *smallest currency unit*.
  // Replace stripePriceId with your real live price IDs from Stripe.

  const PLUS = 'chatforia_plus';
  const PREMIUM_M = 'chatforia_premium_monthly';
  const PREMIUM_Y = 'chatforia_premium_annual';

  // --- T1 currencies we’ll support ---
  const T1 = [
    // currency,  plus, premium_m, premium_y
    ['USD',   499,   2499, 22500,  'price_live_plus_t1_usd',   'price_live_premM_t1_usd',   'price_live_premY_t1_usd'  ],
    ['EUR',   499,   2499, 22500,  'price_live_plus_t1_eur',   'price_live_premM_t1_eur',   'price_live_premY_t1_eur'  ],
    ['GBP',   449,   2199, 19900,  'price_live_plus_t1_gbp',   'price_live_premM_t1_gbp',   'price_live_premY_t1_gbp'  ],
    ['AUD',   799,   3499, 31500,  'price_live_plus_t1_aud',   'price_live_premM_t1_aud',   'price_live_premY_t1_aud'  ],
    ['JPY',   600,   3200, 28800,  'price_live_plus_t1_jpy',   'price_live_premM_t1_jpy',   'price_live_premY_t1_jpy'  ],
    ['CAD',   599,   2999, 27000,  'price_live_plus_t1_cad',   'price_live_premM_t1_cad',   'price_live_premY_t1_cad'  ],
    ['CHF',   499,   2499, 22500,  'price_live_plus_t1_chf',   'price_live_premM_t1_chf',   'price_live_premY_t1_chf'  ],
    ['SEK',   5900,  24900,225000, 'price_live_plus_t1_sek',   'price_live_premM_t1_sek',   'price_live_premY_t1_sek'  ],
    ['NOK',   5900,  24900,225000, 'price_live_plus_t1_nok',   'price_live_premM_t1_nok',   'price_live_premY_t1_nok'  ],
    ['DKK',   3900,  17900,159000, 'price_live_plus_t1_dkk',   'price_live_premM_t1_dkk',   'price_live_premY_t1_dkk'  ],
    ['SGD',   690,   2990, 26900,  'price_live_plus_t1_sgd',   'price_live_premM_t1_sgd',   'price_live_premY_t1_sgd'  ],
    ['KRW',   6500,  33000,300000, 'price_live_plus_t1_krw',   'price_live_premM_t1_krw',   'price_live_premY_t1_krw'  ],
  ];

  // --- T2 currencies ---
  const T2 = [
    ['EUR',   399,   1999, 17900,  'price_live_plus_t2_eur',   'price_live_premM_t2_eur',   'price_live_premY_t2_eur'  ],
    ['PLN',   1499,  2999, 26900,  'price_live_plus_t2_pln',   'price_live_premM_t2_pln',   'price_live_premY_t2_pln'  ],
    ['MXN',   6900,  12900,115000, 'price_live_plus_t2_mxn',   'price_live_premM_t2_mxn',   'price_live_premY_t2_mxn'  ],
    ['ZAR',   5900,  10900,99000,  'price_live_plus_t2_zar',   'price_live_premM_t2_zar',   'price_live_premY_t2_zar'  ],
  ];

  // --- T3 currencies ---
  const T3 = [
    ['INR',   19900, 39900,359000, 'price_live_plus_t3_inr',   'price_live_premM_t3_inr',   'price_live_premY_t3_inr'  ],
    ['BRL',   990,   1990, 17900,  'price_live_plus_t3_brl',   'price_live_premM_t3_brl',   'price_live_premY_t3_brl'  ],
    ['PHP',   7900,  14900,135000, 'price_live_plus_t3_php',   'price_live_premM_t3_php',   'price_live_premY_t3_php'  ],
    ['THB',   5900,  12900,115000, 'price_live_plus_t3_thb',   'price_live_premM_t3_thb',   'price_live_premY_t3_thb'  ],
    ['IDR',   59000, 129000,1150000,'price_live_plus_t3_idr',  'price_live_premM_t3_idr',   'price_live_premY_t3_idr'  ],
    ['TRY',   9900,  19900,179000, 'price_live_plus_t3_try',   'price_live_premM_t3_try',   'price_live_premY_t3_try'  ],
    ['COP',   19900, 39900,359000, 'price_live_plus_t3_cop',   'price_live_premM_t3_cop',   'price_live_premY_t3_cop'  ],
    ['PEN',   1490,  2990, 26900,  'price_live_plus_t3_pen',   'price_live_premM_t3_pen',   'price_live_premY_t3_pen'  ],
  ];

  // --- T4 currencies ---
  const T4 = [
    ['NGN',   69000, 120000,1080000,'price_live_plus_t4_ngn',  'price_live_premM_t4_ngn',   'price_live_premY_t4_ngn'  ],
    ['EGP',   4900,  7900,  69900,  'price_live_plus_t4_egp',  'price_live_premM_t4_egp',   'price_live_premY_t4_egp'  ],
    ['KES',   14900, 29900, 269000, 'price_live_plus_t4_kes',  'price_live_premM_t4_kes',   'price_live_premY_t4_kes'  ],
    ['PKR',   14900, 29900, 269000, 'price_live_plus_t4_pkr',  'price_live_premM_t4_pkr',   'price_live_premY_t4_pkr'  ],
    ['BDT',   39900, 79900, 719000, 'price_live_plus_t4_bdt',  'price_live_premM_t4_bdt',   'price_live_premY_t4_bdt'  ],
  ];

  // --- ROW fallback (USD) for each subscription product ---
  const ROW = [
    // currency, plus, premium_m, premium_y
    ['USD', 499, 2499, 22500, 'price_live_plus_row_usd', 'price_live_premM_row_usd', 'price_live_premY_row_usd'],
  ];

  // Helper to seed a tier list
  async function seedTierRows(tier, rows) {
    for (const [currency, plusAmt, premMAmt, premYAmt, plusId, premMId, premYId] of rows) {
      await upsertPrice({ product: PLUS,      tier, currency, unitAmount: plusAmt,  stripePriceId: plusId });
      await upsertPrice({ product: PREMIUM_M, tier, currency, unitAmount: premMAmt, stripePriceId: premMId });
      await upsertPrice({ product: PREMIUM_Y, tier, currency, unitAmount: premYAmt, stripePriceId: premYId });
    }
  }

  await seedTierRows('T1', T1);
  await seedTierRows('T2', T2);
  await seedTierRows('T3', T3);
  await seedTierRows('T4', T4);
  await seedTierRows('ROW', ROW);

  // 3) Tiered pricing for Mobile & Family packs
  //    Tiers:
  //    - ROW  : global default
  //    - T1   : high-income
  //    - T2   : mid-high (slight discount vs T1)
  //    - T3   : emerging (INR pricing)
  //    - T4   : lower-income (biggest discount vs T1)

  // --- MOBILE PACKS (single-user eSIM data) ---

  const MOBILE_PACKS = [
    // product,                 tier,  currency, unitAmount (minor units)

    // ROW fallback – same as US retail pricing
    ['chatforia_mobile_small',  'ROW', 'USD',  999],  // $9.99
    ['chatforia_mobile_medium', 'ROW', 'USD', 1499],  // $14.99
    ['chatforia_mobile_large',  'ROW', 'USD', 2499],  // $24.99

    // T1 – high-income regions (US/CA/UK/etc.) – same as ROW for now
    ['chatforia_mobile_small',  'T1',  'USD',  999],
    ['chatforia_mobile_medium', 'T1',  'USD', 1499],
    ['chatforia_mobile_large',  'T1',  'USD', 2499],

    // T2 – mid-high income (slightly cheaper than T1)
    ['chatforia_mobile_small',  'T2',  'USD',  899],  // $8.99
    ['chatforia_mobile_medium', 'T2',  'USD', 1299],  // $12.99
    ['chatforia_mobile_large',  'T2',  'USD', 1999],  // $19.99

    // T3 – emerging markets: INR pricing (cheapest in local currency)
    ['chatforia_mobile_small',  'T3',  'INR', 199],   // ₹199
    ['chatforia_mobile_medium', 'T3',  'INR', 449],   // ₹449
    ['chatforia_mobile_large',  'T3',  'INR', 599],   // ₹599

    // T4 – lowest-income: bigger USD discount
    ['chatforia_mobile_small',  'T4',  'USD',  599],  // $5.99
    ['chatforia_mobile_medium', 'T4',  'USD',  999],  // $9.99
    ['chatforia_mobile_large',  'T4',  'USD', 1499],  // $14.99
  ];

  for (const [product, tier, currency, unitAmount] of MOBILE_PACKS) {
    await upsertPrice({ product, tier, currency, unitAmount });
  }

  // --- FAMILY PACKS (shared data pool) ---

  const FAMILY_PACKS = [
    // product,                 tier,  currency, unitAmount (minor units)

    // ROW fallback – same as “headline” USD prices on the site
    ['chatforia_family_small',  'ROW', 'USD', 2999],  // $29.99
    ['chatforia_family_medium', 'ROW', 'USD', 4999],  // $49.99
    ['chatforia_family_large',  'ROW', 'USD', 7999],  // $79.99

    // T1 – high-income (same as ROW for now)
    ['chatforia_family_small',  'T1',  'USD', 2999],
    ['chatforia_family_medium', 'T1',  'USD', 4999],
    ['chatforia_family_large',  'T1',  'USD', 7999],

    // T2 – mid-high income (moderate discount)
    ['chatforia_family_small',  'T2',  'USD', 2499],  // $24.99
    ['chatforia_family_medium', 'T2',  'USD', 4499],  // $44.99
    ['chatforia_family_large',  'T2',  'USD', 6999],  // $69.99

    // T3 – emerging markets (INR, much lower)
    ['chatforia_family_small',  'T3',  'INR',  499],  // ₹499
    ['chatforia_family_medium', 'T3',  'INR',  999],  // ₹999
    ['chatforia_family_large',  'T3',  'INR', 1499],  // ₹1499

    // T4 – lowest-income: deepest USD discount
    ['chatforia_family_small',  'T4',  'USD', 1499],  // $14.99
    ['chatforia_family_medium', 'T4',  'USD', 2499],  // $24.99
    ['chatforia_family_large',  'T4',  'USD', 3999],  // $39.99
  ];

  for (const [product, tier, currency, unitAmount] of FAMILY_PACKS) {
    await upsertPrice({ product, tier, currency, unitAmount });
  }

  console.log('✅ Pricing seeds completed for Plus/Premium + tiered Mobile & Family packs.');
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
