import * as oneglobal from './oneglobalEsim.js';
import * as telna from './telnaEsim.js';
import * as plintron from './plintronEsim.js';
import { ESIM_PROVIDER, ESIM_ENABLED } from '../../config/esim.js';

/**
 * Throw if eSIM feature is globally disabled.
 */
function ensureEnabled() {
  if (!ESIM_ENABLED) {
    const err = new Error('eSIM feature is disabled');
    err.code = 'ESIM_DISABLED';
    throw err;
  }
}

/**
 * Resolve the active eSIM provider implementation.
 * Currently supports 'oneglobal', 'telna', 'plintron'.
 *
 * @returns {object} provider module (must implement the expected functions)
 */
function ensureProvider() {
  const providerKey = (ESIM_PROVIDER || 'oneglobal').toLowerCase();

  switch (providerKey) {
    case 'oneglobal':
      return { impl: oneglobal, name: 'oneglobal' };
    case 'telna':
      return { impl: telna, name: 'telna' };
    case 'plintron':
      return { impl: plintron, name: 'plintron' };
    default: {
      const err = new Error(`Unsupported eSIM provider: ${ESIM_PROVIDER}`);
      err.code = 'ESIM_UNSUPPORTED_PROVIDER';
      throw err;
    }
  }
}

/**
 * Helper: call provider function if available, wrap errors to include provider name.
 * @param {string} fnName - name of function to call on provider
 * @param {Array} args - arguments to pass through to provider function
 */
async function callProvider(fnName, args) {
  const { impl, name } = ensureProvider();

  const fn = impl[fnName];
  if (typeof fn !== 'function') {
    const err = new Error(`${fnName} not implemented for current eSIM provider (${name})`);
    err.code = 'ESIM_PROVIDER_MISSING_FN';
    throw err;
  }

  try {
    return await fn(...args);
  } catch (err) {
    // attach provider name for easier debugging & auditing
    const wrapped = new Error(`eSIM provider (${name}) error in ${fnName}: ${err.message}`);
    wrapped.code = err.code || 'ESIM_PROVIDER_ERROR';
    wrapped.provider = name;
    wrapped.cause = err;
    throw wrapped;
  }
}

/**
 * Reserve an eSIM profile / line for a user in a given region.
 * Called by /esim/profiles (reserveProfile controller).
 *
 * params: { userId?: number, region: string }
 *
 * Returns:
 * {
 *   providerProfileId: string | null,
 *   iccid: string | null,
 *   iccidHint: string | null,
 *   smdp: string | null,
 *   activationCode: string | null,
 *   lpaUri: string | null,
 *   qrPayload: string | null,
 *   providerMeta: object | null
 * }
 */
export async function reserveEsimProfile(params = {}) {
  ensureEnabled();

  if (!params || typeof params !== 'object') {
    const err = new Error('reserveEsimProfile expects a params object');
    err.code = 'ESIM_INVALID_PARAMS';
    throw err;
  }
  if (!params.region || typeof params.region !== 'string') {
    const err = new Error('reserveEsimProfile requires a region string');
    err.code = 'ESIM_INVALID_REGION';
    throw err;
  }

  return callProvider('reserveEsimProfile', [params]);
}

/**
 * Activate a reserved profile (ICCID + activationCode / providerProfileId).
 * Called by /esim/activate.
 *
 * params: { providerProfileId?: string, iccid?: string, activationCode?: string }
 *
 * Returns:
 * {
 *   ok: boolean,
 *   activatedAt?: Date,
 *   msisdn?: string | null,
 *   providerMeta?: object
 * }
 */
export async function activateProfile(params = {}) {
  ensureEnabled();

  if (!params || typeof params !== 'object') {
    const err = new Error('activateProfile expects a params object');
    err.code = 'ESIM_INVALID_PARAMS';
    throw err;
  }

  // must supply at least one of providerProfileId | iccid | activationCode
  if (!params.providerProfileId && !params.iccid && !params.activationCode) {
    const err = new Error('activateProfile requires providerProfileId, iccid, or activationCode');
    err.code = 'ESIM_MISSING_ACTIVATION_IDENTIFIERS';
    throw err;
  }

  return callProvider('activateProfile', [params]);
}

