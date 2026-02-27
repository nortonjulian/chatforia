import { PLINTRON } from '../../config/esim.js';
import { plintronRequest } from '../../utils/plintronClient.js';

// Helper to check config
function ensureConfigured() {
  if (!PLINTRON?.apiKey) {
    const err = new Error('Plintron is not configured (missing API key)');
    err.code = 'PLINTRON_NOT_CONFIGURED';
    throw err;
  }
}

/**
 * Reserve an eSIM profile / line for a user in a given region.
 * params: { userId?: number, region: string }
 *
 * Returns:
 * { providerProfileId, iccid, iccidHint, smdp, activationCode, lpaUri, qrPayload, providerMeta }
 */
export async function reserveEsimProfile({ userId, region } = {}) {
  ensureConfigured();

  if (!region || typeof region !== 'string') {
    const err = new Error('reserveEsimProfile requires region (string)');
    err.code = 'PLINTRON_INVALID_REGION';
    throw err;
  }

  const payload = {
    externalUserId: userId ? String(userId) : undefined,
    region,
  };

  const data = await plintronRequest('/esim/reserve', {
    method: 'POST',
    body: payload,
  });

  return {
    providerProfileId: data.profileId ?? data.id ?? null,
    smdp: data.smdp ?? null,
    activationCode: data.activationCode ?? data.matchingId ?? null,
    lpaUri: data.lpaUri ?? null,
    qrPayload: data.qrPayload ?? data.qr ?? null,
    iccid: data.iccid ?? data.iccidHint ?? null,
    iccidHint: data.iccidHint ?? null,
    providerMeta: data ?? null,
  };
}

/**
 * Activate a profile. Accepts providerProfileId | iccid | activationCode
 * params: { providerProfileId?, iccid?, activationCode? }
 *
 * Returns: { ok, activatedAt?, msisdn?, providerMeta }
 */
export async function activateProfile({ providerProfileId, iccid, activationCode } = {}) {
  ensureConfigured();

  if (!providerProfileId && !iccid && !activationCode) {
    const err = new Error('activateProfile requires providerProfileId, iccid, or activationCode');
    err.code = 'PLINTRON_MISSING_ACTIVATION_IDENTIFIERS';
    throw err;
  }

  const payload = {
    profileId: providerProfileId ?? undefined,
    iccid: iccid ?? undefined,
    activationCode: activationCode ?? undefined,
  };

  const data = await plintronRequest('/esim/activate', {
    method: 'POST',
    body: payload,
  });

  return {
    ok: data.ok !== false,
    activatedAt: data.activatedAt ? new Date(data.activatedAt) : new Date(),
    msisdn: data.msisdn ?? data.phoneNumber ?? null,
    providerMeta: data ?? null,
  };
}

/**
 * Suspend a line by providerProfileId or iccid.
 * params: { providerProfileId?, iccid? } -> { ok, providerMeta }
 */
export async function suspendLine({ providerProfileId, iccid } = {}) {
  ensureConfigured();

  const id = providerProfileId ?? iccid;
  if (!id) {
    const err = new Error('suspendLine requires providerProfileId or iccid');
    err.code = 'PLINTRON_MISSING_IDENTIFIER';
    throw err;
  }

  const path = `/esim/${encodeURIComponent(id)}/suspend`;
  const data = await plintronRequest(path, { method: 'POST' });

  return { ok: data.ok !== false, providerMeta: data ?? null };
}

/**
 * Resume a suspended line by providerProfileId or iccid.
 * params: { providerProfileId?, iccid? } -> { ok, providerMeta }
 */
export async function resumeLine({ providerProfileId, iccid } = {}) {
  ensureConfigured();

  const id = providerProfileId ?? iccid;
  if (!id) {
    const err = new Error('resumeLine requires providerProfileId or iccid');
    err.code = 'PLINTRON_MISSING_IDENTIFIER';
    throw err;
  }

  const path = `/esim/${encodeURIComponent(id)}/resume`;
  const data = await plintronRequest(path, { method: 'POST' });

  return { ok: data.ok !== false, providerMeta: data ?? null };
}

/**
 * Provision an eSIM data pack for a billing add-on.
 * params: { userId, providerProfileId, addonKind, planCode }
 *
 * Returns:
 * { providerPurchaseId, providerProfileId, iccid, qrCodeSvg, expiresAt, dataMb, providerMeta }
 */
export async function provisionEsimPack({ userId, providerProfileId, addonKind, planCode } = {}) {
  ensureConfigured();

  if (!userId || !providerProfileId || !addonKind) {
    const err = new Error('provisionEsimPack requires userId, providerProfileId and addonKind');
    err.code = 'PLINTRON_INVALID_PROVISION_PARAMS';
    throw err;
  }

  const payload = {
    externalUserId: String(userId),
    profileId: providerProfileId,
    addonKind,
    planCode,
  };

  const data = await plintronRequest('/esim/provision', {
    method: 'POST',
    body: payload,
  });

  return {
    providerPurchaseId: data.purchaseId ?? data.id ?? null,
    providerProfileId: data.profileId ?? providerProfileId ?? null,
    iccid: data.iccid ?? null,
    qrCodeSvg: data.qrCodeSvg ?? data.qrSvg ?? data.qr ?? null,
    expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
    dataMb:
      typeof data.dataMb === 'number'
        ? data.dataMb
        : typeof data.totalMb === 'number'
        ? data.totalMb
        : null,
    providerMeta: data ?? null,
  };
}

/**
 * Fetch usage for a Plintron profile.
 * Returns: { usedMb, totalMb, remainingMb, expiresAt, providerMeta }
 */
export async function fetchEsimUsage(providerProfileId) {
  ensureConfigured();

  if (!providerProfileId) {
    const err = new Error('fetchEsimUsage requires providerProfileId');
    err.code = 'PLINTRON_INVALID_PROFILE_ID';
    throw err;
  }

  const path = `/esim/${encodeURIComponent(providerProfileId)}/usage`;
  const data = await plintronRequest(path, { method: 'GET' });

  const usedMb = data.usedMb ?? null;
  const totalMb = data.totalMb ?? null;
  const remainingMb =
    data.remainingMb ??
    (typeof totalMb === 'number' && typeof usedMb === 'number' ? totalMb - usedMb : null);

  return {
    usedMb,
    totalMb,
    remainingMb,
    expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
    providerMeta: data ?? null,
  };
}