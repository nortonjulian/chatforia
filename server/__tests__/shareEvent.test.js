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
const { default: shareEventRouter } = await import('../routes/shareEvent.js');

function makeApp({ userId } = {}) {
  const app = express();

  app.use((req, _res, next) => {
    req.user = userId ? { id: userId } : null;
    next();
  });

  app.use(shareEventRouter);

  app.use((err, _req, res, _next) => {
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
      .send({ chatId: '123' });

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

    const badIcs = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:abc123
END:VEVENT
END:VCALENDAR`;

    const res = await request(app)
      .post('/share-event')
      .field('chatId', '123')
      .attach('file', Buffer.from(badIcs, 'utf8'), {
        filename: 'event.ics',
        contentType: 'text/calendar',
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid ICS' });
  });

  test('creates event/message from valid ICS upload', async () => {
    const app = makeApp({ userId: 7 });

    prisma.event.create.mockResolvedValueOnce({
      id: 111,
      title: 'Birthday Party',
    });

    prisma.message.create.mockResolvedValueOnce({
      id: 222,
      chatRoomId: 123,
      senderId: 7,
      rawContent: '📅 Event shared: Birthday Party',
      translatedContent: null,
      contentCiphertext: null,
      createdAt: undefined,
      sender: { id: 7, username: 'tester' },
    });

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
      .field('chatId', '123')
      .attach('file', Buffer.from(goodIcs, 'utf8'), {
        filename: 'party.ics',
        contentType: 'text/calendar',
      });

    expect(res.status).toBe(200);

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

    expect(prisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        chatRoomId: 123,
        senderId: 7,
        rawContent: '📅 Event shared: Birthday Party',
      }),
      include: {
        sender: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });

    expect(res.body).toMatchObject({
      ok: true,
      eventId: 111,
      message: {
        id: 222,
        chatRoomId: 123,
        senderId: 7,
        senderUsername: 'tester',
        rawContent: '📅 Event shared: Birthday Party',
        translatedContent: null,
        contentCiphertext: null,
      },
    });
  });

  test('rejects googleUrl with missing required fields', async () => {
    const app = makeApp({ userId: 5 });

    const res = await request(app)
      .post('/share-event')
      .send({
        chatId: '456',
        googleUrl:
          'https://calendar.google.com/calendar/event?eid=OMGLOL',
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error:
        'fields {title,startISO,endISO} required with googleUrl',
    });
  });

  test('accepts googleUrl + fields and creates event/message', async () => {
    const app = makeApp({ userId: 5 });

    prisma.event.create.mockResolvedValueOnce({
      id: 333,
      title: 'Sync Call',
    });

    prisma.message.create.mockResolvedValueOnce({
      id: 444,
      chatRoomId: 456,
      senderId: 5,
      rawContent: '📅 Event shared: Sync Call',
      translatedContent: null,
      contentCiphertext: null,
      createdAt: undefined,
      sender: { id: 5, username: 'googleuser' },
    });

    const res = await request(app)
      .post('/share-event')
      .send({
        chatId: '456',
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
        description: 'Weekly check-in',
        location: 'Zoom',
        externalSource: 'google',
        externalUid: 'OMGLOL',
        url: expect.stringContaining('calendar.google.com'),
        createdById: 5,
      }),
    });

    expect(prisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        chatRoomId: 456,
        senderId: 5,
        rawContent: '📅 Event shared: Sync Call',
      }),
      include: {
        sender: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });

    expect(res.body).toMatchObject({
      ok: true,
      eventId: 333,
      message: {
        id: 444,
        chatRoomId: 456,
        senderId: 5,
        senderUsername: 'googleuser',
        rawContent: '📅 Event shared: Sync Call',
        translatedContent: null,
        contentCiphertext: null,
      },
    });
  });

  test('400 if start is not before end', async () => {
    const app = makeApp({ userId: 9 });

    const res = await request(app)
      .post('/share-event')
      .send({
        chatId: '789',
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
        chatId: '123',
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error:
        'Provide an .ics file, googleUrl, or fields',
    });
  });
});