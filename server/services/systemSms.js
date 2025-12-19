import { sendSms as telcoSendSms } from '../lib/telco/index.js';
import { normalizeE164, isE164 } from '../utils/phone.js';

/**
 * System/verification/invite texts:
 * Always send from a stable DID (not a leased user DID).
 */
export async function sendSystemSms({ to, text }) {
  const toPhone = normalizeE164(to);
  if (!isE164(toPhone)) throw new Error('Invalid destination phone');

  const from =
    process.env.TWILIO_FROM_NUMBER ||
    process.env.TWILIO_PHONE_NUMBER ||
    null;

  if (!from) {
    throw new Error('Missing TWILIO_FROM_NUMBER (or TWILIO_PHONE_NUMBER) for system SMS');
  }

  return telcoSendSms({
    to: toPhone,
    text: String(text ?? ''),
    from, // stable DID
  });
}
