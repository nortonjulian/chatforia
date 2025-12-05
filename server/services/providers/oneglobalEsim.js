import { ONEGLOBAL } from '../../config/esim.js';
import { oneglobalRequest } from '../../utils/oneglobalClient.js';

// Helper to check config
function ensureConfigured() {
  if (!ONEGLOBAL?.apiKey) {
    throw new Error('1GLOBAL is not configured (missing API key)');
  }
}

/**
 * Reserve an eSIM profile / line for a user in a given region.
 * This is what /esim/reserveProfile calls.
 */
export async function reserveEsimProfile({ userId, region }) {
  ensureConfigured();

  const payload = {
    externalUserId: userId ? String(userId) : undefined,
    region, // 'US', 'EU', etc.
  };

  // TODO: adapt to 1GLOBAL’s real API – path, payload, and response fields.
  const data = await oneglobalRequest('/esim/reserve', {
    method: 'POST',
    body: payload,
  });

  return {
    smdp: data.smdp || data.smDpPlus || null,
    activationCode: data.activationCode || data.matchingId || null,
    lpaUri: data.lpaUri || data.qrPayload || null,
    qrPayload: data.qrPayload || null,
    iccid: data.iccid || data.iccidHint || null,
    iccidHint: data.iccidHint || null,
  };
}

/**
 * Activate a profile given iccid + code.
 */
export async function activateProfile({ iccid, code }) {
  ensureConfigured();

  const payload = { iccid, code };

  // TODO: adapt endpoint + payload shape to Telna.
  const data = await telnaRequest('/esim/activate', {
    method: 'POST',
    body: payload,
  });

  return data; // controller simply spreads { ok: true, ...out }
}

/**
 * Suspend a line by ICCID.
 */
export async function suspendLine({ iccid }) {
  ensureConfigured();

  const data = await telnaRequest(`/esim/${encodeURIComponent(iccid)}/suspend`, {
    method: 'POST',
  });

  return data;
}

/**
 * Resume a suspended line by ICCID.
 */
export async function resumeLine({ iccid }) {
  ensureConfigured();

  const data = await telnaRequest(`/esim/${encodeURIComponent(iccid)}/resume`, {
    method: 'POST',
  });

  return data;
}

/**
 * Provision an eSIM data pack for a user (for billing add-ons).
 * This replaces Teal’s provisionEsimPack.
 */
export async function provisionEsimPack({ userId, addonKind, planCode }) {
  if (!TELNA?.apiKey) {
    console.warn(
      '[telnaEsim] provisionEsimPack called but Telna is not configured. Returning stub.'
    );
    return {
      providerProfileId: null,
      qrCodeSvg: null,
      iccid: null,
      expiresAt: null,
      dataMb: null,
    };
  }

  const payload = {
    externalUserId: String(userId),
    addonKind,
    planCode,
    partnerId: TELNA.partnerId || undefined,
  };

  // TODO: adapt to Telna’s actual provisioning endpoint.
  const data = await telnaRequest('/esim/provision', {
    method: 'POST',
    body: payload,
  });

  return {
    providerProfileId: data.profileId ?? data.id ?? null,
    qrCodeSvg: data.qrCodeSvg || null,
    iccid: data.iccid || null,
    expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
    dataMb:
      typeof data.dataMb === 'number'
        ? data.dataMb
        : typeof data.totalMb === 'number'
        ? data.totalMb
        : null,
  };
}

/**
 * Fetch current usage for a Telna profile (if you want usage sync).
 */
export async function fetchEsimUsage(providerProfileId) {
  if (!TELNA?.apiKey) {
    console.warn(
      '[telnaEsim] fetchEsimUsage called but Telna is not configured – returning null usage.'
    );
    return {
      usedMb: null,
      totalMb: null,
      remainingMb: null,
      expiresAt: null,
    };
  }

  const data = await telnaRequest(
    `/esim/${encodeURIComponent(providerProfileId)}/usage`,
    { method: 'GET' }
  );

  return {
    usedMb: data.usedMb ?? null,
    totalMb: data.totalMb ?? null,
    remainingMb:
      data.remainingMb ??
      (typeof data.totalMb === 'number' && typeof data.usedMb === 'number'
        ? data.totalMb - data.usedMb
        : null),
    expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
  };
}
