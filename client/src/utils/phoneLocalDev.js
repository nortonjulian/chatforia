export function toE164Dev(input, region = 'US') {
  const s = String(input || '');
  const digits = s.replace(/\D+/g, '');
  if (!digits) return '';
  // very simple US dev normalizer: 10 digits -> +1..., 11 with leading 1 -> +...
  if (region === 'US') {
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  }
  // fallback: if already has +, keep it; else just prefix +
  return s.trim().startsWith('+') ? s.trim() : `+${digits}`;
}
