import Twilio from 'twilio';

function getClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (!sid || !token) throw new Error('Missing Twilio credentials');

  const TwilioFn =
    typeof Twilio === 'function'
      ? Twilio
      : (Twilio && typeof Twilio.default === 'function'
          ? Twilio.default
          : null);

  if (!TwilioFn) {
    throw new Error('Twilio client factory is not a function');
  }

  return TwilioFn(sid, token);
}

/**
 * sendSms({ to, text, clientRef, from })
 * - If `from` is provided, use that (user’s DID).
 * - Else fall back to Messaging Service or global number.
 */
export async function sendSms({ to, text, clientRef, from }) {
  const client = getClient();

  let fromConfig;
  if (from) {
    // ✅ Use the user’s dedicated Twilio number
    fromConfig = { from };
  } else if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
    fromConfig = { messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID };
  } else if (process.env.TWILIO_PHONE_NUMBER) {
    fromConfig = { from: process.env.TWILIO_PHONE_NUMBER };
  } else {
    fromConfig = {}; // Twilio will reject if nothing valid is present
  }

  const payload = {
    to,
    body: text,
    ...(process.env.TWILIO_STATUS_WEBHOOK_URL
      ? { statusCallback: process.env.TWILIO_STATUS_WEBHOOK_URL }
      : {}),
    ...fromConfig,
  };

  const msg = await client.messages.create(payload);

  return {
    ok: true,
    provider: 'twilio',
    messageSid: msg.sid,
    clientRef: clientRef || null,
  };
}

/**
 * searchAvailable({ areaCode, postalCode, country, type, limit })
 * - `areaCode` = classic NPA (e.g. "415")
 * - `postalCode` = ZIP (e.g. "94105")
 * We support both: if postalCode is present we use it; otherwise areaCode.
 */
async function searchAvailable({ areaCode, postalCode, country = 'US', type = 'local', limit = 20 }) {
  const client = getClient();

  const base = client.availablePhoneNumbers(country);

  const params = {
    limit,
    smsEnabled: true,
    voiceEnabled: true,
  };

  if (postalCode) {
    params.inPostalCode = String(postalCode);
  } else if (areaCode) {
    params.areaCode = String(areaCode);
  }

  let list;
  if (type === 'tollfree') {
    list = await base.tollFree.list(params);
  } else if (type === 'mobile') {
    list = await base.mobile.list(params);
  } else {
    // default: local
    list = await base.local.list(params);
  }

  const items = list.map((n) => ({
    e164: n.phoneNumber,
    number: n.phoneNumber,
    region: n.region,
    locality: n.locality || n.friendlyName || null,
    isoCountry: n.isoCountry,
    postalCode: n.postalCode || null,
    capabilities: n.capabilities
      ? Object.entries(n.capabilities)
          .filter(([, v]) => v)
          .map(([k]) => k) // e.g. sms, voice, mms
      : ['sms', 'voice'],
    // Placeholder: Twilio pricing is separate API; you can plug that in later
    price: null,
  }));

  return { items };
}

/**
 * purchaseNumber({ phoneNumber })
 * - Actually buys the number from Twilio
 */
async function purchaseNumber({ phoneNumber }) {
  const client = getClient();

  const res = await client.incomingPhoneNumbers.create({
    phoneNumber,
    // later: smsUrl, voiceUrl, etc.
  });

  return {
    ok: true,
    sid: res.sid,
    e164: res.phoneNumber,
    order: {
      sid: res.sid,
    },
  };
}

/**
 * releaseNumber({ phoneNumber })
 * - Releases an owned Twilio number
 */
async function releaseNumber({ phoneNumber }) {
  const client = getClient();

  const existing = await client.incomingPhoneNumbers.list({
    phoneNumber,
    limit: 1,
  });

  const num = existing[0];
  if (!num) {
    return { ok: false, reason: 'not-found' };
  }

  await client.incomingPhoneNumbers(num.sid).remove();
  return { ok: true };
}

export const providerName = 'twilio';

/**
 * Default adapter object used by ../lib/telco/index.js
 */
const adapter = {
  providerName,
  sendSms,
  searchAvailable,
  purchaseNumber,
  releaseNumber,
};

export default adapter;
