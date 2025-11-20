export async function fetchWirelessStatus() {
  const res = await fetch('/api/wireless/status', {
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    throw new Error('Failed to load wireless status');
  }

  return res.json();
}

// Dev-only helper: simulate consumption (non-production)
export async function debugConsumeData(mb) {
  const res = await fetch('/api/wireless/debug/consume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mb }),
  });

  if (!res.ok) {
    throw new Error('Failed to consume data');
  }

  return res.json();
}
