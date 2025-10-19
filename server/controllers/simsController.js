import { ENV } from '../config/env.js';

function ensureEnabled(res) {
  const enabled = String(ENV.FEATURE_PHYSICAL_SIM || '').toLowerCase() === 'true';
  if (!enabled) {
    res.status(403).json({ error: 'Physical SIM feature is disabled' });
    return false;
  }
  return true;
}

export async function orderSim(req, res) {
  if (!ensureEnabled(res)) return;
  try {
    // Expect shipping details; validate carefully (address, name, etc.)
    const { name, address1, city, region, postal, country } = req.body || {};
    if (!name || !address1 || !city || !region || !postal || !country) {
      return res.status(400).json({ error: 'Incomplete shipping address' });
    }

    // TODO: call your logistics/fulfillment provider; store order in DB
    // const order = await fulfillment.createSimOrder({ ... });
    res.json({ ok: true /*, orderId: order.id */ });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[sims] orderSim error:', err);
    res.status(500).json({ error: 'Failed to place SIM order' });
  }
}
