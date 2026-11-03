export const PRIVACY_KEY = 'chatforia:privacy:v1';
export const PRIVACY_EVENT = 'chatforia:privacy-change';

export function readPrivacy() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(PRIVACY_KEY)); } catch { /* deny */ }
  const gpc = typeof navigator !== 'undefined' && navigator.globalPrivacyControl === true;
  const decided = saved?.version === 1;
  return {
    decided, gpc,
    analytics: !gpc && decided && saved.analytics === true,
    advertising: !gpc && decided && saved.advertising === true,
  };
}

export function savePrivacy({ analytics, advertising }) {
  try {
    localStorage.setItem(PRIVACY_KEY, JSON.stringify({ version: 1, analytics: analytics === true, advertising: advertising === true }));
  } catch { return false; }
  window.dispatchEvent(new Event(PRIVACY_EVENT));
  return true;
}

export function subscribePrivacy(listener) {
  const storage = (event) => { if (event.key === PRIVACY_KEY || event.key === null) listener(); };
  window.addEventListener(PRIVACY_EVENT, listener);
  window.addEventListener('storage', storage);
  window.addEventListener('focus', listener);
  return () => {
    window.removeEventListener(PRIVACY_EVENT, listener);
    window.removeEventListener('storage', storage);
    window.removeEventListener('focus', listener);
  };
}
