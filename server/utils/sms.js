import { sendSms as telcoSendSms } from '../lib/telco/index.js';
export async function sendSms(to, text) {
  // adapt old signature -> new signature
  return telcoSendSms({ to, text });
}
