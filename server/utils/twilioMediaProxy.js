import Boom from '@hapi/boom';

// Twilio's authenticated MMS endpoint may redirect to a short-lived CDN URL.
// The legacy S3 host covers media created before Twilio enabled HTTP auth.
// Do not follow arbitrary redirects or forward Twilio credentials to the CDN.
const MEDIA_REDIRECT_HOSTS = new Set([
  'mms.twiliocdn.com',
  's3-external-1.amazonaws.com',
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export async function fetchTwilioMedia(url) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw Boom.badImplementation('Twilio credentials missing (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN)');
  }

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  let resp = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
    redirect: 'manual',
  });

  if (REDIRECT_STATUSES.has(resp.status)) {
    const location = resp.headers.get('location');
    let target;
    try {
      target = new URL(location);
    } catch {
      throw Boom.badGateway('Invalid Twilio media redirect');
    }

    if (target.protocol !== 'https:' || target.port ||
        target.username || target.password || target.hash ||
        !MEDIA_REDIRECT_HOSTS.has(target.hostname.toLowerCase())) {
      throw Boom.badGateway('Unsupported Twilio media redirect');
    }

    // Second request deliberately has NO Authorization header. Never follow
    // another redirect (including one initiated by the allowed CDN).
    resp = await fetch(target.href, { redirect: 'manual' });
  }

  if (!resp.ok) {
    // Avoid recording untrusted upstream response bodies or signed CDN URLs.
    throw Boom.badGateway(`Twilio media fetch failed (${resp.status})`);
  }

  return resp;
}
