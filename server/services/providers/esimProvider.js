// Right now we only support 1GLOBAL.
// If you ever add more providers, you can switch on ESIM_PROVIDER here.
import * as oneglobal from './oneglobalEsim.js';
import { ESIM_ENABLED, ESIM_PROVIDER } from '../../config/esim.js';

function ensureEnabled() {
  if (!ESIM_ENABLED) {
    throw new Error('eSIM feature is disabled');
  }
}

/**
 * Resolve the active eSIM provider implementation.
 * Currently only supports "oneglobal".
 */
function ensureProvider() {
  const provider = (ESIM_PROVIDER || 'oneglobal').toLowerCase();

  switch (provider) {
    case 'oneglobal':
      return oneglobal;
    default:
      throw new Error(`Unsupported eSIM provider: ${provider}`);
  }
}

/**
 * Reserve an eSIM profile / line for a user in a given region.
 * Used by /esim/profiles (reserveProfile controller).
 */
export async function reserveEsimProfile(params) {
  ensureEnabled();
  const provider = ensureProvider();

  if (typeof provider.reserveEsimProfile !== 'function') {
    throw new Error('reserveEsimProfile not implemented for current eSIM provider');
  }

  return provider.reserveEsimProfile(params);
}

/**
 * Activate a reserved profile (ICCID + code).
 * Used by /esim/activate.
 */
export async function activateProfile(params) {
  ensureEnabled();
  const provider = ensureProvider();

  if (typeof provider.activateProfile !== 'function') {
    throw new Error('activateProfile not implemented for current eSIM provider');
  }

  return provider.activateProfile(params);
}

/**
 * Suspend an active line by ICCID.
 * Used by /esim/suspend.
 */
export async function suspendLine(params) {
  ensureEnabled();
  const provider = ensureProvider();

  if (typeof provider.suspendLine !== 'function') {
    throw new Error('suspendLine not implemented for current eSIM provider');
  }

  return provider.suspendLine(params);
}

/**
 * Resume a suspended line by ICCID.
 * Used by /esim/resume.
 */
export async function resumeLine(params) {
  ensureEnabled();
  const provider = ensureProvider();

  if (typeof provider.resumeLine !== 'function') {
    throw new Error('resumeLine not implemented for current eSIM provider');
  }

  return provider.resumeLine(params);
}

/**
 * Provision an eSIM data pack for a billing add-on.
 * This is called from billing flows (e.g. handleAddonCheckoutCompleted).
 */
export async function provisionEsimPack(params) {
  ensureEnabled();
  const provider = ensureProvider();

  if (typeof provider.provisionEsimPack !== 'function') {
    throw new Error('provisionEsimPack not implemented for current eSIM provider');
  }

  return provider.provisionEsimPack(params);
}

/**
 * Fetch usage for a given eSIM profile (optional, for usage sync / dashboards).
 */
export async function fetchEsimUsage(profileId) {
  ensureEnabled();
  const provider = ensureProvider();

  if (typeof provider.fetchEsimUsage !== 'function') {
    throw new Error('fetchEsimUsage not implemented for current eSIM provider');
  }

  return provider.fetchEsimUsage(profileId);
}
