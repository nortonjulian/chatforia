const appleIapConfig = {
  bundleId: process.env.APPLE_BUNDLE_ID || 'com.chatforia.app',
  environment: (process.env.APPLE_IAP_ENV || 'sandbox').toLowerCase(), // sandbox | production

  products: {
    // Subscriptions
    plus_monthly: {
      productId: 'com.chatforia.plus.monthly',
      kind: 'subscription',
      plan: 'PLUS',
    },
    premium_monthly: {
      productId: 'com.chatforia.premium.monthly',
      kind: 'subscription',
      plan: 'PREMIUM',
    },
    premium_annual: {
      productId: 'com.chatforia.premium.annual',
      kind: 'subscription',
      plan: 'PREMIUM',
    },

    // Add-ons / data packs
    esim_local_3: {
      productId: 'com.chatforia.esim.local.3gb',
      kind: 'addon',
      addonKind: 'chatforia_esim_local_3_premium',
    },
    esim_local_5: {
      productId: 'com.chatforia.esim.local.5gb',
      kind: 'addon',
      addonKind: 'chatforia_esim_local_5_premium',
    },
    esim_local_10: {
      productId: 'com.chatforia.esim.local.10gb',
      kind: 'addon',
      addonKind: 'chatforia_esim_local_10_premium',
    },
    esim_local_20: {
      productId: 'com.chatforia.esim.local.20gb',
      kind: 'addon',
      addonKind: 'chatforia_esim_local_20_premium',
    },
    esim_local_unlimited: {
      productId: 'com.chatforia.esim.local.unlimited',
      kind: 'addon',
      addonKind: 'chatforia_esim_local_unlimited_premium',
    },

    esim_europe_3: {
      productId: 'com.chatforia.esim.europe.3gb',
      kind: 'addon',
      addonKind: 'chatforia_esim_europe_3_premium',
    },
    esim_europe_5: {
      productId: 'com.chatforia.esim.europe.5gb',
      kind: 'addon',
      addonKind: 'chatforia_esim_europe_5_premium',
    },
    esim_europe_10: {
      productId: 'com.chatforia.esim.europe.10gb',
      kind: 'addon',
      addonKind: 'chatforia_esim_europe_10_premium',
    },
    esim_europe_20: {
      productId: 'com.chatforia.esim.europe.20gb',
      kind: 'addon',
      addonKind: 'chatforia_esim_europe_20_premium',
    },
    esim_europe_unlimited: {
      productId: 'com.chatforia.esim.europe.unlimited',
      kind: 'addon',
      addonKind: 'chatforia_esim_europe_unlimited_premium',
    },

    esim_global_3: {
      productId: 'com.chatforia.esim.global.3gb',
      kind: 'addon',
      addonKind: 'chatforia_esim_global_3_premium',
    },
    esim_global_5: {
      productId: 'com.chatforia.esim.global.5gb',
      kind: 'addon',
      addonKind: 'chatforia_esim_global_5_premium',
    },
    esim_global_10: {
      productId: 'com.chatforia.esim.global.10gb',
      kind: 'addon',
      addonKind: 'chatforia_esim_global_10_premium',
    },
    esim_global_unlimited: {
      productId: 'com.chatforia.esim.global.unlimited',
      kind: 'addon',
      addonKind: 'chatforia_esim_global_unlimited_premium',
    },
  },
};

const productsById = Object.values(appleIapConfig.products).reduce((acc, product) => {
  acc[product.productId] = product;
  return acc;
}, {});

export function getAppleProduct(productId) {
  return productsById[String(productId || '').trim()] || null;
}

export function isAppleEnvironmentProduction() {
  return appleIapConfig.environment === 'production';
}

export default appleIapConfig;