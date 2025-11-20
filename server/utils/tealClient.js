import fetch from 'node-fetch';
import { TEAL } from '../config/esim.js';

// TEAL comes from config/esim.js, which already reads env vars like:
//   TEAL_API_KEY, TEAL_API_BASE, TEAL_PARTNER_ID, etc.

if (!TEAL?.apiKey) {
  console.warn('[tealClient] Teal API key not set – Teal integration is effectively disabled.');
}

/**
 * Minimal helper to call Teal's API.
 * Only used when TEAL.apiKey is configured.
 */
async function tealRequest(path, { method = 'GET', body } = {}) {
  if (!TEAL?.apiKey) {
    throw new Error('Teal is not configured (missing API key)');
  }

  const base = TEAL.baseUrl || process.env.TEAL_API_BASE || 'https://api.teal.example.com';

  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TEAL.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Teal API error ${res.status}: ${text}`);
  }

  return res.json();
}

/**
 * Provision an eSIM data pack for a user.
 *
 * Called from billing.js in handleAddonCheckoutCompleted.
 *
 * Params:
 *  - userId: number | string
 *  - addonKind: "ESIM_STARTER" | "ESIM_TRAVELER" | "ESIM_POWER" | etc.
 *  - planCode: string (mapped from env like TEAL_PLAN_ESIM_STARTER)
 *
 * Returns:
 *  {
 *    tealProfileId?: string;
 *    qrCodeSvg?: string;
 *    iccid?: string;
 *    expiresAt?: Date | null;
 *    dataMb?: number | null;
 *  }
 */
export async function provisionEsimPack({ userId, addonKind, planCode }) {
  // If Teal isn’t wired yet, don’t blow up billing/webhooks.
  if (!TEAL?.apiKey) {
    console.warn(
      '[tealClient] provisionEsimPack called but Teal is not configured. ' +
        'Returning stub provision result for',
      addonKind
    );
    return {
      tealProfileId: null,
      qrCodeSvg: null,
      iccid: null,
      expiresAt: null,
      dataMb: null,
    };
  }

  // TODO: adjust this payload to match Teal’s real spec.
  const payload = {
    externalUserId: String(userId),
    addonKind,          // e.g. "ESIM_STARTER"
    planCode,           // e.g. TEAL_PLAN_ESIM_STARTER
    partnerId: TEAL.partnerId || undefined,
  };

  const data = await tealRequest('/esim/provision', {
    method: 'POST',
    body: payload,
  });

  // Expect something like:
  // { profileId, qrCodeSvg, iccid, expiresAt, dataMb }
  return {
    tealProfileId: data.profileId ?? data.id ?? null,
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
 * Fetch current usage for a Teal profile.
 *
 * Intended to be used by tealSync.js when you’re ready to wire real usage.
 */
export async function fetchEsimUsage(tealProfileId) {
  if (!TEAL?.apiKey) {
    console.warn(
      '[tealClient] fetchEsimUsage called but Teal is not configured – returning null usage.'
    );
    return {
      usedMb: null,
      totalMb: null,
      remainingMb: null,
      expiresAt: null,
    };
  }

  const data = await tealRequest(
    `/esim/${encodeURIComponent(tealProfileId)}/usage`,
    { method: 'GET' }
  );

  // Expect something like: { usedMb, totalMb, remainingMb, expiresAt }
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
