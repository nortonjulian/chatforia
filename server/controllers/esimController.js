import { ENV } from '../config/env.js';
// If you’ve created services/providers/tealEsim.js, import it:
import * as teal from '../services/providers/tealEsim.js';

function ensureEnabled(res) {
  const enabled = String(ENV.FEATURE_ESIM || '').toLowerCase() === 'true';
  if (!enabled) {
    res.status(403).json({ error: 'eSIM feature is disabled' });
    return false;
  }
  return true;
}

export async function reserveProfile(req, res) {
  if (!ensureEnabled(res)) return;
  try {
    // Expect { region: 'US' | 'EU' | ... } from client; add more fields as needed
    const region = req.body?.region || 'US';
    const userId = req.user?.id; // assume auth middleware

    const data = await teal.reserveEsimProfile({ userId, region });
    // Normalize to a consistent payload your client expects
    res.json({
      iccidHint: data.iccid || data.iccidHint,
      smdp: data.smdp || data.smDpPlus,
      activationCode: data.activationCode || data.matchingId,
      // If your service returns a QR image or payload, include it:
      qrPayload: data.qrPayload || null,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[esim] reserveProfile error:', err);
    res.status(500).json({ error: 'Failed to reserve eSIM profile' });
  }
}

export async function activateProfile(req, res) {
  if (!ensureEnabled(res)) return;
  try {
    // Expect { iccid, code } or whatever your provider requires
    const { iccid, code } = req.body || {};
    if (!iccid || !code) return res.status(400).json({ error: 'iccid and code are required' });

    const out = await teal.activateProfile?.({ iccid, code });
    res.json({ ok: true, ...out });
  } catch (err) {
    console.error('[esim] activateProfile error:', err);
    res.status(500).json({ error: 'Failed to activate eSIM profile' });
  }
}

export async function suspendProfile(req, res) {
  if (!ensureEnabled(res)) return;
  try {
    const { iccid } = req.body || {};
    if (!iccid) return res.status(400).json({ error: 'iccid is required' });
    const out = await teal.suspendLine({ iccid });
    res.json({ ok: true, ...out });
  } catch (err) {
    console.error('[esim] suspendProfile error:', err);
    res.status(500).json({ error: 'Failed to suspend eSIM line' });
  }
}

export async function resumeProfile(req, res) {
  if (!ensureEnabled(res)) return;
  try {
    const { iccid } = req.body || {};
    if (!iccid) return res.status(400).json({ error: 'iccid is required' });
    const out = await teal.resumeLine({ iccid });
    res.json({ ok: true, ...out });
  } catch (err) {
    console.error('[esim] resumeProfile error:', err);
    res.status(500).json({ error: 'Failed to resume eSIM line' });
  }
}
