// Estimates only. Provider invoices/status records remain authoritative.
// GSM-7/UCS-2 limits: https://www.twilio.com/docs/glossary/what-sms-character-limit
const BASIC = new Set(Array.from('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'));
const EXTENDED = new Set(Array.from('\f^{}\\[~]|€'));
function nonnegative(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be finite and non-negative`);
  return value;
}
export function estimateSmsSegments(body, { tollFreeUsCanada = false } = {}) {
  const chars = Array.from(String(body || ''));
  if (!chars.length) return { encoding: 'GSM-7', segments: 0 };
  const gsm = chars.every(c => BASIC.has(c) || EXTENDED.has(c));
  const units = chars.map(c => gsm ? (EXTENDED.has(c) ? 2 : 1) : c.length);
  const total = units.reduce((a,b) => a+b,0);
  if (total <= (gsm ? 160 : 70)) return { encoding: gsm ? 'GSM-7' : 'UCS-2', segments: 1 };
  const capacity = gsm ? (tollFreeUsCanada ? 152 : 153) : (tollFreeUsCanada ? 66 : 67);
  let segments = 1; let used = 0;
  for (const n of units) {
    if (used+n > capacity) { segments++; used=0; }
    used += n;
  }
  return { encoding: gsm ? 'GSM-7' : 'UCS-2', segments };
}
export function estimateMessageCost({ body, mediaCount = 0, baseRate, carrierRate, tollFreeUsCanada = false }) {
  nonnegative(baseRate,'baseRate'); nonnegative(carrierRate,'carrierRate');
  nonnegative(mediaCount,'mediaCount');
  const info = mediaCount ? { encoding:'MMS',segments:0 } : estimateSmsSegments(body,{tollFreeUsCanada});
  const units = mediaCount ? 1 : info.segments;
  return { ...info, units, estimatedUsd: units*(baseRate+carrierRate) };
}
// Supply EACH connected provider leg separately. A 61-second forwarded call
// costs two billed minutes on both its inbound and outbound legs.
export function estimateCallCost(legs) {
  return legs.reduce((sum,{seconds,ratePerMinute}) => sum+
    Math.ceil(nonnegative(seconds,'seconds')/60)*nonnegative(ratePerMinute,'ratePerMinute'),0);
}
