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
 * - checks opt-out, idempotency, logs outbound message & carrier event
 * - returns { ok: true, provider, messageSid, clientRef } on success
 * - returns { ok: false, reason } on blocked/error
 */
export async function sendSmsSafe({ to, text, clientRef, from, providerKey, mediaUrls }) {
  const cleanTo = typeof to === 'string' ? to.trim() : to;
  const cleanText = typeof text === 'string' ? text : String(text ?? '');
  const chosen = getProvider(providerKey);

  // 1) Opt-out check
  const phone = await prisma.phone.findUnique({ where: { number: cleanTo }, select: { id: true, optedOut: true }});
  if (phone?.optedOut) {
    console.warn('[sendSmsSafe] blocked - opted out', cleanTo);
    // record attempted send for auditability
    try {
      await prisma.smsCarrierEvent.create({
        data: {
          phoneId: phone.id,
          type: 'BLOCKED_OPT_OUT',
          rawText: cleanText,
          provider: chosen.providerName || providerName,
        },
      });
    } catch (e) {
      console.warn('[sendSmsSafe] failed to write carrier event for blocked send', e);
    }

    return { ok: false, reason: 'opted_out' };
  }

  // 2) Idempotency: clientRef or uniqueProviderRef prevents duplicate sends
  // First check providerMessage mapping (providerMessageId) or clientRef stored previously
  if (clientRef) {
    const existing = await prisma.smsMessage.findFirst({
      where: { clientRef: String(clientRef) },
      select: { id: true, providerMessageId: true },
    });
    if (existing) {
      return { ok: true, provider: chosen.providerName, messageSid: existing.providerMessageId || null, clientRef };
    }
  }

  // 3) Create outbound SmsMessage record (optimistic)
  // Note: your SmsMessage model requires threadId — set to 0 or create/find thread as needed.
  let outboundMsg;
  try {
    outboundMsg = await prisma.smsMessage.create({
      data: {
        threadId: 0, // adjust if you attach SMS to specific thread; consider making threadId nullable
        direction: 'out',
        fromNumber: from || (process.env.TWILIO_FROM_NUMBER || ''),
        toNumber: cleanTo,
        body: cleanText,
        provider: chosen.providerName || providerName,
        clientRef: clientRef ? String(clientRef) : null,
        // providerMessageId will be filled after provider send
      },
    });
  } catch (err) {
    console.error('[sendSmsSafe] failed to create outbound smsMessage', err);
    // guard: if DB failed, do not proceed
    return { ok: false, reason: 'db_error' };
  }

  // 4) Call provider
  try {
    // prefer adapter.sendSms if available (adapter might map to sendSmsRaw internally)
    const adapter = chosen;
    if (!adapter || typeof adapter.sendSms !== 'function') {
      throw new Error('no_provider_send_function');
    }

    const providerResult = await adapter.sendSms({
      to: cleanTo,
      text: cleanText,
      clientRef: clientRef ? String(clientRef) : undefined,
      from: from,
      mediaUrls,
    });

    // providerResult should include provider-specific id (messageSid)
    const messageSid = providerResult?.messageSid || providerResult?.messageSid || providerResult?.sid || null;

    // 5) update outbound msg with provider id & success carrier event
    await prisma.$transaction([
      prisma.smsMessage.update({
        where: { id: outboundMsg.id },
        data: { providerMessageId: messageSid, updatedAt: new Date() },
      }),
      prisma.smsCarrierEvent.create({
        data: {
          phoneId: phone?.id ?? null,
          type: 'OUTBOUND_SENT',
          rawText: cleanText,
          provider: adapter.providerName || providerName,
        },
      }),
    ]);

    return { ok: true, provider: adapter.providerName || providerName, messageSid, clientRef };
  } catch (err) {
    console.error('[sendSmsSafe] provider send failed', err);

    // update outbound message with failure note
    try {
      await prisma.smsMessage.update({
        where: { id: outboundMsg.id },
        data: { providerMessageId: null, updatedAt: new Date() },
      });

      await prisma.smsCarrierEvent.create({
        data: {
          phoneId: phone?.id ?? null,
          type: 'OUTBOUND_FAILED',
          rawText: String(err?.message || err),
          provider: chosen?.providerName || providerName,
        },
      });
    } catch (e) {
      console.warn('[sendSmsSafe] failed to update failure info', e);
    }

    return { ok: false, reason: 'provider_error', detail: String(err?.message || err) };
  }
}

// Backwards-compat: export named sendSms (safe wrapper) so other imports keep working
export const sendSms = sendSmsSafe;
