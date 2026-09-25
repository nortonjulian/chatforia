import Twilio from 'twilio';

export const providerName = 'twilio';

function getClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (!sid || !token) {
    throw new Error(
      'Twilio not configured: missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN'
    );
  }

  const TwilioFn =
    typeof Twilio === 'function'
      ? Twilio
      : Twilio && typeof Twilio.default === 'function'
        ? Twilio.default
        : null;

  if (!TwilioFn) {
    throw new Error('Twilio client factory is not a function');
  }

  return TwilioFn(sid, token);
}

function normalizeRequiredCapabilities(value) {
  const values = Array.isArray(value)
    ? value
    : String(value || 'sms,voice').split(',');

  const supported = new Set(['sms', 'voice', 'mms']);
  const normalized = [
    ...new Set(
      values
        .map((item) => String(item).trim().toLowerCase())
        .filter(Boolean)
    ),
  ];

  for (const capability of normalized) {
    if (!supported.has(capability)) {
      throw new Error(
        `Unsupported required capability: ${capability}. Use sms, voice, or mms.`
      );
    }
  }

  return normalized;
}

function normalizeCapabilityMap(value) {
  if (!value || typeof value !== 'object') return {};

  return Object.fromEntries(
    Object.entries(value).map(([key, enabled]) => [
      String(key).trim().toLowerCase(),
      Boolean(enabled),
    ])
  );
}

function optionalSid(value, prefix, label) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (!clean) return null;

  const pattern = new RegExp(`^${prefix}[a-f0-9]{32}$`, 'i');

  if (!pattern.test(clean)) {
    throw new Error(`${label} must be a valid ${prefix} SID`);
  }

  return clean;
}

export async function sendSmsRaw({
  to,
  text,
  clientRef,
  from,
  mediaUrls,
}) {
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
    typeof from === 'string'
      ? from.trim()
      : from;

  const cleanDefaultFrom =
    typeof TWILIO_FROM_NUMBER === 'string'
      ? TWILIO_FROM_NUMBER.trim()
      : '';

  const params = {
    to: cleanTo,
    body,
  };

  if (cleanServiceSid) {
    params.messagingServiceSid = cleanServiceSid;
  } else if (cleanFrom) {
    params.from = cleanFrom;
  } else {
    if (!cleanDefaultFrom) {
      throw new Error(
        'Twilio SMS requires TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER'
      );
    }

    params.from = cleanDefaultFrom;
  }

  if (Array.isArray(mediaUrls) && mediaUrls.length) {
    params.mediaUrl = mediaUrls.filter(Boolean);
  }

  if (TWILIO_STATUS_CALLBACK_URL) {
    const url = TWILIO_STATUS_CALLBACK_URL.trim();
    const isHttps = /^https:\/\//i.test(url);

    const isLocalhost =
      /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(url);

    if (isHttps && !isLocalhost) {
      params.statusCallback = url;
    } else if (NODE_ENV === 'production') {
      console.warn(
        '[twilio-sendSms] Ignoring invalid TWILIO_STATUS_CALLBACK_URL in production'
      );
    }
  }

  const msg = await client.messages.create(params);

  return {
    ok: true,
    provider: 'twilio',
    messageSid: msg.sid,
    clientRef: clientRef || null,
  };
}

async function searchAvailable({
  areaCode,
  postalCode,
  country = 'US',
  type = 'local',
  limit = 20,
  requiredCapabilities = ['sms', 'voice'],
}) {
  const client = getClient();
  const base = client.availablePhoneNumbers(country);
  const required =
    normalizeRequiredCapabilities(requiredCapabilities);

  const params = {
    limit,
  };

  if (
    required.includes('sms') ||
    required.includes('mms')
  ) {
    params.smsEnabled = true;
  }

  if (required.includes('voice')) {
    params.voiceEnabled = true;
  }

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
  } else if (type === 'local') {
    list = await base.local.list(params);
  } else {
    throw new Error(
      `Unsupported Twilio number type: ${type}`
    );
  }

  const items = list
    .map((number) => ({
      e164: number.phoneNumber,
      number: number.phoneNumber,
      region: number.region || null,
      locality:
        number.locality ||
        number.friendlyName ||
        null,
      isoCountry:
        number.isoCountry ||
        String(country).toUpperCase(),
      postalCode:
        number.postalCode ||
        null,
      addressRequirements:
        number.addressRequirements ||
        null,
      beta: Boolean(number.beta),
      capabilities:
        normalizeCapabilityMap(
          number.capabilities
        ),
      price: null,
    }))
    .filter((number) =>
      required.every(
        (capability) =>
          number.capabilities?.[capability] === true
      )
    );

  return {
    items,
  };
}

