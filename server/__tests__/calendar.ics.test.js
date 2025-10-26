/**
 * @jest-environment node
 */

import express from 'express';
import request from 'supertest';
import { DateTime } from 'luxon';

// We'll lazy-import the router via dynamic import in beforeAll,
// to match how you've been handling other ESM-dependent tests.
let calendarRouter;

beforeAll(async () => {
  const mod = await import('../routes/calendar.js');
  calendarRouter = mod.default;
});

// Small helper to build an app that mounts just the calendar router
function makeApp() {
  const app = express();
  app.use('/calendar', calendarRouter);
  return app;
}

describe('GET /calendar/ics', () => {
  test('400 when start or end missing', async () => {
    const res = await request(makeApp()).get('/calendar/ics?title=Demo');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty(
      'error',
      'start and end must be valid ISO datetimes'
    );
  });

  test('generates correct ICS with UTC timestamps and alarm', async () => {
    const startISO = '2025-09-30T18:00:00Z';
    const endISO = '2025-09-30T19:30:00Z';

    const res = await request(makeApp())
      .get('/calendar/ics')
      .query({
        title: 'Chatforia Event',
        start: startISO,
        end: endISO,
        location: 'Denver, CO',
        description: 'Line1\nLine2, with comma',
        url: 'https://app.chatforia.com/event/123',
        alarmMinutes: 15,
      });

    // Expect OK
    expect(res.status).toBe(200);

    // Content headers should describe an ICS download
    expect(res.headers['content-type']).toMatch(/text\/calendar/);
    expect(res.headers['content-disposition']).toMatch(/attachment/i);

    // Body is plaintext .ics
    const body = res.text;

    // Helper to format ISO stamp to iCal UTC "YYYYMMDDTHHmmssZ"
    const toICS = (iso) =>
      DateTime.fromISO(iso).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");

    // DTSTART/DTEND should match UTC times
    expect(body).toContain(`DTSTART:${toICS(startISO)}`);
    expect(body).toContain(`DTEND:${toICS(endISO)}`);

    // Description should be escaped: newlines -> \n, commas -> \,
    expect(body).toContain('DESCRIPTION:Line1\\nLine2\\, with comma');

    // Alarm block should exist with the correct trigger
    expect(body).toContain('BEGIN:VALARM');
    expect(body).toContain('TRIGGER:-PT15M');
    expect(body).toContain('END:VALARM');

    // Basic required ICS structure
    expect(body).toContain('BEGIN:VEVENT');
    expect(body).toContain('END:VEVENT');
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toContain('END:VCALENDAR');
  });
});
