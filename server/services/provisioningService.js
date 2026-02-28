import { getEsimProviderConfig, ESIM_PROVIDER } from '../config/esim.js';

const _store = {
  sims: new Map(),        // simId -> { simId, iccid, status, profileId, ... }
  profiles: new Map()     // profileId -> { profileId, name, meta }
};

let _nextSimId = 1000;
let _nextProfileId = 5000;

function _now() { return new Date().toISOString(); }

/* ---------- existing helper functions ---------- */

export async function createProfile(payload = {}) {
  const profileId = String(_nextProfileId++);
  const profile = {
    profileId,
    name: payload.name || `profile-${profileId}`,
    metadata: payload.metadata || {},
    createdAt: _now()
  };
  _store.profiles.set(profileId, profile);
  return { success: true, profile };
}

export async function deleteProfile(profileId) {
  const existed = _store.profiles.delete(profileId);
  return { success: !!existed, profileId };
}

export async function listProfiles() {
  return { success: true, profiles: Array.from(_store.profiles.values()) };
}

export async function provisionSIM(opts = {}) {
  const simId = String(_nextSimId++);
  const sim = {
    simId,
    iccid: opts.iccid || `ICCID${simId}`,
    msisdn: opts.msisdn || null,
    profileId: opts.profileId || null,
    status: 'provisioned',
    createdAt: _now()
  };
  _store.sims.set(simId, sim);
  return { success: true, sim };
}

export async function getProvisioningStatus(simId) {
  const sim = _store.sims.get(String(simId));
  if (!sim) return { success: false, error: 'not_found', simId };
  return { success: true, sim };
}

export async function activateSIM(simId) {
  const sim = _store.sims.get(String(simId));
  if (!sim) return { success: false, error: 'not_found', simId };
  sim.status = 'active';
  sim.activatedAt = _now();
  return { success: true, sim };
}

export async function deactivateSIM(simId) {
  const sim = _store.sims.get(String(simId));
  if (!sim) return { success: false, error: 'not_found', simId };
  sim.status = 'suspended';
  sim.deactivatedAt = _now();
  return { success: true, sim };
}

export async function listSIMs(filter = {}) {
  let sims = Array.from(_store.sims.values());
  if (filter.status) sims = sims.filter(s => s.status === filter.status);
  return { success: true, sims };
}

/* ---------- new functions expected by routes ---------- */

/**
 * Create/Reserve an eSIM profile for the active provider.
 *
 * This function is intentionally generic:
 *  - It uses the active provider from config (getEsimProviderConfig) for logging/shape.
 *  - For now it creates a stable, deterministic "reserved profile" record in-memory
 *    and returns a normalized provider-shaped response so controllers/routes can use it.
 *
 * params: { userId?: number, region: string, planId?: string }
 * returns:
 * {
 *   providerProfileId, iccid, iccidHint, smdp, activationCode, lpaUri, qrPayload, providerMeta
 * }
 */
export async function createEsimProfileForProvider({ userId, region, planId } = {}) {
  if (!region || typeof region !== 'string') {
    return { success: false, error: 'invalid_region' };
  }

  // Build a provider-agnostic reserved profile record (stub)
  const profileId = String(_nextProfileId++);
  const providerName = (ESIM_PROVIDER || 'oneglobal').toLowerCase();
  const providerConfig = (getEsimProviderConfig && getEsimProviderConfig()) || {};

  const reserved = {
    providerProfileId: `prov-${providerName}-${profileId}`,
    iccid: null,
    iccidHint: `ICCID_HINT_${profileId}`,
    smdp: providerConfig.smdp || null,
    activationCode: null,
    lpaUri: null,
    qrPayload: null,
    providerMeta: {
      provider: providerName,
      planId: planId || providerConfig.defaultPlanId || null,
      requestedRegion: region,
      createdAt: _now()
    }
  };

  // save a lite-profile into the in-memory store (for local dev)
  _store.profiles.set(profileId, {
    profileId,
    reserved,
    createdAt: _now(),
    userId: userId ? String(userId) : null
  });

  return {
    success: true,
    ...reserved
  };
}

/**
 * Handle provider webhook (provider -> server).
 *
 * This is a minimal handler that normalizes the payload and returns an object
 * that your route controller can use to update DB/state. In prod you will:
 *  - Verify signature using provider webhook secret
 *  - Parse event types and map to actions (activated, suspended, usage updates, etc.)
 *
 * For now: accepts { provider, rawBody, headers } and returns a normalized object.
 */
export async function handleProviderWebhook({ provider, rawBody, headers } = {}) {
  if (!provider) {
    const err = new Error('provider required for webhook');
    err.code = 'WEBHOOK_MISSING_PROVIDER';
    throw err;
  }

  // naive normalization example:
  const event = {
    provider: provider,
    receivedAt: _now(),
    rawBody,
    headers: headers || {},
    parsed: null,
    handled: false
  };

  // try best-effort parse JSON bodies
  try {
    if (typeof rawBody === 'string') {
      event.parsed = JSON.parse(rawBody);
    } else if (rawBody && typeof rawBody === 'object') {
      event.parsed = rawBody;
    }
  } catch (e) {
    event.parsed = null;
  }

  // Basic mapping: if provider says iccid/activation happened, mark handled.
  if (event.parsed && (event.parsed.iccid || event.parsed.profileId || event.parsed.event === 'activated')) {
    event.handled = true;
  }

  // store webhook event into profiles map for visibility (dev only)
  const hookId = `hook-${Date.now()}`;
  _store.profiles.set(hookId, {
    profileId: hookId,
    webhookEvent: event,
    createdAt: _now()
  });

  return { success: true, event };
}

/* ---------- default export convenience ---------- */
const provisioningService = {
  createProfile,
  deleteProfile,
  listProfiles,
  provisionSIM,
  getProvisioningStatus,
  activateSIM,
  deactivateSIM,
  listSIMs,
  createEsimProfileForProvider,
  handleProviderWebhook
};

export default provisioningService;