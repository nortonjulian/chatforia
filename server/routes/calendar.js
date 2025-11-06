import express from 'express';
import { DateTime } from 'luxon';
import nodemailer from 'nodemailer';

const router = express.Router();

const esc = (s = '') =>
  String(s)
    .replace(/\\/g, '\\\\')      // escape backslashes first
    .replace(/([,;])/g, '\\$1')  // commas/semicolons
    .replace(/\n/g, '\\n');      // newlines

function buildICS({
  uid,
  title,
  description = '',
  location = '',
  startISO,
  endISO,
  url,
  organizerName = 'Chatforia',
  organizerEmail = 'no-reply@chatforia.app',
  alarmMinutes = 30,
  attendees = [], // array of email strings
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
    ...attendees.map(email => `ATTENDEE;CN=${esc(email)}:MAILTO:${esc(email)}`),
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `TRIGGER:-PT${alarmMinutes}M`,
    'DESCRIPTION:Event reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
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

  if (!start || !end) return res.status(400).json({ error: 'start and end must be valid ISO datetimes' });

  const startISO = DateTime.fromISO(String(start), { zone: 'utc' }).toUTC().toISO();
  const endISO = DateTime.fromISO(String(end), { zone: 'utc' }).toUTC().toISO();
  if (!startISO || !endISO) return res.status(400).json({ error: 'Invalid dates' });

  const attendeeList = String(attendees || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const uid = `evt-${Date.now()}-${Math.random().toString(36).slice(2)}@chatforia.app`;
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
  res.setHeader('Content-Disposition', `attachment; filename="chatforia-event.ics"`);
  res.send(ics);
});

// Helper to create a mail transport
function buildTransport() {
  // Prefer SMTP creds if present
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          }
        : undefined,
    });
  }
  // Fallback: system sendmail (if available)
  return nodemailer.createTransport({
    sendmail: true,
    newline: 'unix',
    path: '/usr/sbin/sendmail',
  });
}

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

    const recipients = Array.isArray(to)
      ? to
      : String(to)
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);

    if (!recipients.length) return res.status(400).json({ error: 'No recipients' });
    if (!startISO || !endISO) return res.status(400).json({ error: 'Missing startISO/endISO' });

    const uid = `evt-${Date.now()}-${Math.random().toString(36).slice(2)}@chatforia.app`;
    const ics = buildICS({
      uid,
      title,
      description,
      location,
      startISO,
      endISO,
      url,
      alarmMinutes: Number(alarmMinutes),
      attendees: Array.isArray(attendees) ? attendees : [],
    });

    const transporter = buildTransport();
    const info = await transporter.sendMail({
      from: process.env.INVITE_FROM || 'Chatforia <no-reply@chatforia.app>',
      to: recipients,
      subject: title,
      text: `${title}\n\n${description}\n\n${location ? `Location: ${location}\n` : ''}Starts: ${startISO}\nEnds: ${endISO}\n`,
      icalEvent: {
        method: 'PUBLISH',
        content: ics,
      },
      attachments: [
        {
          filename: 'event.ics',
          content: ics,
          contentType: 'text/calendar; charset=utf-8',
        },
      ],
    });

    res.json({ ok: true, messageId: info.messageId });
  } catch (err) {
    console.error('email invite failed', err);
    res.status(500).json({ error: 'Failed to send invites' });
  }
});

export default router;
