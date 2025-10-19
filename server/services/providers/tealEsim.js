import fetch from 'node-fetch';

const BASE = process.env.TEAL_BASE_URL;
const KEY  = process.env.TEAL_API_KEY;

function authHeaders() {
  return {
    'Authorization': `Bearer ${KEY}`,
    'Content-Type': 'application/json',
  };
}

export async function reserveEsimProfile({ userId, region }) {
  const res = await fetch(`${BASE}/esims/profiles`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ userId, region }),
  });
  if (!res.ok) throw new Error(`Teal reserve failed: ${res.status}`);
  const data = await res.json();
  // Expect activationCode / smdp+ / matchingId / qrPayload depending on Teal’s response shape
  return data;
}

export async function suspendLine({ iccid }) {
  const res = await fetch(`${BASE}/lines/${iccid}/suspend`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Teal suspend failed: ${res.status}`);
  return res.json();
}

export async function resumeLine({ iccid }) {
  const res = await fetch(`${BASE}/lines/${iccid}/resume`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Teal resume failed: ${res.status}`);
  return res.json();
}
