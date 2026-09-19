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
 *
 * @returns {object} provider module and provider name
 */
function ensureProvider() {
  const providerKey = (ESIM_PROVIDER || 'telna').toLowerCase();

  switch (providerKey) {
    case 'telna':
      return { impl: telna, name: 'telna' };

    case 'plintron':
      return { impl: plintron, name: 'plintron' };

    default: {
      const err = new Error(
        `Unsupported eSIM provider: ${ESIM_PROVIDER}`
      );
      err.code = 'ESIM_UNSUPPORTED_PROVIDER';
      throw err;
    }
  }
}

/**
 * Call a provider function and attach the provider name to errors.
 *
 * @param {string} fnName
 * @param {Array} args
 */
async function callProvider(fnName, args) {
  const { impl, name } = ensureProvider();

  const fn = impl[fnName];

  if (typeof fn !== 'function') {
    const err = new Error(
      `${fnName} not implemented for current eSIM provider (${name})`
    );
    err.code = 'ESIM_PROVIDER_MISSING_FN';
    throw err;
  }

  try {
    return await fn(...args);
  } catch (err) {
    const wrapped = new Error(
      `eSIM provider (${name}) error in ${fnName}: ${err.message}`
    );

    wrapped.code =
      err.code || 'ESIM_PROVIDER_ERROR';

    wrapped.provider = name;
    wrapped.cause = err;

    if (err.providerMeta !== undefined) {
      wrapped.providerMeta = err.providerMeta;
    }

    if (err.requestId) {
      wrapped.requestId = err.requestId;
    }

    if (err.status) {
      wrapped.status = err.status;
    }

    throw wrapped;
  }
}

/**
 * Discover/reserve an eSIM profile for a user.
 *
 * Telna Connect v2.1 uses this operation for discovery. The caller is
 * responsible for atomically claiming the returned ICCID in Chatforia.
 *
 * params:
 * {
 *   userId?: number,
 *   region: string,
 *   testMode?: boolean,
 *   excludedIccids?: string[]
 * }
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
    const err = new Error(
      'reserveEsimProfile expects a params object'
    );
    err.code = 'ESIM_INVALID_PARAMS';
    throw err;
  }

  if (
    !params.region ||
    typeof params.region !== 'string'
  ) {
    const err = new Error(
      'reserveEsimProfile requires a region string'
    );
    err.code = 'ESIM_INVALID_REGION';
    throw err;
  }

  if (
    params.excludedIccids !== undefined &&
    !Array.isArray(params.excludedIccids)
  ) {
    const err = new Error(
      'reserveEsimProfile excludedIccids must be an array when provided'
    );
    err.code = 'ESIM_INVALID_EXCLUDED_ICCIDS';
    throw err;
  }

  return callProvider(
    'reserveEsimProfile',
    [params]
  );
}

/**
 * Activate/check activation of a profile.
 *
 * params:
 * {
 *   providerProfileId?: string,
 *   iccid?: string,
 *   activationCode?: string,
 *   testMode?: boolean
 * }
 */
export async function activateProfile(params = {}) {
  ensureEnabled();

  if (!params || typeof params !== 'object') {
    const err = new Error(
      'activateProfile expects a params object'
    );
    err.code = 'ESIM_INVALID_PARAMS';
    throw err;
  }

  if (
    !params.providerProfileId &&
    !params.iccid &&
    !params.activationCode
  ) {
    const err = new Error(
      'activateProfile requires providerProfileId, iccid, or activationCode'
    );
    err.code =
      'ESIM_MISSING_ACTIVATION_IDENTIFIERS';
    throw err;
  }

  return callProvider(
    'activateProfile',
    [params]
  );
}

/**
 * Suspend an active line by providerProfileId or ICCID.
 *
 * The selected provider decides whether SIM-level suspension is
 * supported.
 */
export async function suspendLine(params = {}) {
  ensureEnabled();

  if (!params || typeof params !== 'object') {
    const err = new Error(
      'suspendLine expects a params object'
    );
    err.code = 'ESIM_INVALID_PARAMS';
    throw err;
  }

  if (
    !params.providerProfileId &&
    !params.iccid
  ) {
    const err = new Error(
      'suspendLine requires providerProfileId or iccid'
    );
    err.code = 'ESIM_MISSING_IDENTIFIER';
    throw err;
  }

  return callProvider(
    'suspendLine',
    [params]
  );
}

