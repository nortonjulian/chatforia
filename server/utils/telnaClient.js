import fetch from 'node-fetch';
import { TELNA } from '../config/esim.js'; // You'll update config/esim.js to export TELNA instead of TEAL

if (!TELNA?.apiKey) {
  console.warn('[telnaClient] Telna API key not set – Telna integration is effectively disabled.');
}

/**
 * Minimal helper to call Telna's API.
 * Only used when TELNA.apiKey is configured.
 */
async function telnaRequest(path, { method = 'GET', body } = {}) {
  if (!TELNA?.apiKey) {
    throw new Error('Telna is not configured (missing API key)');
  }

  // TODO: change this default base URL to Telna’s actual API base
  const base = TELNA.baseUrl || process.env.TELNA_API_BASE || 'https://api.telna.example.com';

  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TELNA.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Telna API error ${res.status}: ${text}`);
  }

  return res.json();
}

export { telnaRequest };
