import twilio from 'twilio';

const MODE = (process.env.SMS_PROVIDER || 'twilio').toLowerCase(); // 'mock' | 'twilio' | 'twilio-test'

function createTwilioClient() {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('Missing TWILIO credentials');
  return twilio(sid, token);
}

/**
 * sendSms({ to, body })
 * - 'twilio' / 'twilio-test': real Twilio API (test creds won’t deliver)
 * - 'mock': no network; just logs + returns a fake id
 */
export async function sendSms({ to, body }) {
  if (!to || !body) throw new Error('to and body required');

  if (MODE === 'mock') {
    const id = `mock_${Date.now()}`;
    console.log(`[MOCK SMS:OUT] id=${id} to=${to} body="${body}"`);
    return { id, provider: 'mock' };
  }

  // real / test Twilio
  const client = createTwilioClient();
  const from = process.env.TWILIO_MESSAGING_SERVICE_SID
    ? { messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID }
    : { from: process.env.TWILIO_PHONE_NUMBER };

  const msg = await client.messages.create({ to, body, ...from });
  return { id: msg.sid, provider: 'twilio' };
}

export function isMockProvider() {
  return MODE === 'mock';
}
