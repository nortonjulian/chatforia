/**
 * No network calls. Just logs a fake outbound and returns a Twilio-shaped response.
 * Safe for dev & tests. Never ship with SMS_PROVIDER=mock in prod.
 */
export async function sendSms({ to, text, clientRef }) {
  const sid = `SM_mock_${Date.now().toString(36)}`;
  console.log(`[MOCK SMS:OUT] sid=${sid} to=${to} text="${text}" ref=${clientRef || '-'}`);
  return {
    ok: true,
    provider: 'mock',
    messageSid: sid,
    clientRef: clientRef || null,
  };
}
