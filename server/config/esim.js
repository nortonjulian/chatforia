import { ENV } from './env.js';

export const ESIM_ENABLED = !!ENV.FEATURE_ESIM;

export const ESIM_PROVIDER = (ENV.ESIM_PROVIDER || '').toLowerCase();

/**
 * Parse a JSON object from an environment variable without preventing
 * the server from starting when the value is absent or malformed.
 */
function parseJsonObject(value, fallback = {}) {
  if (!value || typeof value !== 'string') {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value);

    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      return parsed;
    }

    return fallback;
  } catch {
    return fallback;
  }
}

export const ESIM_PROVIDERS = {
  telna: {
    /**
     * Telna uses separate development and production API keys.
     * Select the production credential only when NODE_ENV is production.
     */
    apiKey:
      process.env.NODE_ENV === 'production'
        ? ENV.TELNA_API_KEY_PROD || ''
        : ENV.TELNA_API_KEY_DEV || '',

    baseUrl: ENV.TELNA_API_BASE || '',

    webhookSecret: ENV.TELNA_WEBHOOK_SECRET || '',

    /**
     * Prefer the explicitly configured inventory.
     * TELNA_DEFAULT_INVENTORY_ID remains available as a fallback for
     * environments that have not set TELNA_INVENTORY_ID separately.
     */
    inventoryId: ENV.TELNA_INVENTORY_ID
      ? Number(ENV.TELNA_INVENTORY_ID)
      : ENV.TELNA_DEFAULT_INVENTORY_ID
        ? Number(ENV.TELNA_DEFAULT_INVENTORY_ID)
        : null,

    /**
     * Optional SIM group. Leave null until Telna confirms the
     * production group Chatforia should use.
     */
    groupId: ENV.TELNA_GROUP_ID
      ? Number(ENV.TELNA_GROUP_ID)
      : null,

    /**
     * Maps Chatforia plan/product codes to Telna Package Template IDs.
     *
     * Example:
     *
     * {
     *   "ESIM_LOCAL_3GB": 12345,
     *   "ESIM_EUROPE_5GB": 12346,
     *   "ESIM_GLOBAL_10GB": 12347
     * }
     *
     * Production template IDs should only be populated after Telna
     * provides or confirms them.
     */
    packageTemplateMap: parseJsonObject(
      ENV.TELNA_PACKAGE_TEMPLATE_MAP,
      {}
    ),
  },

  plintron: {
    apiKey: ENV.PLINTRON_API_KEY || '',
    baseUrl: ENV.PLINTRON_BASE_URL || '',
    webhookSecret: ENV.PLINTRON_WEBHOOK_SECRET || '',
  },
};

export function getEsimProviderConfig(provider = ESIM_PROVIDER) {
  return ESIM_PROVIDERS[provider] || null;
}