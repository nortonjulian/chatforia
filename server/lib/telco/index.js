import prisma from '../../utils/prismaClient.js';

let twilioAdapter = null;
try {
  const mod = await import('./twilio.js');
  twilioAdapter = mod?.default || null;
} catch {
  twilioAdapter = null;
}

const mockAdapter = {
  providerName: 'mock',
  async searchAvailable() { return { items: [] }; },
  async purchaseNumber() { throw new Error('Mock provider cannot purchase numbers. Configure Twilio credentials.'); },
  async releaseNumber() {},
  async sendSms() { throw new Error('Mock provider cannot send SMS'); },
};

const registry = Object.fromEntries(
  [twilioAdapter ? ['twilio', twilioAdapter] : null].filter(Boolean)
);

const defaultKeyRaw = String(process.env.DEFAULT_PROVIDER || '').toLowerCase().trim();
const defaultKey = defaultKeyRaw || (registry.twilio ? 'twilio' : 'mock');

export function getProvider(key) {
  const k = String(key || '').toLowerCase().trim();
  return registry[k] || registry[defaultKey] || mockAdapter;
}

export const providerName = registry[defaultKey] ? defaultKey : 'mock';
export const providers = registry;
export default getProvider(defaultKey);

/* -------------------- Safe send wrapper -------------------- */

/**
 * sendSmsSafe({ to, text, clientRef, from, providerKey, mediaUrls })
 *  * - checks opt-out, calls provider adapter, returns provider result
 * - does not create SmsMessage rows; callers handle persistence
 * - returns { ok: true, provider, messageSid, clientRef } on success
 * - returns { ok: false, reason } on blocked/error
 */
export async function sendSmsSafe({ to, text, clientRef, from, providerKey, mediaUrls }) {
  const cleanTo = typeof to === 'string' ? to.trim() : to;
  const cleanFrom = typeof from === 'string' ? from.trim() : (process.env.TWILIO_FROM_NUMBER || '');
  const cleanText = typeof text === 'string' ? text : String(text ?? '');
  const chosen = getProvider(providerKey);

  const optedOut = await prisma.smsOptOut.findFirst({
    where: {
      phone: cleanTo,
      OR: [{ provider: 'twilio' }, { provider: null }],
    },
    select: { id: true },
  });

  if (optedOut) {
    return { ok: false, reason: 'opted_out' };
  }

  if (!chosen || typeof chosen.sendSms !== 'function') {
    return { ok: false, reason: 'no_provider_send_function' };
  }

  try {
    const providerResult = await chosen.sendSms({
      to: cleanTo,
      text: cleanText,
      clientRef: clientRef ? String(clientRef) : undefined,
      from: cleanFrom || undefined,
      mediaUrls,
    });

    return {
      ok: true,
      provider: chosen.providerName || providerName,
      messageSid:
        providerResult?.messageSid ||
        providerResult?.messageId ||
        providerResult?.sid ||
        null,
      clientRef: clientRef || null,
    };
  } catch (err) {
    console.error('[sendSmsSafe] provider send failed', err);
    return {
      ok: false,
      reason: 'provider_error',
      detail: String(err?.message || err),
    };
  }
}

// Backwards-compat: export named sendSms (safe wrapper) so other imports keep working
export const sendSms = sendSmsSafe;
