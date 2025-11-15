import Twilio from 'twilio';

function getClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (!sid || !token) throw new Error('Missing Twilio credentials');

  // Support both:
  //  - real Twilio default export (function)
  //  - Jest mock shape: { default: fn }
  const TwilioFn =
    typeof Twilio === 'function'
      ? Twilio
      : (Twilio && typeof Twilio.default === 'function'
          ? Twilio.default
          : null);

  if (!TwilioFn) {
    throw new Error('Twilio client factory is not a function');
  }

  return TwilioFn(sid, token);
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
    : (process.env.TWILIO_PHONE_NUMBER
        ? { from: process.env.TWILIO_PHONE_NUMBER }
        : {}); // if neither set, pass neither (Twilio will reject)

  const payload = {
    to,
    body: text,
    ...(process.env.TWILIO_STATUS_WEBHOOK_URL
      ? { statusCallback: process.env.TWILIO_STATUS_WEBHOOK_URL }
      : {}),
    ...fromConfig,
  };

  const msg = await client.messages.create(payload);

  return {
    ok: true,
    provider: 'twilio',
    messageSid: msg.sid,
    clientRef: clientRef || null,
  };
}
