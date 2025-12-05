import { ENV } from './env.js';

export const ESIM_ENABLED = !!ENV.FEATURE_ESIM;

export const ESIM_PROVIDER = (ENV.ESIM_PROVIDER || 'oneglobal').toLowerCase();

/**
 * 1GLOBAL provider config
 */
export const ONEGLOBAL = {
  apiKey: ENV.ONEGLOBAL_API_KEY || '',
  baseUrl: ENV.ONEGLOBAL_BASE_URL || '',
  webhookSecret: ENV.ONEGLOBAL_WEBHOOK_SECRET || '',
  callbackUrl: ENV.ONEGLOBAL_CALLBACK_URL || '',
  partnerId: ENV.ONEGLOBAL_PARTNER_ID || '',
  defaultPlanId: ENV.ONEGLOBAL_DEFAULT_PLAN_ID || '',
};

/**
 * Convenience switcher if/when you add more providers.
 */
export function getEsimProviderConfig() {
  switch (ESIM_PROVIDER) {
    case 'oneglobal':
      return ONEGLOBAL;
    default:
      return null;
  }
}
