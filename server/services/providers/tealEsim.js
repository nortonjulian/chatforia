import fetch from 'node-fetch';

const BASE = process.env.TEAL_BASE_URL;
const KEY  = process.env.TEAL_API_KEY;

function authHeaders() {
  return { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
}

async function assertOk(res, label) {
  if (res.ok) return;
  const text = await res.text().catch(() => '');
  throw new Error(`${label} failed: ${res.status} ${res.statusText} ${text}`);
}

export async function reserveEsimProfile({ userId, region }) {
  const res = await fetch(`${BASE}/esims/profiles`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ userId, region }),
  });
  await assertOk(res, 'Teal reserve');
  return res.json();
}

export async function suspendLine({ iccid }) {
  const res = await fetch(`${BASE}/lines/${iccid}/suspend`, {
    method: 'POST',
    headers: authHeaders(),
  });
  await assertOk(res, 'Teal suspend');
  return res.json();
}

export async function resumeLine({ iccid }) {
  const res = await fetch(`${BASE}/lines/${iccid}/resume`, {
    method: 'POST',
    headers: authHeaders(),
  });
  await assertOk(res, 'Teal resume');
  return res.json();
}
