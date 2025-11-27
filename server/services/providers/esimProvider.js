// Right now we only support Telna.
// If you ever add more providers, you can switch on process.env.ESIM_PROVIDER here.
import * as telna from './telnaEsim.js';
import { ESIM_ENABLED } from '../../config/esim.js';

function ensureEnabled() {
  if (!ESIM_ENABLED) {
    throw new Error('eSIM feature is disabled');
  }
}

/**
 * Reserve an eSIM profile / line for a user in a given region.
 * Used by /esim/profiles (reserveProfile controller).
 */
export async function reserveEsimProfile(params) {
  ensureEnabled();
  if (typeof telna.reserveEsimProfile !== 'function') {
    throw new Error('reserveEsimProfile not implemented for Telna');
  }
  return telna.reserveEsimProfile(params);
}

/**
 * Activate a reserved profile (ICCID + code).
 * Used by /esim/activate.
 */
export async function activateProfile(params) {
  ensureEnabled();
  if (typeof telna.activateProfile !== 'function') {
    throw new Error('activateProfile not implemented for Telna');
  }
  return telna.activateProfile(params);
}

/**
 * Suspend an active line by ICCID.
 * Used by /esim/suspend.
 */
export async function suspendLine(params) {
  ensureEnabled();
  if (typeof telna.suspendLine !== 'function') {
    throw new Error('suspendLine not implemented for Telna');
  }
  return telna.suspendLine(params);
}

/**
 * Resume a suspended line by ICCID.
 * Used by /esim/resume.
 */
export async function resumeLine(params) {
  ensureEnabled();
  if (typeof telna.resumeLine !== 'function') {
    throw new Error('resumeLine not implemented for Telna');
  }
  return telna.resumeLine(params);
}

/**
 * Provision an eSIM data pack for a billing add-on.
 * This is called from billing flows (e.g. handleAddonCheckoutCompleted).
 */
export async function provisionEsimPack(params) {
  ensureEnabled();
  if (typeof telna.provisionEsimPack !== 'function') {
    throw new Error('provisionEsimPack not implemented for Telna');
  }
  return telna.provisionEsimPack(params);
}

/**
 * Fetch usage for a given eSIM profile (optional, for usage sync / dashboards).
 */
export async function fetchEsimUsage(profileId) {
  ensureEnabled();
  if (typeof telna.fetchEsimUsage !== 'function') {
    throw new Error('fetchEsimUsage not implemented for Telna');
  }
  return telna.fetchEsimUsage(profileId);
}
