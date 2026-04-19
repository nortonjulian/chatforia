function normalizeProductId(productId) {
  return String(productId || '').trim();
}

// ---------- SUBSCRIPTIONS ----------

const SUBSCRIPTION_PRODUCTS = {
  // Web / Paddle
  chatforia_plus: { plan: 'PLUS' },
  chatforia_premium_monthly: { plan: 'PREMIUM' },
  chatforia_premium_annual: { plan: 'PREMIUM' },

  // iOS / Apple IAP
  chatforia_plus_monthly_ios: { plan: 'PLUS' },
  chatforia_premium_monthly_ios: { plan: 'PREMIUM' },
  chatforia_premium_annual_ios: { plan: 'PREMIUM' },
};

// ---------- ADDONS / DATA PACKS ----------

const ADDON_PRODUCTS = {
  // Local
  chatforia_esim_local_3: { type: 'ESIM', addonKind: 'chatforia_esim_local_3_premium', dataMb: 3 * 1024, daysValid: 30 },
  chatforia_esim_local_5: { type: 'ESIM', addonKind: 'chatforia_esim_local_5_premium', dataMb: 5 * 1024, daysValid: 30 },
  chatforia_esim_local_10: { type: 'ESIM', addonKind: 'chatforia_esim_local_10_premium', dataMb: 10 * 1024, daysValid: 30 },
  chatforia_esim_local_20: { type: 'ESIM', addonKind: 'chatforia_esim_local_20_premium', dataMb: 20 * 1024, daysValid: 30 },
  chatforia_esim_local_unlimited: { type: 'ESIM', addonKind: 'chatforia_esim_local_unlimited_premium', dataMb: null, daysValid: 30 },

  // Europe
  chatforia_esim_europe_3: { type: 'ESIM', addonKind: 'chatforia_esim_europe_3_premium', dataMb: 3 * 1024, daysValid: 30 },
  chatforia_esim_europe_5: { type: 'ESIM', addonKind: 'chatforia_esim_europe_5_premium', dataMb: 5 * 1024, daysValid: 30 },
  chatforia_esim_europe_10: { type: 'ESIM', addonKind: 'chatforia_esim_europe_10_premium', dataMb: 10 * 1024, daysValid: 30 },
  chatforia_esim_europe_20: { type: 'ESIM', addonKind: 'chatforia_esim_europe_20_premium', dataMb: 20 * 1024, daysValid: 30 },
  chatforia_esim_europe_unlimited: { type: 'ESIM', addonKind: 'chatforia_esim_europe_unlimited_premium', dataMb: null, daysValid: 30 },

  // Global
  chatforia_esim_global_3: { type: 'ESIM', addonKind: 'chatforia_esim_global_3_premium', dataMb: 3 * 1024, daysValid: 30 },
  chatforia_esim_global_5: { type: 'ESIM', addonKind: 'chatforia_esim_global_5_premium', dataMb: 5 * 1024, daysValid: 30 },
  chatforia_esim_global_10: { type: 'ESIM', addonKind: 'chatforia_esim_global_10_premium', dataMb: 10 * 1024, daysValid: 30 },
  chatforia_esim_global_unlimited: { type: 'ESIM', addonKind: 'chatforia_esim_global_unlimited_premium', dataMb: null, daysValid: 30 },

  // Explicit premium aliases already used on web
  chatforia_esim_local_3_premium: { type: 'ESIM', addonKind: 'chatforia_esim_local_3_premium', dataMb: 3 * 1024, daysValid: 30 },
  chatforia_esim_local_5_premium: { type: 'ESIM', addonKind: 'chatforia_esim_local_5_premium', dataMb: 5 * 1024, daysValid: 30 },
  chatforia_esim_local_10_premium: { type: 'ESIM', addonKind: 'chatforia_esim_local_10_premium', dataMb: 10 * 1024, daysValid: 30 },
  chatforia_esim_local_20_premium: { type: 'ESIM', addonKind: 'chatforia_esim_local_20_premium', dataMb: 20 * 1024, daysValid: 30 },
  chatforia_esim_local_unlimited_premium: { type: 'ESIM', addonKind: 'chatforia_esim_local_unlimited_premium', dataMb: null, daysValid: 30 },

  chatforia_esim_europe_3_premium: { type: 'ESIM', addonKind: 'chatforia_esim_europe_3_premium', dataMb: 3 * 1024, daysValid: 30 },
  chatforia_esim_europe_5_premium: { type: 'ESIM', addonKind: 'chatforia_esim_europe_5_premium', dataMb: 5 * 1024, daysValid: 30 },
  chatforia_esim_europe_10_premium: { type: 'ESIM', addonKind: 'chatforia_esim_europe_10_premium', dataMb: 10 * 1024, daysValid: 30 },
  chatforia_esim_europe_20_premium: { type: 'ESIM', addonKind: 'chatforia_esim_europe_20_premium', dataMb: 20 * 1024, daysValid: 30 },
  chatforia_esim_europe_unlimited_premium: { type: 'ESIM', addonKind: 'chatforia_esim_europe_unlimited_premium', dataMb: null, daysValid: 30 },

  chatforia_esim_global_3_premium: { type: 'ESIM', addonKind: 'chatforia_esim_global_3_premium', dataMb: 3 * 1024, daysValid: 30 },
  chatforia_esim_global_5_premium: { type: 'ESIM', addonKind: 'chatforia_esim_global_5_premium', dataMb: 5 * 1024, daysValid: 30 },
  chatforia_esim_global_10_premium: { type: 'ESIM', addonKind: 'chatforia_esim_global_10_premium', dataMb: 10 * 1024, daysValid: 30 },
  chatforia_esim_global_unlimited_premium: { type: 'ESIM', addonKind: 'chatforia_esim_global_unlimited_premium', dataMb: null, daysValid: 30 },

  // iOS / Apple IAP aliases
  chatforia_esim_local_3_ios: { type: 'ESIM', addonKind: 'chatforia_esim_local_3_premium', dataMb: 3 * 1024, daysValid: 30 },
  chatforia_esim_local_5_ios: { type: 'ESIM', addonKind: 'chatforia_esim_local_5_premium', dataMb: 5 * 1024, daysValid: 30 },
  chatforia_esim_local_10_ios: { type: 'ESIM', addonKind: 'chatforia_esim_local_10_premium', dataMb: 10 * 1024, daysValid: 30 },
  chatforia_esim_local_20_ios: { type: 'ESIM', addonKind: 'chatforia_esim_local_20_premium', dataMb: 20 * 1024, daysValid: 30 },
  chatforia_esim_local_unlimited_ios: { type: 'ESIM', addonKind: 'chatforia_esim_local_unlimited_premium', dataMb: null, daysValid: 30 },

  chatforia_esim_europe_3_ios: { type: 'ESIM', addonKind: 'chatforia_esim_europe_3_premium', dataMb: 3 * 1024, daysValid: 30 },
  chatforia_esim_europe_5_ios: { type: 'ESIM', addonKind: 'chatforia_esim_europe_5_premium', dataMb: 5 * 1024, daysValid: 30 },
  chatforia_esim_europe_10_ios: { type: 'ESIM', addonKind: 'chatforia_esim_europe_10_premium', dataMb: 10 * 1024, daysValid: 30 },
  chatforia_esim_europe_20_ios: { type: 'ESIM', addonKind: 'chatforia_esim_europe_20_premium', dataMb: 20 * 1024, daysValid: 30 },
  chatforia_esim_europe_unlimited_ios: { type: 'ESIM', addonKind: 'chatforia_esim_europe_unlimited_premium', dataMb: null, daysValid: 30 },

  chatforia_esim_global_3_ios: { type: 'ESIM', addonKind: 'chatforia_esim_global_3_premium', dataMb: 3 * 1024, daysValid: 30 },
  chatforia_esim_global_5_ios: { type: 'ESIM', addonKind: 'chatforia_esim_global_5_premium', dataMb: 5 * 1024, daysValid: 30 },
  chatforia_esim_global_10_ios: { type: 'ESIM', addonKind: 'chatforia_esim_global_10_premium', dataMb: 10 * 1024, daysValid: 30 },
  chatforia_esim_global_unlimited_ios: { type: 'ESIM', addonKind: 'chatforia_esim_global_unlimited_premium', dataMb: null, daysValid: 30 },
};

export function getSubscriptionConfig(productId) {
  return SUBSCRIPTION_PRODUCTS[normalizeProductId(productId)] || null;
}

export function getAddonConfig(productId) {
  return ADDON_PRODUCTS[normalizeProductId(productId)] || null;
}

export function isKnownBillingProduct(productId) {
  return Boolean(getSubscriptionConfig(productId) || getAddonConfig(productId));
}