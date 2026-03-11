import express from 'express';
import { DateTime } from 'luxon';
import { sendMail } from '../utils/sendMail.js';

const router = express.Router();

const esc = (s = '') =>
  String(s)
    .replace(/\\/g, '\\\\')
    .replace(/([,;])/g, '\\$1')
    .replace(/\n/g, '\\n');

function buildICS({
  uid,
  title,
  description = '',
  location = '',
  startISO,
  endISO,
  url,
  organizerName = 'Chatforia',
  organizerEmail = 'no-reply@chatforia.com',
  alarmMinutes = 30,
  attendees = [],
}) {
  const dtstamp = DateTime.utc().toFormat("yyyyMMdd'T'HHmmss'Z'");
  const dtstart = DateTime.fromISO(startISO).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
  const dtend = DateTime.fromISO(endISO).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");

  return [
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
    `SUMMARY:${esc(title)}`,
    description ? `DESCRIPTION:${esc(description)}` : '',
    location ? `LOCATION:${esc(location)}` : '',
    url ? `URL:${esc(url)}` : '',
    `ORGANIZER;CN=${esc(organizerName)}:MAILTO:${organizerEmail}`,
    ...attendees.map((email) => `ATTENDEE;CN=${esc(email)}:MAILTO:${esc(email)}`),
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `TRIGGER:-PT${alarmMinutes}M`,
    'DESCRIPTION:Event reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
}

function toIsoUtcOrNull(value) {
  const dt = DateTime.fromISO(String(value), { setZone: true });
  return dt.isValid ? dt.toUTC().toISO() : null;
}

function normalizeRecipients(value) {
  if (Array.isArray(value)) {
    return value.map((s) => String(s).trim()).filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// GET /calendar/ics?title=&description=&location=&start=&end=&url=&alarmMinutes=&attendees=email1,email2
router.get('/ics', async (req, res) => {
  const {
    title = 'Chatforia event',
    description = '',
    location = '',
    start,
    end,
    url = '',
    alarmMinutes = 30,
    attendees = '',
  } = req.query;

  if (!start || !end) {
    return res.status(400).json({ error: 'start and end must be valid ISO datetimes' });
  }

  const startISO = toIsoUtcOrNull(start);
  const endISO = toIsoUtcOrNull(end);

  if (!startISO || !endISO) {
    return res.status(400).json({ error: 'Invalid dates' });
  }

  const attendeeList = normalizeRecipients(attendees);

  const uid = `evt-${Date.now()}-${Math.random().toString(36).slice(2)}@chatforia.com`;
  const ics = buildICS({
    uid,
    title,
    description,
    location,
    startISO,
    endISO,
    url,
    alarmMinutes: Number(alarmMinutes),
    attendees: attendeeList,
  });

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="chatforia-event.ics"');
  res.send(ics);
});

// POST /calendar/email-invite
// body: { to: string[] | stringCSV, title, description, location, startISO, endISO, url?, alarmMinutes?, attendees?: string[] }
router.post('/email-invite', async (req, res) => {
  try {
    const {
      to = [],
      title = 'Chatforia event',
      description = '',
      location = '',
      startISO,
      endISO,
      url = '',
      alarmMinutes = 30,
      attendees = [],
    } = req.body || {};

    const recipients = normalizeRecipients(to);
    if (!recipients.length) {
      return res.status(400).json({ error: 'No recipients' });
    }

    const normalizedStartISO = toIsoUtcOrNull(startISO);
    const normalizedEndISO = toIsoUtcOrNull(endISO);

    if (!normalizedStartISO || !normalizedEndISO) {
      return res.status(400).json({ error: 'Missing or invalid startISO/endISO' });
    }

    const uid = `evt-${Date.now()}-${Math.random().toString(36).slice(2)}@chatforia.com`;
    const ics = buildICS({
      uid,
      title,
      description,
      location,
      startISO: normalizedStartISO,
      endISO: normalizedEndISO,
      url,
      alarmMinutes: Number(alarmMinutes),
      attendees: Array.isArray(attendees) ? attendees : normalizeRecipients(attendees),
    });

    const html = `
      <p>You’ve been invited to an event on Chatforia.</p>
      <p><strong>${title}</strong></p>
      ${description ? `<p>${description}</p>` : ''}
      ${location ? `<p><strong>Location:</strong> ${location}</p>` : ''}
      <p><strong>Starts:</strong> ${normalizedStartISO}</p>
      <p><strong>Ends:</strong> ${normalizedEndISO}</p>
      ${url ? `<p><a href="${url}">Open event link</a></p>` : ''}
      <p>An .ics calendar file is attached.</p>
    `;

    const text =
      `${title}\n\n` +
      `${description ? `${description}\n\n` : ''}` +
      `${location ? `Location: ${location}\n` : ''}` +
      `Starts: ${normalizedStartISO}\n` +
      `Ends: ${normalizedEndISO}\n` +
      `${url ? `Link: ${url}\n` : ''}`;

    const attachmentBase64 = Buffer.from(ics, 'utf8').toString('base64');

    const result = await sendMail({
      to: recipients,
      from: process.env.INVITE_FROM || process.env.EMAIL_FROM || 'Chatforia <no-reply@chatforia.com>',
      subject: title,
      html,
      text,
      attachments: [
        {
          filename: 'event.ics',
          content: attachmentBase64,
          type: 'text/calendar; charset=utf-8; method=PUBLISH',
        },
      ],
    });

    if (!result?.success) {
      console.error('email invite failed', result?.error);
      return res.status(500).json({ error: 'Failed to send invites' });
    }

    res.json({
      ok: true,
      id: result?.data?.id || null,
    });
  } catch (err) {
    console.error('email invite failed', err);
    res.status(500).json({ error: 'Failed to send invites' });
  }
});

export default router;