/**
 * Resume a suspended line by providerProfileId or ICCID.
 *
 * The selected provider decides whether SIM-level resume is supported.
 */
export async function resumeLine(params = {}) {
  ensureEnabled();

  if (!params || typeof params !== 'object') {
    const err = new Error(
      'resumeLine expects a params object'
    );
    err.code = 'ESIM_INVALID_PARAMS';
    throw err;
  }

  if (
    !params.providerProfileId &&
    !params.iccid
  ) {
    const err = new Error(
      'resumeLine requires providerProfileId or iccid'
    );
    err.code = 'ESIM_MISSING_IDENTIFIER';
    throw err;
  }

  return callProvider(
    'resumeLine',
    [params]
  );
}

/**
 * Provision an eSIM data pack.
 *
 * providerProfileId is retained because existing provider integrations
 * use it. ICCID is also passed through because Telna Connect v2.1
 * package creation identifies the SIM by ICCID.
 *
 * params:
 * {
 *   userId: number,
 *   providerProfileId: string,
 *   iccid?: string,
 *   addonKind: string,
 *   planCode?: string,
 *   testMode?: boolean,
 *   timeAllowance?: number
 * }
 */
export async function provisionEsimPack(params = {}) {
  ensureEnabled();

  if (!params || typeof params !== 'object') {
    const err = new Error(
      'provisionEsimPack expects a params object'
    );
    err.code = 'ESIM_INVALID_PARAMS';
    throw err;
  }

  if (
    !params.userId ||
    typeof params.userId !== 'number'
  ) {
    const err = new Error(
      'provisionEsimPack requires userId (number)'
    );
    err.code = 'ESIM_INVALID_USERID';
    throw err;
  }

  if (
    !params.providerProfileId ||
    typeof params.providerProfileId !== 'string'
  ) {
    const err = new Error(
      'provisionEsimPack requires providerProfileId (string)'
    );
    err.code =
      'ESIM_INVALID_PROVIDER_PROFILE_ID';
    throw err;
  }

  if (
    params.iccid !== undefined &&
    params.iccid !== null &&
    typeof params.iccid !== 'string'
  ) {
    const err = new Error(
      'provisionEsimPack iccid must be a string when provided'
    );
    err.code = 'ESIM_INVALID_ICCID';
    throw err;
  }

  if (
    !params.addonKind ||
    typeof params.addonKind !== 'string'
  ) {
    const err = new Error(
      'provisionEsimPack requires addonKind (string)'
    );
    err.code = 'ESIM_INVALID_ADDON_KIND';
    throw err;
  }

  if (
    params.planCode !== undefined &&
    params.planCode !== null &&
    typeof params.planCode !== 'string'
  ) {
    const err = new Error(
      'provisionEsimPack planCode must be a string when provided'
    );
    err.code = 'ESIM_INVALID_PLAN_CODE';
    throw err;
  }

  if (
    params.timeAllowance !== undefined &&
    params.timeAllowance !== null &&
    (
      typeof params.timeAllowance !== 'number' ||
      !Number.isInteger(params.timeAllowance) ||
      params.timeAllowance <= 0
    )
  ) {
    const err = new Error(
      'provisionEsimPack timeAllowance must be a positive integer when provided'
    );
    err.code =
      'ESIM_INVALID_TIME_ALLOWANCE';
    throw err;
  }

  return callProvider(
    'provisionEsimPack',
    [params]
  );
}

/**
 * Fetch provider usage for a provider-specific purchase/package
 * identifier.
 *
 * For Telna Connect v2.1 this identifier is the Telna package ID.
 * Other providers remain free to interpret the scalar identifier
 * according to their own adapter contract.
 *
 * Returns:
 * {
 *   usedMb: number | null,
 *   totalMb: number | null,
 *   remainingMb: number | null,
 *   expiresAt: Date | null,
 *   providerMeta: object | null
 * }
 */
export async function fetchEsimUsage(providerUsageId) {
  ensureEnabled();

  if (
    providerUsageId === null ||
    providerUsageId === undefined ||
    (
      typeof providerUsageId !== 'string' &&
      typeof providerUsageId !== 'number'
    ) ||
    String(providerUsageId).trim() === ''
  ) {
    const err = new Error(
      'fetchEsimUsage requires a provider usage identifier (string or number)'
    );
    err.code =
      'ESIM_INVALID_USAGE_IDENTIFIER';
    throw err;
  }

  return callProvider(
    'fetchEsimUsage',
    [String(providerUsageId)]
  );
}