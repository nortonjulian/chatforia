import { formatDate, formatTime, addDays } from '../../utils/date.js';

function normalizeTimeString(s) {
  // Some JS engines insert narrow no-break spaces or regular NBSPs before AM/PM.
  // We'll collapse all whitespace runs to a single regular space for stable asserts.
  return s.replace(/\s+/g, ' ').trim();
}

describe('formatDate', () => {
  test('formats Date objects as "Mon DD, YYYY" with en-US locale', () => {
    // Oct 26, 2025 in America/Denver is still Oct 26, 2025 UTC-6/-7;
    // formatting here uses local env's TZ but only cares about day/month/year.
    const d = new Date('2025-10-26T15:45:00Z');
    const out = formatDate(d);
    // We expect "Oct 26, 2025"
    expect(out).toBe('Oct 26, 2025');
  });

  test('accepts ISO string and timestamp number', () => {
    const isoOut = formatDate('1999-12-31T23:59:59Z');
    expect(isoOut).toBe('Dec 31, 1999');

    const ts = new Date('2000-01-01T00:00:00Z').getTime();
    const tsOut = formatDate(ts);
    expect(tsOut).toBe('Jan 1, 2000');
  });

  test('returns empty string for invalid date input', () => {
    expect(formatDate('not-a-real-date')).toBe('');
    expect(formatDate(undefined)).toBe('');
    expect(formatDate(NaN)).toBe('');
  });
});

describe('formatTime', () => {
  test('formats to "HH:MM AM/PM" 2-digit hour/minute in en-US', () => {
    const d = new Date('2025-10-26T19:07:00Z');
    const out = formatTime(d);

    // Collapse weird unicode whitespace so test is stable
    const norm = normalizeTimeString(out);

    // We can't assert exact hour/min w.r.t. local timezone offset across environments
    // BUT we *can* assert the general shape "NN:NN AM/PM".
    // We'll just regex it.
    expect(norm).toMatch(/^\d{2}:\d{2}\s?(AM|PM)$/);
  });

  test('accepts ISO string and timestamp number', () => {
    const iso = formatTime('2025-10-26T05:30:00Z');
    const ts = formatTime(new Date('2025-10-26T05:30:00Z').getTime());

    // both should look like "HH:MM AM|PM" (normalized)
    expect(normalizeTimeString(iso)).toMatch(/^\d{2}:\d{2}\s?(AM|PM)$/);
    expect(normalizeTimeString(ts)).toMatch(/^\d{2}:\d{2}\s?(AM|PM)$/);
  });

  test('returns empty string for invalid input', () => {
    expect(formatTime('nope')).toBe('');
    expect(formatTime(null)).toBe('');
  });
});

describe('addDays', () => {
  test('returns a new Date advanced by N days without mutating original', () => {
    const original = new Date('2025-10-26T12:00:00Z');
    const added = addDays(original, 3);

    expect(added instanceof Date).toBe(true);

    // 26 + 3 = 29
    expect(added.getUTCDate()).toBe(29);

    // original should not be mutated
    expect(original.getUTCDate()).toBe(26);
  });

  test('handles ISO strings and timestamps', () => {
    const fromIso = addDays('2024-12-31T23:00:00Z', 1);
    // Adding 1 day to Dec 31 should roll year to Jan 1
    expect(fromIso.getUTCFullYear()).toBe(2025);
    expect(fromIso.getUTCMonth()).toBe(0); // Jan = 0
    expect(fromIso.getUTCDate()).toBe(1);

    const ts = new Date('2024-01-15T00:00:00Z').getTime();
    const fromTs = addDays(ts, 10);
    expect(fromTs.getUTCFullYear()).toBe(2024);
    expect(fromTs.getUTCMonth()).toBe(0); // Jan
    expect(fromTs.getUTCDate()).toBe(25); // 15 + 10
  });

  test('returns null for invalid input', () => {
    expect(addDays('definitely not a date', 2)).toBeNull();
    expect(addDays(undefined, 2)).toBeNull();
    expect(addDays(NaN, 2)).toBeNull();
  });
});
