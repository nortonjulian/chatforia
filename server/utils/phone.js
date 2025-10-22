import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Parse and normalize to strict E.164 (e.g., "+14155552671").
 * If the input starts with "+", region is ignored.
 * Returns null if invalid.
 */
export function toE164(raw, defaultCountry = 'US') {
  if (!raw) return null;
  const s = String(raw).trim();
  const pn = s.startsWith('+')
    ? parsePhoneNumberFromString(s)                 // regionless parse
    : parsePhoneNumberFromString(s, defaultCountry);
  return pn && pn.isValid() ? pn.number : null;
}

/**
 * Keep a digits-only helper for substring lookups / indexing.
 */
export function digitsOnly(s = '') {
  return String(s).replace(/[^\d]/g, '');
}

/**
 * Backward-compatible wrapper that normalizes to E.164.
 * Uses 'US' as default region when none is provided (to match prior behavior).
 * NOTE: prefer calling toE164(raw, region) directly where you can.
 */
export function normalizeE164(input, defaultCountry = 'US') {
  return toE164(input, defaultCountry);
}

/**
 * Validate if input can be converted to a proper E.164 number.
 * Optional defaultCountry for non-+ inputs.
 */
export function isE164(input, defaultCountry = 'US') {
  return toE164(input, defaultCountry) !== null;
}
