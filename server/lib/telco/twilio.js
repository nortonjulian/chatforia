import Twilio from 'twilio';

function getClient() {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('Missing Twilio credentials');
  return Twilio(sid, token);
}

/**
 * sendSms({ to, text, clientRef })
 * Return shape mirrors what smsService expects today.
 */
export async function sendSms({ to, text, clientRef }) {
  const client = getClient();

  // Prefer a Messaging Service SID if you have one; else fall back to a number.
  const fromConfig = process.env.TWILIO_MESSAGING_SERVICE_SID
    ? { messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID }
    : { from: process.env.TWILIO_PHONE_NUMBER };

  const msg = await client.messages.create({
    to,
    body: text,
    statusCallback: process.env.TWILIO_STATUS_WEBHOOK_URL || undefined, // optional
    ...fromConfig,
  });

  return {
    ok: true,
    provider: 'twilio',
    messageSid: msg.sid,
    clientRef: clientRef || null,
  };
}
