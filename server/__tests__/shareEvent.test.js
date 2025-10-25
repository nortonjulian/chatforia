/** @jest-environment node */

import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// 1. Mock prisma BEFORE importing the router under test
jest.unstable_mockModule('../utils/prismaClient.js', () => {
  return {
    __esModule: true,
    default: {
      event: {
        create: jest.fn(),
      },
      message: {
        create: jest.fn(),
      },
    },
  };
});

// 2. Now that prisma is mocked, import prisma + the router dynamically
const { default: prisma } = await import('../utils/prismaClient.js');
const { default: shareEventRouter } = await import('../routes/shareEvent.js'); // <-- adjust path if needed

// helper Express app builder with fake auth
function makeApp({ userId } = {}) {
  const app = express();

  // inject a fake authenticated user (or no user)
  app.use((req, _res, next) => {
    req.user = userId ? { id: userId } : null;
    next();
  });

  // mount the router we’re testing
  app.use(shareEventRouter);

  // simple error handler so thrown errors come back as JSON instead of crashing Jest
  app.use((err, _req, res, _next) => {
    // eslint-disable-next-line no-console
    console.error('Router error:', err);
    res.status(500).json({ error: 'server exploded' });
  });

  return app;
}

describe('POST /share-event', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('401 if no user', async () => {
    const app = makeApp({ userId: null });

    const res = await request(app)
      .post('/share-event')
      .send({ chatId: 'abc' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
  });

  test('400 if no chatId', async () => {
    const app = makeApp({ userId: 42 });

    const res = await request(app)
      .post('/share-event')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'chatId required' });
  });

  test('400 if invalid ICS upload (missing SUMMARY/DTSTART/DTEND)', async () => {
    const app = makeApp({ userId: 42 });

    // minimal fake ICS missing required fields
    const badIcs = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:abc123
END:VEVENT
END:VCALENDAR`;

    const res = await request(app)
      .post('/share-event')
      .field('chatId', 'room1')
      .attach('file', Buffer.from(badIcs, 'utf8'), {
        filename: 'event.ics',
        contentType: 'text/calendar',
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid ICS' });
  });

  test('creates event/message from valid ICS upload', async () => {
    const app = makeApp({ userId: 7 });

    // mock DB writes
    prisma.event.create.mockResolvedValueOnce({ id: 111 });
    prisma.message.create.mockResolvedValueOnce({ id: 222 });

    // Valid ICS: SUMMARY, DTSTART/DTEND (UTC Z format)
    const goodIcs = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:abc123
SUMMARY:Birthday Party
DESCRIPTION:Snacks and games
LOCATION:My House
DTSTART:20250101T010000Z
DTEND:20250101T020000Z
END:VEVENT
END:VCALENDAR`;

    const res = await request(app)
      .post('/share-event')
      .field('chatId', 'room1')
      .attach('file', Buffer.from(goodIcs, 'utf8'), {
        filename: 'party.ics',
        contentType: 'text/calendar',
      });

    expect(res.status).toBe(200);

    // Prisma event.create got correct shape
    expect(prisma.event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'Birthday Party',
        description: 'Snacks and games',
        location: 'My House',
        externalSource: 'ics',
        externalUid: 'abc123',
        createdById: 7,
      }),
    });

    // Prisma message.create was called linking that event
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: {
        chatId: 'room1',
        senderId: 7,
        type: 'event',
        text: null,
        eventId: 111,
      },
    });

    // Response contains IDs
    expect(res.body).toEqual({
      ok: true,
      eventId: 111,
      messageId: 222,
    });
  });

  test('rejects googleUrl with missing required fields', async () => {
    const app = makeApp({ userId: 5 });

    const res = await request(app)
      .post('/share-event')
      .send({
        chatId: 'room9',
        googleUrl:
          'https://calendar.google.com/calendar/event?eid=OMGLOL',
        // missing fields.title/startISO/endISO
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error:
        'fields {title,startISO,endISO} required with googleUrl',
    });
  });

  test('accepts googleUrl + fields and creates event/message', async () => {
    const app = makeApp({ userId: 5 });

    prisma.event.create.mockResolvedValueOnce({ id: 333 });
    prisma.message.create.mockResolvedValueOnce({ id: 444 });

    const res = await request(app)
      .post('/share-event')
      .send({
        chatId: 'room9',
        googleUrl:
          'https://calendar.google.com/calendar/event?eid=OMGLOL',
        fields: {
          title: 'Sync Call',
          description: 'Weekly check-in',
          location: 'Zoom',
          startISO: '2025-02-02T10:00:00Z',
          endISO: '2025-02-02T10:30:00Z',
        },
      });

    expect(res.status).toBe(200);

    expect(prisma.event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'Sync Call',
        externalSource: 'google',
        externalUid: 'OMGLOL',
        url: expect.stringContaining('calendar.google.com'),
        createdById: 5,
      }),
    });

    expect(prisma.message.create).toHaveBeenCalledWith({
      data: {
        chatId: 'room9',
        senderId: 5,
        type: 'event',
        text: null,
        eventId: 333,
      },
    });

    expect(res.body).toEqual({
      ok: true,
      eventId: 333,
      messageId: 444,
    });
  });

  test('400 if start is not before end', async () => {
    const app = makeApp({ userId: 9 });

    const res = await request(app)
      .post('/share-event')
      .send({
        chatId: 'abc',
        fields: {
          title: 'Time Warp',
          startISO: '2025-02-02T12:00:00Z',
          endISO: '2025-02-02T11:00:00Z',
        },
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'start must be before end' });
  });

  test('400 if no file / no googleUrl / no fields', async () => {
    const app = makeApp({ userId: 1 });

    const res = await request(app)
      .post('/share-event')
      .send({
        chatId: 'noop-room',
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error:
        'Provide an .ics file, googleUrl, or fields',
    });
  });
});
