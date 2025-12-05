import fetch from 'node-fetch';
import { ONEGLOBAL } from '../config/esim.js';

export async function oneglobalRequest(path, { method = 'GET', body } = {}) {
  if (!ONEGLOBAL.baseUrl) {
    throw new Error('ONEGLOBAL_BASE_URL is not configured');
  }

  const url = new URL(path, ONEGLOBAL.baseUrl).toString();

  const headers = {
    'Content-Type': 'application/json',
  };

  if (ONEGLOBAL.apiKey) {
    headers.Authorization = `Bearer ${ONEGLOBAL.apiKey}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `[1GLOBAL] ${method} ${url} failed: ${res.status} ${res.statusText} — ${text.slice(
        0,
        500
      )}`
    );
  }

  return res.json().catch(() => ({}));
}
