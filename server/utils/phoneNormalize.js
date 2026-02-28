import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Normalize a phone-like input to E.164 if parseable.
 * Returns normalized E.164 string (e.g. "+15551234567") or null if not parseable.
 *
 * defaultCountry is optional (e.g., 'US'). If you omit it, parser will try
 * to infer from input (leading +) which is OK for user-entered E.164.
 */
export default function normalizePhone(input, defaultCountry = undefined) {
  if (!input || typeof input !== 'string') return null;
  const cleaned = input.trim();
  try {
    const p = parsePhoneNumberFromString(cleaned, defaultCountry);
    if (p && p.isValid && p.isValid()) return p.number; // E.164
  } catch (e) {
    // ignore
  }
  // fallback: digits only but require leading plus or reasonable length
  const digits = cleaned.replace(/[^\d+]/g, '');
  if (digits.startsWith('+') && digits.length > 6) return digits;
  return null;
}