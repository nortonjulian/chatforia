// Registry + common interface for telco providers.

let twilioAdapter = null;
try {
  const mod = await import('./twilio.js');
  twilioAdapter = mod?.default || null;
} catch {
  twilioAdapter = null;
}

// Very small safety mock so the app can boot without provider creds
const mockAdapter = {
  providerName: 'mock',
  async searchAvailable() {
    return { items: [] };
  },
  async purchaseNumber() {
    throw new Error('Mock provider cannot purchase numbers. Configure Twilio credentials.');
  },
  async releaseNumber() {
    // no-op
  },
  async configureWebhooks() {
    // no-op
  },
};

const registry = Object.fromEntries(
  [twilioAdapter ? ['twilio', twilioAdapter] : null].filter(Boolean)
);

// Default provider: honor DEFAULT_PROVIDER, else twilio if present, else mock
const defaultKeyRaw = String(process.env.DEFAULT_PROVIDER || '').toLowerCase().trim();
const defaultKey = defaultKeyRaw || (registry.twilio ? 'twilio' : 'mock');

/** Get a provider by key, falls back to default, then to mock. */
export function getProvider(key) {
  const k = String(key || '').toLowerCase().trim();
  return registry[k] || registry[defaultKey] || mockAdapter;
}

export const providerName = registry[defaultKey] ? defaultKey : 'mock';
export const providers = registry;

// Default provider instance
export default getProvider(defaultKey);

/* -------------------- SMS sending -------------------- */
// For now SMS is Twilio-only. If you add other providers later, route through getProvider().
export { sendSms } from './twilio.js';
