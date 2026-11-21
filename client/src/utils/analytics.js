import { readPrivacy, subscribePrivacy } from '@/privacy/preferences';

let instance;
let loading;
const key = import.meta.env.VITE_POSTHOG_KEY;
async function getAnalytics() {
  if (!key || !readPrivacy().analytics) return null;
  if (!loading) loading = import('posthog-js').then(({ default: posthog }) => {
    // Consent can change while the SDK downloads.
    if (!readPrivacy().analytics) { loading = null; return null; }
    posthog.init(key, {
      api_host: 'https://us.i.posthog.com',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      opt_out_capturing_by_default: true,
    });
    posthog.opt_in_capturing();
    instance = posthog;
    return posthog;
  }).catch(() => { loading = null; return null; });
  return loading;
}
subscribePrivacy(() => {
  if (!readPrivacy().analytics && instance) instance.opt_out_capturing();
});

// Only the explicitly used methods are exposed; never queue pre-consent events.
export default {
  capture: async (...args) => {
    const ph = await getAnalytics();
    if (ph && readPrivacy().analytics) ph.capture(...args);
  },
  identify: async (...args) => {
    const ph = await getAnalytics();
    if (ph && readPrivacy().analytics) ph.identify(...args);
  },
};
