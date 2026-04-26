const ANALYTICS_ENABLED =
  String(process.env.ANALYTICS_ENABLED || 'true').toLowerCase() !== 'false';

const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY || '';
const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://app.posthog.com';

async function posthogCapture(event, properties = {}) {
  if (!POSTHOG_API_KEY) return;

  const distinctId =
    properties.userId ||
    properties.distinctId ||
    properties.email ||
    'anonymous_server';

  await fetch(`${POSTHOG_HOST}/capture/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_key: POSTHOG_API_KEY,
      event,
      distinct_id: String(distinctId),
      properties: {
        ...properties,
        source: properties.source || 'backend',
        environment: process.env.NODE_ENV || 'development',
      },
    }),
  });
}

const AnalyticsManager = {
  async capture(event, properties = {}) {
    if (!ANALYTICS_ENABLED) return;

    try {
      await posthogCapture(event, properties);

      if (process.env.NODE_ENV !== 'production') {
        console.log('[analytics]', event, properties);
      }
    } catch (err) {
      console.error('[analytics] capture failed:', {
        event,
        message: err?.message,
      });
    }
  },
};

export default AnalyticsManager;