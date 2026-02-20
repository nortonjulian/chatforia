import Twilio from 'twilio';

export const providerName = 'twilio';

/* -------------------------------------------------------------------------- */
/*  Client helper                                                             */
/* -------------------------------------------------------------------------- */

function getClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (!sid || !token) {
    throw new Error('Twilio not configured: missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN');
  }

  const TwilioFn =
    typeof Twilio === 'function'
      ? Twilio
      : (Twilio && typeof Twilio.default === 'function' ? Twilio.default : null);

  if (!TwilioFn) {
    throw new Error('Twilio client factory is not a function');
  }

  return TwilioFn(sid, token);
}

/* -------------------------------------------------------------------------- */
/*  Optional SMS helper (Twilio-only)                                        */
/*  (Your main app is using sendSms from lib/telco/index.js, but this stays  */
/*   for any Twilio-specific callers that import from './twilio.js'.)        */
/* -------------------------------------------------------------------------- */

/**
 * sendSms({ to, text, clientRef, from })
 * - If `from` is provided, use that (user’s DID).
 * - Else prefer TWILIO_MESSAGING_SERVICE_SID, then TWILIO_FROM_NUMBER.
 */
// server/lib/telco/twilio.js

export async function sendSmsRaw({ to, text, clientRef, from, mediaUrls }) {
  const {
    TWILIO_FROM_NUMBER,
    TWILIO_MESSAGING_SERVICE_SID,
    TWILIO_STATUS_CALLBACK_URL,
    NODE_ENV,
  } = process.env;

  const client = getClient();

  const cleanTo = typeof to === 'string' ? to.trim() : to;
  const body = typeof text === 'string' ? text : String(text ?? '');

  const cleanServiceSid =
    typeof TWILIO_MESSAGING_SERVICE_SID === 'string'
      ? TWILIO_MESSAGING_SERVICE_SID.trim()
      : '';

  const cleanFrom =
    typeof from === 'string' ? from.trim() : from;

  const cleanDefaultFrom =
    typeof TWILIO_FROM_NUMBER === 'string'
      ? TWILIO_FROM_NUMBER.trim()
      : '';

  const params = {
    to: cleanTo,
    body,
  };

  // ✅ US A2P: always route via Messaging Service if configured
if (cleanServiceSid) {
  params.messagingServiceSid = cleanServiceSid;
} else if (cleanFrom) {
  params.from = cleanFrom;
} else {
  if (!cleanDefaultFrom) throw new Error('Twilio SMS requires TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER');
  params.from = cleanDefaultFrom;
}

  // ✅ MMS support (optional)
  // Twilio expects `mediaUrl` as string or array of strings
  if (Array.isArray(mediaUrls) && mediaUrls.length) {
    params.mediaUrl = mediaUrls.filter(Boolean);
  }

  // ✅ Status callback: Twilio requires public HTTPS; avoid localhost in dev
  if (TWILIO_STATUS_CALLBACK_URL) {
    const url = TWILIO_STATUS_CALLBACK_URL.trim();
    const isHttps = /^https:\/\//i.test(url);
    const isLocalhost = /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(url);

    if (isHttps && !isLocalhost) {
      params.statusCallback = url;
    } else if (NODE_ENV === 'production') {
      console.warn('[twilio-sendSms] Ignoring invalid TWILIO_STATUS_CALLBACK_URL in production:', url);
    }
  }

  console.log('[twilio-sendSms]', {
    to: params.to,
    using: params.from ? 'from' : 'messagingServiceSid',
    from: params.from || null,
    messagingServiceSid: params.messagingServiceSid || null,
    hasMedia: Boolean(params.mediaUrl?.length),
  });

    console.log('[twilio-sendSms input]', {
    to,
    from_in: from || null,
    env_serviceSid: process.env.TWILIO_MESSAGING_SERVICE_SID || null,
    env_from: process.env.TWILIO_FROM_NUMBER || null,
  });

  console.log('[twilio-sendSms params]', {
    to: params.to,
    using: params.from ? 'from' : 'messagingServiceSid',
    from: params.from || null,
    messagingServiceSid: params.messagingServiceSid || null,
  });

  const msg = await client.messages.create(params);

  return {
    ok: true,
    provider: 'twilio',
    messageSid: msg.sid,
    clientRef: clientRef || null,
  };
}


/* -------------------------------------------------------------------------- */
/*  Number search (for pool picker UI)                                       */
/* -------------------------------------------------------------------------- */

/**
 * searchAvailable({ areaCode, postalCode, country, type, limit })
 * - `areaCode`   = NPA (e.g. "415")
 * - `postalCode` = ZIP (e.g. "94105")
 * If postalCode is present we prefer it; otherwise we use areaCode.
 */
async function searchAvailable({
  areaCode,
  postalCode,
  country = 'US',
  type = 'local',
  limit = 20,
}) {
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
          .map(([k]) => k) // e.g. ['sms', 'voice', 'mms']
      : ['sms', 'voice'],
    price: null, // Twilio pricing API can be wired in later
  }));

  return { items };
}

/* -------------------------------------------------------------------------- */
/*  Purchase / release numbers                                               */
/* -------------------------------------------------------------------------- */

/**
 * purchaseNumber({ phoneNumber })
 * - Buys the number and wires SMS/Voice webhooks.
 */
async function purchaseNumber({ phoneNumber }) {
  const client = getClient();
  const base = process.env.TWILIO_WEBHOOK_BASE_URL;

  const rawVoiceAppSid = (process.env.TWILIO_VOICE_APPLICATION_SID || '').trim();
  const hasValidVoiceAppSid = /^AP[a-f0-9]{32}$/i.test(rawVoiceAppSid);

  const createParams = { phoneNumber };

  if (base) {
    // ✅ keep smsWebhooks.js as the single inbound handler
    createParams.smsUrl = `${base}/webhooks/sms/twilio`;
    createParams.smsMethod = 'POST';
  }

  if (hasValidVoiceAppSid) {
    createParams.voiceApplicationSid = rawVoiceAppSid;
  } else if (base) {
    createParams.voiceUrl = `${base}/webhooks/voice/inbound`;
    createParams.voiceMethod = 'POST';
  }

  const res = await client.incomingPhoneNumbers.create(createParams);

  return {
    ok: true,
    sid: res.sid,
    e164: res.phoneNumber,
    isoCountry: res.isoCountry || null,
    capabilities: res.capabilities || null,
    order: { sid: res.sid },
  };
}

/**
 * releaseNumber({ phoneNumber })
 * - Releases a Twilio number you own.
 */
async function releaseNumber({ phoneNumber }) {
  const client = getClient();

  const [num] = await client.incomingPhoneNumbers.list({
    phoneNumber,
    limit: 1,
  });

  if (!num) {
    return { ok: false, reason: 'not-found' };
  }

  await client.incomingPhoneNumbers(num.sid).remove();
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/*  Adapter object used by lib/telco/index.js                                */
/* -------------------------------------------------------------------------- */

const adapter = {
  providerName,
  sendSms: sendSmsRaw,
  searchAvailable,
  purchaseNumber,
  releaseNumber,
};

export default adapter;