async function getRegulations({
  country,
  numberType = 'local',
  endUserType = 'individual',
  includeConstraints = true,
}) {
  const client = getClient();

  const isoCountry = String(country || '')
    .trim()
    .toUpperCase();

  if (!/^[A-Z]{2}$/.test(isoCountry)) {
    throw new Error(
      'country must be a 2-letter ISO country code'
    );
  }

  const normalizedNumberType = String(
    numberType || 'local'
  )
    .trim()
    .toLowerCase();

  const supportedNumberTypes = new Set([
    'local',
    'mobile',
    'national',
    'toll-free',
  ]);

  if (!supportedNumberTypes.has(normalizedNumberType)) {
    throw new Error(
      `Unsupported regulatory number type: ${normalizedNumberType}`
    );
  }

  const normalizedEndUserType = String(
    endUserType || 'individual'
  )
    .trim()
    .toLowerCase();

  if (!['individual', 'business'].includes(normalizedEndUserType)) {
    throw new Error(
      'endUserType must be individual or business'
    );
  }

  const regulations =
    await client.numbers.v2.regulatoryCompliance
      .regulations
      .list({
        isoCountry,
        numberType: normalizedNumberType,
        endUserType: normalizedEndUserType,
        includeConstraints: Boolean(includeConstraints),
        limit: 20,
      });

  return regulations.map((regulation) => ({
    sid: regulation.sid,
    friendlyName: regulation.friendlyName || null,
    isoCountry: regulation.isoCountry || isoCountry,
    numberType:
      regulation.numberType || normalizedNumberType,
    endUserType:
      regulation.endUserType || normalizedEndUserType,
    requirements: regulation.requirements || null,
  }));
}

async function purchaseNumber({
  phoneNumber,
  addressSid,
  bundleSid,
  identitySid,
}) {
  const client = getClient();
  const base =
    process.env.TWILIO_WEBHOOK_BASE_URL;

  const rawInboundVoiceAppSid = (
    process.env.TWILIO_INBOUND_VOICE_APP_SID ||
    ''
  ).trim();

  const hasValidInboundVoiceAppSid =
    /^AP[a-f0-9]{32}$/i.test(
      rawInboundVoiceAppSid
    );

  const rawMessagingServiceSid = (
    process.env.TWILIO_MESSAGING_SERVICE_SID ||
    ''
  ).trim();

  const hasValidMessagingServiceSid =
    /^MG[a-f0-9]{32}$/i.test(
      rawMessagingServiceSid
    );

  const createParams = {
    phoneNumber,
  };

  const cleanAddressSid =
    optionalSid(
      addressSid,
      'AD',
      'addressSid'
    );

  const cleanBundleSid =
    optionalSid(
      bundleSid,
      'BU',
      'bundleSid'
    );

  const cleanIdentitySid =
    optionalSid(
      identitySid,
      'RI',
      'identitySid'
    );

  if (cleanAddressSid) {
    createParams.addressSid =
      cleanAddressSid;
  }

  if (cleanBundleSid) {
    createParams.bundleSid =
      cleanBundleSid;
  }

  if (cleanIdentitySid) {
    createParams.identitySid =
      cleanIdentitySid;
  }

  if (base) {
    createParams.smsUrl =
      `${base}/webhooks/sms/twilio`;

    createParams.smsMethod =
      'POST';
  }

  if (hasValidInboundVoiceAppSid) {
    createParams.voiceApplicationSid =
      rawInboundVoiceAppSid;
  } else if (base) {
    createParams.voiceUrl =
      `${base}/webhooks/voice/inbound`;

    createParams.voiceMethod =
      'POST';
  }

  const result =
    await client.incomingPhoneNumbers.create(
      createParams
    );

  let messagingServiceAttached = false;

  if (hasValidMessagingServiceSid) {
    try {
      await client.messaging.v1
        .services(rawMessagingServiceSid)
        .phoneNumbers.create({
          phoneNumberSid: result.sid,
        });

      messagingServiceAttached = true;
    } catch (error) {
      console.error(
        '[twilio purchaseNumber] Messaging Service attachment failed',
        {
          phoneNumber:
            result.phoneNumber,
          phoneNumberSid:
            result.sid,
          error:
            error?.message ||
            String(error),
        }
      );
    }
  }

  return {
    ok: true,
    messagingServiceAttached,
    sid:
      result.sid,
    e164:
      result.phoneNumber,
    isoCountry:
      result.isoCountry ||
      null,
    capabilities:
      result.capabilities ||
      null,
    locality:
      result.locality ||
      result.friendlyName ||
      null,
    region:
      result.region ||
      null,
    addressRequirements:
      result.addressRequirements ||
      null,
    addressSid:
      result.addressSid ||
      cleanAddressSid,
    bundleSid:
      result.bundleSid ||
      cleanBundleSid,
    identitySid:
      result.identitySid ||
      cleanIdentitySid,
  };
}

async function releaseNumber({
  phoneNumber,
}) {
  const client = getClient();

  const [number] =
    await client.incomingPhoneNumbers.list({
      phoneNumber,
      limit: 1,
    });

  if (!number) {
    return {
      ok: false,
      reason: 'not-found',
    };
  }

  await client
    .incomingPhoneNumbers(number.sid)
    .remove();

  return {
    ok: true,
  };
}

const adapter = {
  providerName,
  sendSms: sendSmsRaw,
  searchAvailable,
  getRegulations,
  purchaseNumber,
  releaseNumber,
};

export default adapter;