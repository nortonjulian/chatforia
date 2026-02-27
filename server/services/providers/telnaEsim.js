import EsimProvider from './esimProvider.js';
import { TELNA } from '../../config/esim.js';
import { telnaRequest } from '../../utils/telnaClient.js';

/**
 * Telna provider adapter.
 * Methods return normalized shapes + providerMeta for auditing.
 */
export default class TelnaEsim extends EsimProvider {
  constructor() {
    super('telna');
  }

  ensureConfigured() {
    if (!TELNA?.baseUrl) {
      const err = new Error('Telna not configured (missing baseUrl or credentials)');
      err.code = 'TELNA_NOT_CONFIGURED';
      throw err;
    }
  }

  /**
   * Reserve an eSIM profile / line for a user in a given region.
   * params: { userId?, region }
   * returns normalized object:
   * {
   *   providerProfileId, iccid, iccidHint, smdp, activationCode, lpaUri, qrPayload, providerMeta
   * }
   */
  async reserveEsimProfile({ userId, region } = {}) {
    this.ensureConfigured();

    const payload = {
      externalUserId: userId ? String(userId) : undefined,
      region,
    };

    try {
      const data = await telnaRequest('/esim/reserve', {
        method: 'POST',
        body: payload,
      });

      return {
        providerProfileId: data.profileId ?? data.id ?? null,
        iccid: data.iccid ?? null,
        iccidHint: data.iccidHint ?? null,
        smdp: data.smdp ?? data.smDpPlus ?? null,
        activationCode: data.activationCode ?? data.matchingId ?? null,
        lpaUri: data.lpaUri ?? null,
        qrPayload: data.qrPayload ?? data.qrPayloadString ?? null,
        providerMeta: data ?? null,
      };
    } catch (err) {
      // propagate with provider info (telnaRequest already annotates on timeout/retries)
      const wrapped = new Error(`Telna reserveEsimProfile failed: ${err.message}`);
      wrapped.code = err.code || 'TELNA_RESERVE_FAILED';
      wrapped.providerMeta = err.providerBody ?? null;
      throw wrapped;
    }
  }

  /**
   * Activate a reserved profile (providerProfileId / iccid / activationCode).
   * params: { providerProfileId?, iccid?, activationCode? }
   * returns: { ok: boolean, activatedAt?: Date, msisdn?: string|null, providerMeta?: object }
   */
  async activateProfile({ providerProfileId, iccid, activationCode } = {}) {
    this.ensureConfigured();

    const payload = {
      profileId: providerProfileId,
      iccid,
      activationCode,
    };

    try {
      const data = await telnaRequest('/esim/activate', {
        method: 'POST',
        body: payload,
      });

      // Some providers return activatedAt or timestamp fields; normalize if present.
      const activatedAt =
        data.activatedAt || data.activated_at || data.activationTimestamp || null;

      return {
        ok: Boolean(data.ok ?? data.success ?? true),
        activatedAt: activatedAt ? new Date(activatedAt) : undefined,
        msisdn: data.msisdn ?? data.msisdnAssigned ?? null,
        providerMeta: data ?? null,
      };
    } catch (err) {
      const wrapped = new Error(`Telna activateProfile failed: ${err.message}`);
      wrapped.code = err.code || 'TELNA_ACTIVATE_FAILED';
      wrapped.providerMeta = err.providerBody ?? null;
      throw wrapped;
    }
  }

  /**
   * Provision an eSIM data pack for a user (billing add-on).
   * params: { userId, providerProfileId, addonKind, planCode }
   * returns:
   * {
   *   providerPurchaseId, providerProfileId, iccid, qrCodeSvg, expiresAt, dataMb, providerMeta
   * }
   */
  async provisionEsimPack({ userId, providerProfileId, addonKind, planCode } = {}) {
    this.ensureConfigured();

    const payload = {
      externalUserId: String(userId),
      profileId: providerProfileId,
      addonKind,
      planCode,
      partnerId: TELNA.partnerId || undefined,
    };

    try {
      const data = await telnaRequest('/esim/provision', {
        method: 'POST',
        body: payload,
      });

      const expiresAt = data.expiresAt || data.expires_at || data.expiry || null;
      const expiresAtDate = expiresAt ? new Date(expiresAt) : null;

      // Normalize dataMb
      const dataMb =
        typeof data.dataMb === 'number'
          ? data.dataMb
          : typeof data.totalMb === 'number'
          ? data.totalMb
          : typeof data.megabytes === 'number'
          ? data.megabytes
          : null;

      return {
        providerPurchaseId: data.purchaseId ?? data.id ?? null,
        providerProfileId: data.profileId ?? providerProfileId ?? null,
        iccid: data.iccid ?? null,
        qrCodeSvg: data.qrCodeSvg ?? data.qrSvg ?? data.qr ?? null,
        expiresAt: expiresAtDate,
        dataMb,
        providerMeta: data ?? null,
      };
    } catch (err) {
      const wrapped = new Error(`Telna provisionEsimPack failed: ${err.message}`);
      wrapped.code = err.code || 'TELNA_PROVISION_FAILED';
      wrapped.providerMeta = err.providerBody ?? null;
      throw wrapped;
    }
  }

  /**
   * Fetch current usage for a given Telna profile (providerProfileId or iccid).
   * returns: { usedMb, totalMb, remainingMb, expiresAt, providerMeta }
   */
  async fetchEsimUsage(providerProfileId) {
    this.ensureConfigured();

    if (!providerProfileId) {
      const err = new Error('fetchEsimUsage requires providerProfileId');
      err.code = 'TELNA_MISSING_PROFILE_ID';
      throw err;
    }

    try {
      const path = `/esim/${encodeURIComponent(String(providerProfileId))}/usage`;
      const data = await telnaRequest(path, { method: 'GET' });

      const totalMb =
        typeof data.totalMb === 'number'
          ? data.totalMb
          : typeof data.dataMb === 'number'
          ? data.dataMb
          : null;

      const usedMb =
        typeof data.usedMb === 'number'
          ? data.usedMb
          : typeof data.consumedMb === 'number'
          ? data.consumedMb
          : null;

      const remainingMb =
        typeof data.remainingMb === 'number'
          ? data.remainingMb
          : totalMb != null && usedMb != null
          ? Math.max(0, totalMb - usedMb)
          : null;

      const expiresAt = data.expiresAt ?? data.expires_at ?? null;
      const expiresAtDate = expiresAt ? new Date(expiresAt) : null;

      return {
        usedMb,
        totalMb,
        remainingMb,
        expiresAt: expiresAtDate,
        providerMeta: data ?? null,
      };
    } catch (err) {
      const wrapped = new Error(`Telna fetchEsimUsage failed: ${err.message}`);
      wrapped.code = err.code || 'TELNA_USAGE_FAILED';
      wrapped.providerMeta = err.providerBody ?? null;
      throw wrapped;
    }
  }
}