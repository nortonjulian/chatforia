import { ENV } from '../config/env.js';
import { ESIM_ENABLED } from '../config/esim.js';
import * as esimProvider from '../services/providers/esimProvider.js';

function isEnabled() {
  // Prefer ESIM_ENABLED from config/esim.js, but fall back to ENV.FEATURE_ESIM
  if (typeof ESIM_ENABLED === 'boolean') {
    return ESIM_ENABLED;
  }
  const v = ENV?.FEATURE_ESIM;
  return v === true || String(v).toLowerCase() === 'true';
}

function ensureEnabled(res) {
  if (!isEnabled()) {
    res.status(403).json({ error: 'eSIM feature is disabled' });
    return false;
  }
  return true;
}

/**
 * GET /esim/regions
 * Returns a configurable list of supported regions.
 * Configure via ESIM_REGIONS (comma-separated), e.g. "US,EU,UK,CA,AU,JP"
 */
export async function listRegions(_req, res) {
  const regions = (process.env.ESIM_REGIONS ||
    'US,EU,UK,CA,AU,JP,MX,BR,IN,ZA,SG,HK,KR,AE')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  return res.json({ regions });
}

export async function reserveProfile(req, res) {
  if (!ensureEnabled(res)) return;

  try {
    const regionRaw = req.body?.region ?? 'US';
    const region = String(regionRaw).trim().toUpperCase();
    const userId = req.user?.id ?? null; // assumes auth middleware (ok if null for now)

    if (typeof esimProvider.reserveEsimProfile !== 'function') {
      return res
        .status(501)
        .json({ error: 'reserveEsimProfile not implemented' });
    }

    const data = await esimProvider.reserveEsimProfile({ userId, region });
    if (!data || typeof data !== 'object') {
      return res
        .status(502)
        .json({ error: 'Invalid response from eSIM provider' });
    }

    const smdp = data.smdp || data.smDpPlus || null;
    const activationCode = data.activationCode || data.matchingId || null;

    // Prefer API-provided QR payload; otherwise build a standards-compliant LPA URI
    const lpaUri =
      data.lpaUri ||
      data.qrPayload ||
      (smdp && activationCode ? `LPA:1$${smdp}$${activationCode}` : null);

    const qrPayload = data.qrPayload || lpaUri || null;

    return res.json({
      iccidHint: data.iccid || data.iccidHint || null,
      smdp,
      activationCode,
      lpaUri,
      qrPayload,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[esim] reserveProfile error:', err);
    return res.status(500).json({ error: 'Failed to reserve eSIM profile' });
  }
}

export async function activateProfile(req, res) {
  if (!ensureEnabled(res)) return;

  try {
    if (typeof esimProvider.activateProfile !== 'function') {
      return res
        .status(501)
        .json({ error: 'activateProfile not implemented' });
    }

    const iccid = String(req.body?.iccid || '').trim();
    const code = String(req.body?.code || '').trim();

    if (!iccid || !code) {
      return res
        .status(400)
        .json({ error: 'iccid and code are required' });
    }

    const out = await esimProvider.activateProfile({ iccid, code });
    return res.json({ ok: true, ...out });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[esim] activateProfile error:', err);
    return res.status(500).json({ error: 'Failed to activate eSIM profile' });
  }
}

export async function suspendProfile(req, res) {
  if (!ensureEnabled(res)) return;

  try {
    if (typeof esimProvider.suspendLine !== 'function') {
      return res
        .status(501)
        .json({ error: 'suspendLine not implemented' });
    }

    const iccid = String(req.body?.iccid || '').trim();
    if (!iccid) {
      return res.status(400).json({ error: 'iccid is required' });
    }

    const out = await esimProvider.suspendLine({ iccid });
    return res.json({ ok: true, ...out });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[esim] suspendProfile error:', err);
    return res.status(500).json({ error: 'Failed to suspend eSIM line' });
  }
}

export async function resumeProfile(req, res) {
  if (!ensureEnabled(res)) return;

  try {
    if (typeof esimProvider.resumeLine !== 'function') {
      return res
        .status(501)
        .json({ error: 'resumeLine not implemented' });
    }

    const iccid = String(req.body?.iccid || '').trim();
    if (!iccid) {
      return res.status(400).json({ error: 'iccid is required' });
    }

    const out = await esimProvider.resumeLine({ iccid });
    return res.json({ ok: true, ...out });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[esim] resumeProfile error:', err);
    return res.status(500).json({ error: 'Failed to resume eSIM line' });
  }
}

/**
 * POST /esim/webhooks/telna
 * Webhook endpoint called by the eSIM provider (Telna) to notify about line/profile events.
 * (Currently just logs + 200; expand when you wire up real DB updates.)
 */
export async function handleEsimWebhook(req, res) {
  try {
    // eslint-disable-next-line no-console
    console.info('[esim] provider webhook received:', {
      headers: req.headers,
      body: req.body,
    });

    // TODO: parse event, update DB, etc.
    return res.status(200).json({ ok: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[esim] provider webhook error:', err);
    return res.status(500).json({ error: 'Failed to process eSIM webhook' });
  }
}
