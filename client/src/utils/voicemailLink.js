// Only a voicemail destination may survive this sign-in flow; never an arbitrary URL.
const KEY = 'chatforia.voicemailReturn';
export function voicemailLinkTarget(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
  try {
    const url = new URL(value, 'https://www.chatforia.com');
    if (url.origin !== 'https://www.chatforia.com' || !['/voicemail', '/voicemail/'].includes(url.pathname) || url.hash) return null;
    const ids = url.searchParams.getAll('id');
    if (ids.length > 1 || (ids.length && !/^[A-Za-z0-9_-]{1,128}$/.test(ids[0]))) return null;
    return ids.length ? `/voicemail?id=${encodeURIComponent(ids[0])}` : '/voicemail';
  } catch { return null; }
}
export function rememberVoicemailReturn(value) {
  const target = voicemailLinkTarget(value);
  if (!target) return null;
  try { sessionStorage.setItem(KEY, JSON.stringify({ target, expires: Date.now() + 30 * 60 * 1000 })); } catch { /* navigation still works without storage */ }
  return target;
}
export function pendingVoicemailReturn() {
  try {
    const entry = JSON.parse(sessionStorage.getItem(KEY));
    if (entry?.expires > Date.now()) return voicemailLinkTarget(entry.target);
    sessionStorage.removeItem(KEY);
  } catch { /* storage unavailable */ }
  return null;
}
export function clearVoicemailReturn() {
  try { sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}
