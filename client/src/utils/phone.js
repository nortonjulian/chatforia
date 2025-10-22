import { parsePhoneNumberFromString } from 'libphonenumber-js';

// Normalize raw input to E.164 (e.g. +14155552671). Returns null if invalid.
export function toE164(raw, defaultCountry = 'US') {
  if (!raw) return null;
  const s = String(raw).trim();
  // If starts with +, library will ignore region; else it uses defaultCountry.
  const pn = parsePhoneNumberFromString(s, defaultCountry);
  if (!pn || !pn.isValid()) return null;
  return pn.number; // E.164
}

// Pretty-print for UI
export function formatForDisplay(e164, style = 'national') {
  if (!e164) return '';
  const pn = parsePhoneNumberFromString(e164);
  if (!pn || !pn.isValid()) return e164;
  if (style === 'international') return pn.formatInternational();
  return pn.formatNational();
}

// Quick heuristic for "has digits" (keeps your original idea)
export function isLikelyPhone(s) {
  return /\d/.test(s || '');
}
