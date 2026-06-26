import prisma from '../../utils/prismaClient.js';

let twilioAdapter = null;

try {
  const mod = await import('./twilio.js');

  twilioAdapter =
    mod.default && typeof mod.default === 'object'
      ? mod.default
      : null;
} catch {
  twilioAdapter = null;
}

const mockAdapter = {
  providerName: 'mock',

  async searchAvailable() {
    return { items: [] };
  },

  async purchaseNumber() {
    throw new Error(
      'Mock provider cannot purchase numbers. Configure Twilio credentials.'
    );
  },

  async releaseNumber() {},

  async sendSms() {
    throw new Error('Mock provider cannot send SMS');
  },
};

const registry = Object.fromEntries(
  [twilioAdapter ? ['twilio', twilioAdapter] : null].filter(Boolean)
);

const defaultKeyRaw = String(process.env.DEFAULT_PROVIDER || '')
  .toLowerCase()
  .trim();

const defaultKey =
  defaultKeyRaw || (registry.twilio ? 'twilio' : 'mock');

export function getProvider(key) {
  const k = String(key || '')
    .toLowerCase()
    .trim();

  return registry[k] || registry[defaultKey] || mockAdapter;
}

export const providerName =
  registry[defaultKey] ? defaultKey : 'mock';

export const providers = registry;

export default getProvider(defaultKey);

/* -------------------- Safe send wrapper -------------------- */

/**
 * sendSmsSafe({ to, text, clientRef, from, providerKey, mediaUrls })
 *
 * - checks opt-out
 * - calls provider adapter
 * - does not create SmsMessage rows
 * - callers handle persistence
 *
 * success:
 *   { ok: true, provider, messageSid, clientRef }
 *
 * failure:
 *   { ok: false, reason }
 */
export async function sendSmsSafe({
  to,
  text,
  clientRef,
  from,
  providerKey,
  mediaUrls,
}) {
  const cleanTo =
    typeof to === 'string' ? to.trim() : to;

  const cleanFrom =
    typeof from === 'string'
      ? from.trim()
      : (process.env.TWILIO_FROM_NUMBER || '');

  const cleanText =
    typeof text === 'string'
      ? text
      : String(text ?? '');

  const chosen = getProvider(providerKey);

  const optedOut = await prisma.smsOptOut.findFirst({
    where: {
      phone: cleanTo,
      OR: [
        { provider: 'twilio' },
        { provider: null },
      ],
    },
    select: { id: true },
  });

  if (optedOut) {
    return {
      ok: false,
      reason: 'opted_out',
    };
  }

  if (!chosen || typeof chosen.sendSms !== 'function') {
    return {
      ok: false,
      reason: 'no_provider_send_function',
    };
  }

  try {
    const providerResult = await chosen.sendSms({
      to: cleanTo,
      text: cleanText,
      clientRef: clientRef
        ? String(clientRef)
        : undefined,
      from: cleanFrom || undefined,
      mediaUrls,
    });

    return {
      ok: true,
      provider:
        chosen.providerName || providerName,
      messageSid:
        providerResult?.messageSid ||
        providerResult?.messageId ||
        providerResult?.sid ||
        null,
      clientRef: clientRef || null,
    };
  } catch (err) {
    console.error(
      '[sendSmsSafe] provider send failed',
      err
    );

    return {
      ok: false,
      reason: 'provider_error',
      detail: String(err?.message || err),
    };
  }
}

/* -------------------- Raw Twilio send -------------------- */

/**
 * Raw provider send used by unit tests
 * and low-level callers.
 *
 * Throws on config/provider errors.
 */
export async function sendSms({
  to,
  text,
  clientRef,
  from,
  mediaUrls,
}) {
  const accountSid =
    process.env.TWILIO_ACCOUNT_SID;

  const authToken =
    process.env.TWILIO_AUTH_TOKEN;

  const messagingServiceSid =
    process.env.TWILIO_MESSAGING_SERVICE_SID;

  const fallbackFrom =
    process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken) {
    throw new Error(
      'Twilio not configured: missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN'
    );
  }

  const finalFrom = from || fallbackFrom;

  if (
    !from &&
    !messagingServiceSid &&
    !finalFrom
  ) {
    throw new Error(
      'sendSms requires TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER'
    );
  }

  const twilioMod = await import('twilio');
  const twilio = twilioMod.default;

  const client = twilio(accountSid, authToken);

  const payload = {
    to,
    body: text,
  };

  if (mediaUrls) {
    payload.mediaUrl = mediaUrls;
  }

  // Explicit from takes precedence
  if (from) {
    payload.from = from;
  }
  // Otherwise use Messaging Service SID
  else if (messagingServiceSid) {
    payload.messagingServiceSid =
      messagingServiceSid;
  }
  // Final fallback to TWILIO_FROM_NUMBER
  else {
    payload.from = finalFrom;
  }

  // Reserved for future tracking support
  if (clientRef) {
    payload.statusCallback = undefined;
  }

  const msg = await client.messages.create(
    payload
  );

  return {
    ok: true,
    provider: 'twilio',
    messageSid:
      msg?.sid ||
      msg?.messageSid ||
      null,
  };
}