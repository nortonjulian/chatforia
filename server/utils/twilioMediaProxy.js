import Boom from '@hapi/boom';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

export async function fetchTwilioMedia(url) {
  if (!ACCOUNT_SID || !AUTH_TOKEN) {
    throw Boom.badImplementation('Twilio credentials missing (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN)');
  }

  // Twilio media URLs require auth. Use Basic Auth.
  const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');

  const resp = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
    redirect: 'follow',
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw Boom.badGateway(`Twilio media fetch failed (${resp.status}) ${text.slice(0, 120)}`);
  }

  return resp; // Response with streaming body
}
