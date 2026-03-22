import { ENV } from './env.js';

export const ESIM_ENABLED = !!ENV.FEATURE_ESIM;
export const ESIM_PROVIDER = (ENV.ESIM_PROVIDER || '').toLowerCase();

export const ESIM_PROVIDERS = {
  telna: {
    apiKey: ENV.TELNA_API_KEY || '',
    baseUrl: ENV.TELNA_BASE_URL || '',
    webhookSecret: ENV.TELNA_WEBHOOK_SECRET || '',
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