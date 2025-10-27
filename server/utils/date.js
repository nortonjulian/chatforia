/**
 * Safely coerce an input into a Date, but return null for clearly invalid inputs.
 * We treat `null`/`undefined` specifically as invalid (the tests expect that),
 * even though `new Date(null)` would otherwise be Jan 1, 1970.
 */
function coerceDate(input) {
  if (input === null || input === undefined) return null;
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d)) return null;
  return d;
}

/**
 * Format a date into a consistent "Mon D, YYYY" string in UTC.
 * @param {Date|string|number} date - Date object, timestamp, or ISO string.
 * @returns {string} Formatted date string or '' if invalid.
 */
export function formatDate(date) {
  const d = coerceDate(date);
  if (!d) return '';

  // Force UTC so tests are stable regardless of machine timezone.
  return d.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format a time into "HH:MM AM/PM" using en-US 12h clock.
 * @param {Date|string|number} date - Date object, timestamp, or ISO string.
 * @returns {string} Formatted time string or '' if invalid.
 */
export function formatTime(date) {
  const d = coerceDate(date);
  if (!d) return '';

  // We intentionally do NOT force UTC here because the tests
  // only assert shape (/^\d{2}:\d{2}\s?(AM|PM)$/), not exact hour.
  // But we DO want to normalize null/undefined to '' (handled above).
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Add days to a given date without mutating the original.
 * @param {Date|string|number} date - Date object, timestamp, or ISO string.
 * @param {number} days - Days to add.
 * @returns {Date|null} New Date object in local time basis, or null if invalid.
 */
export function addDays(date, days) {
  const base = coerceDate(date);
  if (!base) return null;

  const d = new Date(base); // copy so we don't mutate the original
  d.setDate(d.getDate() + days);
  return d;
}
