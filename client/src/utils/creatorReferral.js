const KEY = 'chatforia.creatorReferral';
const LIFETIME = 30 * 24 * 60 * 60 * 1000;
let memory = null;
const normalize = value => typeof value === 'string' && /^[A-Z0-9_-]{3,40}$/i.test(value.trim())
  ? value.trim().toUpperCase() : null;

export function clearCreatorReferral() {
  memory = null;
  try { window.localStorage.removeItem(KEY); } catch { /* Storage may be unavailable. */ }
}

export function currentCreatorReferral() {
  let saved = memory;
  try { saved = JSON.parse(window.localStorage.getItem(KEY)) || memory; } catch { /* Use session memory. */ }
  const age = Date.now() - saved?.savedAt;
  if (!normalize(saved?.code) || !Number.isFinite(age) || age < 0 || age >= LIFETIME) {
    clearCreatorReferral();
    return null;
  }
  memory = saved;
  return normalize(saved.code);
}

export function captureCreatorReferral(location = window.location) {
  let code;
  try {
    const path = location.pathname;
    if (path === '/register') code = new URLSearchParams(location.search).get('ref');
    else if (/^\/ref\/[^/]+$/.test(path)) code = decodeURIComponent(path.slice(5));
  } catch { return currentCreatorReferral(); }
  code = normalize(code);
  const existing = currentCreatorReferral();
  if (existing || !code) return existing;
  memory = { code, savedAt: Date.now() };
  try { window.localStorage.setItem(KEY, JSON.stringify(memory)); } catch { /* Keep in memory. */ }
  return code;
}