/**
 * Suspend an active line by providerProfileId or iccid.
 * Called by /esim/suspend.
 *
 * params: { providerProfileId?: string, iccid?: string }
 *
 * Returns: { ok: boolean, providerMeta: object }
 */
export async function suspendLine(params = {}) {
  ensureEnabled();

  if (!params || typeof params !== 'object') {
    const err = new Error('suspendLine expects a params object');
    err.code = 'ESIM_INVALID_PARAMS';
    throw err;
  }

  if (!params.providerProfileId && !params.iccid) {
    const err = new Error('suspendLine requires providerProfileId or iccid');
    err.code = 'ESIM_MISSING_IDENTIFIER';
    throw err;
  }

  return callProvider('suspendLine', [params]);
}

/**
 * Resume a suspended line by providerProfileId or iccid.
 * Called by /esim/resume.
 *
 * params: { providerProfileId?: string, iccid?: string }
 *
 * Returns: { ok: boolean, providerMeta: object }
 */
export async function resumeLine(params = {}) {
  ensureEnabled();

  if (!params || typeof params !== 'object') {
    const err = new Error('resumeLine expects a params object');
    err.code = 'ESIM_INVALID_PARAMS';
    throw err;
  }

  if (!params.providerProfileId && !params.iccid) {
    const err = new Error('resumeLine requires providerProfileId or iccid');
    err.code = 'ESIM_MISSING_IDENTIFIER';
    throw err;
  }

  return callProvider('resumeLine', [params]);
}

/**
 * Provision an eSIM data pack for a billing add-on.
 * Called from billing flows (e.g. handleAddonCheckoutCompleted).
 *
 * params: { userId: number, providerProfileId: string, addonKind: string, planCode: string }
 *
 * Returns:
 * {
 *   providerPurchaseId: string | null,
 *   providerProfileId: string | null,
 *   iccid: string | null,
 *   qrCodeSvg: string | null,
 *   expiresAt: Date | null,
 *   dataMb: number | null,
 *   providerMeta: object | null
 * }
 */
export async function provisionEsimPack(params = {}) {
  ensureEnabled();

  if (!params || typeof params !== 'object') {
    const err = new Error('provisionEsimPack expects a params object');
    err.code = 'ESIM_INVALID_PARAMS';
    throw err;
  }

  if (!params.userId || typeof params.userId !== 'number') {
    const err = new Error('provisionEsimPack requires userId (number)');
    err.code = 'ESIM_INVALID_USERID';
    throw err;
  }

  if (!params.providerProfileId || typeof params.providerProfileId !== 'string') {
    const err = new Error('provisionEsimPack requires providerProfileId (string)');
    err.code = 'ESIM_INVALID_PROVIDER_PROFILE_ID';
    throw err;
  }

  if (!params.addonKind || typeof params.addonKind !== 'string') {
    const err = new Error('provisionEsimPack requires addonKind (string)');
    err.code = 'ESIM_INVALID_ADDON_KIND';
    throw err;
  }

  // planCode can be optional for some providers, but validate type if provided
  if (params.planCode && typeof params.planCode !== 'string') {
    const err = new Error('provisionEsimPack planCode must be a string when provided');
    err.code = 'ESIM_INVALID_PLAN_CODE';
    throw err;
  }

  return callProvider('provisionEsimPack', [params]);
}

/**
 * Fetch usage for a given eSIM profile (providerProfileId).
 * Used for periodic usage sync / dashboards.
 *
 * profileId: string (providerProfileId / iccid depending on provider)
 *
 * Returns:
 * { usedMb: number, totalMb: number, remainingMb: number, expiresAt: Date|null, providerMeta: object }
 */
export async function fetchEsimUsage(profileId) {
  ensureEnabled();

  if (!profileId || (typeof profileId !== 'string' && typeof profileId !== 'number')) {
    const err = new Error('fetchEsimUsage requires a profileId (string or number)');
    err.code = 'ESIM_INVALID_PROFILE_ID';
    throw err;
  }

  // Some providers expect the raw providerProfileId string, others may accept iccid.
  // We pass through the identifier and let provider implementers interpret it.
  return callProvider('fetchEsimUsage', [String(profileId)]);
}