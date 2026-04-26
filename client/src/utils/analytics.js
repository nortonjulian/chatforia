import posthog from 'posthog-js';

const key = import.meta.env.VITE_POSTHOG_KEY;

console.log('[PostHog] key exists?', Boolean(key));

if (key) {
  posthog.init(key, {
    api_host: 'https://us.i.posthog.com',
    autocapture: true,
    capture_pageview: true,
    loaded: (ph) => {
      console.log('[PostHog] loaded');
      ph.capture('test_event');
    },
  });
}

export default posthog;