const formatters = new Map();

export function normalizeForwardingTimeZone(value) {
  if (typeof value !== 'string') throw new TypeError('Time zone must be an IANA identifier');
  const zone = value.trim();
  if (!/^(?:UTC|GMT|[A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)+)$/.test(zone) || zone.length > 64) {
    throw new TypeError('Time zone must be an IANA identifier');
  }
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    throw new TypeError('Time zone must be an IANA identifier');
  }
}

// A NULL zone preserves the pre-migration server-local behavior for legacy rows.
export function inQuietHours(start, end, now = new Date(), timeZone = null) {
  if (start == null || end == null) return false;
  let hour = now.getHours();
  if (timeZone != null) {
    let formatter = formatters.get(timeZone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone, hour: 'numeric', hourCycle: 'h23',
      });
      formatters.set(timeZone, formatter);
    }
    hour = Number(formatter.formatToParts(now).find((part) => part.type === 'hour')?.value);
  }
  return (start < end && hour >= start && hour < end) ||
    (start > end && (hour >= start || hour < end));
}
