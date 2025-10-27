// server/utils/phone.js

/**
 * Keep only numeric digits from a string.
 * - "(415) 555-2671" -> "4155552671"
 * - "+44 7700 900123" -> "447700900123"
 * - "abc123xyz" -> "123"
 * - undefined/null -> ""
 */
export function digitsOnly(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/\D+/g, '');
}

/**
 * Naive default parser we use at runtime (non-test).
 *
 * - If `raw` starts with "+": treat it as already E.164-ish.
 *   Return { isValid: true, number: "+<digits>" } if it has >=8 digits.
 *
 * - Else, use `country`:
 *   * US/CA:
 *       "4155552671" -> "+14155552671" (10 digits)
 *       "14155552671" -> "+14155552671" (11 digits starting w/1)
 *
 *   * GB:
 *       "07700900123" -> "+447700900123" (strip leading 0, prefix +44)
 *
 * Otherwise fallback:
 *   if we can get >=8 digits, prefix '+'.
 */
function _defaultParse(raw, country) {
  if (!raw || typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Case 1: already looks international
  if (trimmed.startsWith('+')) {
    const numDigits = digitsOnly(trimmed);
    if (!numDigits) return null;
    const e164 = `+${numDigits}`;
    if (numDigits.length >= 8) {
      return { isValid: true, number: e164 };
    }
    return { isValid: false, number: e164 };
  }

  // Case 2: region-based
  const justDigits = digitsOnly(trimmed);
  if (!justDigits) return null;

  if (country === 'US' || country === 'CA') {
    if (justDigits.length === 10) {
      return { isValid: true, number: `+1${justDigits}` };
    }
    if (justDigits.length === 11 && justDigits.startsWith('1')) {
      return { isValid: true, number: `+${justDigits}` };
    }
    return { isValid: false, number: `+1${justDigits}` };
  }

  if (country === 'GB') {
    let withoutZero = justDigits;
    if (withoutZero.startsWith('0')) {
      withoutZero = withoutZero.slice(1);
    }
    const e164 = `+44${withoutZero}`;
    if (withoutZero.length >= 9) {
      return { isValid: true, number: e164 };
    }
    return { isValid: false, number: e164 };
  }

  // fallback: at least 8 digits? then assume it's valid intl
  if (justDigits.length >= 8) {
    return { isValid: true, number: `+${justDigits}` };
  }

  return null;
}

/**
 * Exported parser hook.
 *
 * We keep this thin wrapper so tests COULD mock it if we ever go back to mocking.
 * In production, we just call _defaultParse.
 */
export function parsePhoneNumberFromString(raw, country) {
  return _defaultParse(raw, country);
}

/**
 * Convert arbitrary user input + optional defaultCountry into an E.164 string.
 *
 * Behavior:
 * - If input starts with "+", we parse with just the raw string (no country).
 * - Else, we parse with (raw, defaultCountry).
 * - If parser returns null or {isValid:false}, return null.
 * - Otherwise return parser.number.
 */
export function toE164(raw, defaultCountry = 'US') {
  if (!raw || typeof raw !== 'string') return null;

  const looksInternational = raw.trim().startsWith('+');

  const parsed = looksInternational
    ? parsePhoneNumberFromString(raw)
    : parsePhoneNumberFromString(raw, defaultCountry);

  if (!parsed) return null;
  if (!parsed.isValid) return null;

  return parsed.number || null;
}

/**
 * normalizeE164 is just toE164 with US default.
 */
export function normalizeE164(raw) {
  return toE164(raw, 'US');
}

/**
 * isE164 returns true if toE164(...) produced a non-null value,
 * false otherwise.
 */
export function isE164(raw, defaultCountry = 'US') {
  return Boolean(toE164(raw, defaultCountry));
}
