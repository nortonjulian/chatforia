import * as chrono from 'chrono-node';
import { DateTime } from 'luxon';

export function parseEventFromText(text, { defaultDurationMins = 60, zone = 'local' } = {}) {
  const results = chrono.parse(text, new Date(), { forwardDate: true });
  if (!results || results.length === 0) return null;

  // Use the first reasonable parse
  const r = results[0];
  const startDate = r.start?.date();
  if (!startDate) return null;

  const start = DateTime.fromJSDate(startDate, { zone }).toUTC();
  let end;

  if (r.end?.date()) {
    end = DateTime.fromJSDate(r.end.date(), { zone }).toUTC();
  } else {
    end = start.plus({ minutes: defaultDurationMins });
  }

  return {
    startISO: start.toISO(),
    endISO: end.toISO(),
    matchedText: r.text
  };
}
