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

export function normalizeRegulatoryBundleStatus(status) {
  const normalized = String(status || '')
    .trim()
    .toLowerCase();

  const statusMap = {
    draft: 'DRAFT',
    'pending-review': 'PENDING_REVIEW',
    'in-review': 'IN_REVIEW',
    'twilio-approved': 'APPROVED',
    'twilio-rejected': 'REJECTED',
    'provisionally-approved':
      'PROVISIONALLY_APPROVED',
  };

  return statusMap[normalized] || null;
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

async function createRegulatoryEndUser({
  friendlyName,
  endUserType,
  attributes,
}) {
  const client = getClient();

  const normalizedEndUserType = String(
    endUserType || ''
  )
    .trim()
    .toLowerCase();

  if (
    normalizedEndUserType !== 'individual' &&
    normalizedEndUserType !== 'business'
  ) {
    throw new Error(
      'endUserType must be individual or business'
    );
  }

  const cleanFriendlyName = String(
    friendlyName || ''
  ).trim();

  if (!cleanFriendlyName) {
    throw new Error(
      'friendlyName is required'
    );
  }

  const params = {
    friendlyName: cleanFriendlyName,
    type: normalizedEndUserType,
  };

  if (attributes !== undefined) {
    params.attributes = attributes;
  }

  const result =
    await client.numbers.v2.regulatoryCompliance
      .endUsers
      .create(params);

  return {
    sid: result.sid,
    friendlyName:
      result.friendlyName ||
      cleanFriendlyName,
    type:
      result.type ||
      normalizedEndUserType,
    attributes:
      result.attributes ??
      attributes ??
      null,
  };
}

async function createRegulatoryBundle({
  friendlyName,
  email,
  regulationSid,
  country,
  numberType,
  endUserType,
  statusCallback,
  isTest = false,
}) {
  const client = getClient();

  const cleanFriendlyName = String(
    friendlyName || ''
  ).trim();

  const cleanEmail = String(
    email || ''
  ).trim();

  const cleanRegulationSid = String(
    regulationSid || ''
  ).trim();

  const isoCountry = String(
    country || ''
  )
    .trim()
    .toUpperCase();

  const normalizedNumberType = String(
    numberType || ''
  )
    .trim()
    .toLowerCase();

  const normalizedEndUserType = String(
    endUserType || ''
  )
    .trim()
    .toLowerCase();

  if (!cleanFriendlyName) {
    throw new Error(
      'friendlyName is required'
    );
  }

  if (!cleanEmail) {
    throw new Error(
      'email is required'
    );
  }

  if (!/^RN[a-f0-9]{32}$/i.test(cleanRegulationSid)) {
    throw new Error(
      'regulationSid must be a valid Twilio Regulation SID'
    );
  }

  if (!/^[A-Z]{2}$/.test(isoCountry)) {
    throw new Error(
      'country must be a 2-letter ISO country code'
    );
  }

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

  if (
    normalizedEndUserType !== 'individual' &&
    normalizedEndUserType !== 'business'
  ) {
    throw new Error(
      'endUserType must be individual or business'
    );
  }

  const params = {
    friendlyName: cleanFriendlyName,
    email: cleanEmail,
    regulationSid: cleanRegulationSid,
    isoCountry,
    numberType: normalizedNumberType,
    endUserType: normalizedEndUserType,
    isTest: Boolean(isTest),
  };

  const cleanStatusCallback = String(
    statusCallback || ''
  ).trim();

  if (cleanStatusCallback) {
    params.statusCallback =
      cleanStatusCallback;
  }

  const result =
    await client.numbers.v2.regulatoryCompliance
      .bundles
      .create(params);

  return {
    sid: result.sid,
    regulationSid:
      result.regulationSid ||
      cleanRegulationSid,
    friendlyName:
      result.friendlyName ||
      cleanFriendlyName,
    status:
      result.status ||
      'draft',
    validUntil:
      result.validUntil ||
      null,
    email:
      result.email ||
      cleanEmail,
    statusCallback:
      result.statusCallback ||
      cleanStatusCallback ||
      null,
  };
}

async function assignRegulatoryItem({
  bundleSid,
  objectSid,
}) {
  const client = getClient();

  const cleanBundleSid = String(
    bundleSid || ''
  ).trim();

  const cleanObjectSid = String(
    objectSid || ''
  ).trim();

  if (!/^BU[a-f0-9]{32}$/i.test(cleanBundleSid)) {
    throw new Error(
      'bundleSid must be a valid Twilio Bundle SID'
    );
  }

  if (!/^[A-Z]{2}[a-f0-9]{32}$/i.test(cleanObjectSid)) {
    throw new Error(
      'objectSid must be a valid Twilio SID'
    );
  }

  const result =
    await client.numbers.v2.regulatoryCompliance
      .bundles(cleanBundleSid)
      .itemAssignments
      .create({
        objectSid: cleanObjectSid,
      });

  return {
    sid: result.sid,
    bundleSid:
      result.bundleSid ||
      cleanBundleSid,
    objectSid:
      result.objectSid ||
      cleanObjectSid,
  };
}

async function listRegulatorySupportingDocumentTypes({
  limit = 100,
} = {}) {
  const client = getClient();

  const normalizedLimit = Number(limit);

  if (
    !Number.isInteger(normalizedLimit) ||
    normalizedLimit < 1 ||
    normalizedLimit > 1000
  ) {
    throw new Error(
      'limit must be an integer between 1 and 1000'
    );
  }

  const types =
    await client.numbers.v2.regulatoryCompliance
      .supportingDocumentTypes
      .list({
        limit: normalizedLimit,
      });

  return types.map((type) => ({
    sid: type.sid,
    friendlyName:
      type.friendlyName ||
      null,
    machineName:
      type.machineName ||
      null,
    fields:
      Array.isArray(type.fields)
        ? type.fields
        : [],
    url:
      type.url ||
      null,
  }));
}

async function createRegulatorySupportingDocument({
  friendlyName,
  type,
  attributes,
}) {
  const client = getClient();

  const cleanFriendlyName =
    typeof friendlyName === 'string'
      ? friendlyName.trim()
      : '';

  const cleanType =
    typeof type === 'string'
      ? type.trim()
      : '';

  if (!cleanFriendlyName) {
    throw new Error(
      'friendlyName is required'
    );
  }

  if (!cleanType) {
    throw new Error(
      'type is required'
    );
  }

  const params = {
    friendlyName: cleanFriendlyName,
    type: cleanType,
  };

  if (
    attributes !== undefined &&
    attributes !== null
  ) {
    if (
      typeof attributes !== 'object' ||
      Array.isArray(attributes)
    ) {
      throw new Error(
        'attributes must be an object'
      );
    }

    params.attributes = attributes;
  }

  const result =
    await client.numbers.v2.regulatoryCompliance
      .supportingDocuments
      .create(params);

  return {
    sid: result.sid,
    accountSid:
      result.accountSid ||
      null,
    friendlyName:
      result.friendlyName ||
      cleanFriendlyName,
    mimeType:
      result.mimeType ||
      null,
    status:
      result.status ||
      'draft',
    failureReason:
      result.failureReason ||
      null,
    errors:
      Array.isArray(result.errors)
        ? result.errors
        : [],
    type:
      result.type ||
      cleanType,
    attributes:
      result.attributes ||
      {},
    dateCreated:
      result.dateCreated ||
      null,
    dateUpdated:
      result.dateUpdated ||
      null,
    url:
      result.url ||
      null,
  };
}

async function getRegulatoryBundle({
  bundleSid,
}) {
  const client = getClient();

  const cleanBundleSid = String(
    bundleSid || ''
  ).trim();

  if (!/^BU[a-f0-9]{32}$/i.test(cleanBundleSid)) {
    throw new Error(
      'bundleSid must be a valid Twilio Bundle SID'
    );
  }

  const result =
    await client.numbers.v2.regulatoryCompliance
      .bundles(cleanBundleSid)
      .fetch();

  return {
    sid: result.sid,
    regulationSid:
      result.regulationSid ||
      null,
    friendlyName:
      result.friendlyName ||
      null,
    status:
      result.status ||
      null,
    validUntil:
      result.validUntil ||
      null,
    email:
      result.email ||
      null,
    statusCallback:
      result.statusCallback ||
      null,
  };
}

async function submitRegulatoryBundle({
  bundleSid,
}) {
  const client = getClient();

  const cleanBundleSid = String(
    bundleSid || ''
  ).trim();

  if (!/^BU[a-f0-9]{32}$/i.test(cleanBundleSid)) {
    throw new Error(
      'bundleSid must be a valid Twilio Bundle SID'
    );
  }

  const result =
    await client.numbers.v2.regulatoryCompliance
      .bundles(cleanBundleSid)
      .update({
        status: 'pending-review',
      });

  return {
    sid: result.sid,
    regulationSid:
      result.regulationSid ||
      null,
    friendlyName:
      result.friendlyName ||
      null,
    status:
      result.status ||
      'pending-review',
    normalizedStatus:
      normalizeRegulatoryBundleStatus(
        result.status ||
        'pending-review'
      ),
    validUntil:
      result.validUntil ||
      null,
    email:
      result.email ||
      null,
    statusCallback:
      result.statusCallback ||
      null,
  };
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
  normalizeRegulatoryBundleStatus,
  searchAvailable,
  getRegulations,
  createRegulatoryEndUser,
  createRegulatoryBundle,
  assignRegulatoryItem,
  getRegulatoryBundle,
  submitRegulatoryBundle,
  listRegulatorySupportingDocumentTypes,
  createRegulatorySupportingDocument,
  purchaseNumber,
  releaseNumber,
};

export default adapter;