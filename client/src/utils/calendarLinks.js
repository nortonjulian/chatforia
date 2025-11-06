import { DateTime } from 'luxon';

// RFC5545 safe escaping
function icsEscape(s = '') {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

// Google expects UTC in the form YYYYMMDDTHHmmssZ and requires an end time.
export function googleCalendarUrl({ title, start, end, location, description }) {
  const s = DateTime.fromISO(start, { zone: 'utc' }).toFormat("yyyyLLdd'T'HHmmss'Z'");
  const e = DateTime.fromISO(end,   { zone: 'utc' }).toFormat("yyyyLLdd'T'HHmmss'Z'");
  const base = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
  const p = new URLSearchParams({
    text: title || '',
    dates: `${s}/${e}`,
    location: location || '',
    details: description || ''
  });
  return `${base}&${p.toString()}`;
}

// Outlook Web deep link (works for M365/Outlook.com; Outlook desktop will prefer ICS)
export function outlookCalendarUrl({ title, start, end, location, description }) {
  // Outlook wants local ISO strings; safest is to pass UTC with 'Z'
  const s = DateTime.fromISO(start).toISO(); // keep whatever you pass (often UTC)
  const e = DateTime.fromISO(end).toISO();
  const base = 'https://outlook.live.com/calendar/0/deeplink/compose';
  const p = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: title || '',
    body: description || '',
    location: location || '',
    startdt: s,
    enddt: e
  });
  return `${base}?${p.toString()}`;
}

// Create a minimal ICS string. Consumers download as .ics and open in Apple/Outlook/etc.
export function buildICS({ title, start, end, location, description, attendees = [] }) {
  const dtstamp = DateTime.utc().toFormat("yyyyLLdd'T'HHmmss'Z'");
  const dtstart = DateTime.fromISO(start, { zone: 'utc' }).toFormat("yyyyLLdd'T'HHmmss'Z'");
  const dtend   = DateTime.fromISO(end,   { zone: 'utc' }).toFormat("yyyyLLdd'T'HHmmss'Z'");
  const uid = `${dtstamp}-${Math.random().toString(36).slice(2)}@chatforia`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Chatforia//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${icsEscape(title || '')}`,
    description ? `DESCRIPTION:${icsEscape(description)}` : null,
    location ? `LOCATION:${icsEscape(location)}` : null,
    ...attendees.map(email => `ATTENDEE;CN=${icsEscape(email)}:mailto:${icsEscape(email)}`),
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean);

  return lines.join('\r\n');
}
