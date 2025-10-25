/** @jest-environment node */

import { jest } from '@jest/globals';
import request from 'supertest';

let prismaMock;
let eventLinksRouter;
let makeApp;

beforeAll(async () => {
  // 1. Mock prisma BEFORE importing the router
  jest.unstable_mockModule('../../server/utils/prismaClient.js', () => {
    const eventInvite = {
      findUnique: jest.fn(),
      update: jest.fn(),
    };

    return {
      __esModule: true,
      default: {
        eventInvite,
      },
    };
  });

  // 2. Now import prisma (mocked) and the router under test
  const prismaModule = await import('../../server/utils/prismaClient.js');
  const eventLinksModule = await import('../../server/routes/eventLinks.js');
  const expressModule = await import('express');

  prismaMock = prismaModule.default;
  eventLinksRouter = eventLinksModule.default;

  // tiny helper to build an express app using the router
  makeApp = () => {
    const app = expressModule.default();
    // no body parser needed for GET
    // but we do need JSON for RSVP POST because router.post uses express.json()
    app.use('/', eventLinksRouter);
    return app;
  };
});

beforeEach(() => {
  jest.clearAllMocks();
});

test('404 for missing token', async () => {
  // simulate no invite found
  prismaMock.eventInvite.findUnique.mockResolvedValueOnce(null);

  const res = await request(makeApp()).get('/e/NOPE');

  expect(res.status).toBe(404);
  expect(res.text).toMatch(/Link not found/i);
});

test('renders landing with three links', async () => {
  prismaMock.eventInvite.findUnique.mockResolvedValueOnce({
    id: 'inv1',
    token: 'tok',
    clickedAt: null,
    event: {
      title: 'Party',
      description: 'fun',
      location: 'Denver',
      startUTC: new Date('2025-01-01T00:00:00Z'),
      endUTC: new Date('2025-01-01T01:00:00Z'),
      url: 'https://x',
    },
  });

  // the route will call prisma.eventInvite.update to set clickedAt on first view
  prismaMock.eventInvite.update.mockResolvedValueOnce({});

  const res = await request(makeApp()).get('/e/tok');

  expect(res.status).toBe(200);
  expect(res.text).toMatch(/Add to Apple \/ iOS \/ Mac/);
  expect(res.text).toMatch(/Add to Google Calendar/);
  expect(res.text).toMatch(/Add to Outlook/);

  // also assert we recorded the click
  expect(prismaMock.eventInvite.update).toHaveBeenCalledWith({
    where: { id: 'inv1' },
    data: { clickedAt: expect.any(Date) },
  });
});

test('RSVP happy path updates invite', async () => {
  // first lookup succeeds
  prismaMock.eventInvite.findUnique.mockResolvedValueOnce({
    id: 'inv1',
    token: 'tok',
    clickedAt: new Date(),
  });

  prismaMock.eventInvite.update.mockResolvedValueOnce({});

  const res = await request(makeApp())
    .post('/e/tok/rsvp')
    .send({ rsvp: 'yes' }) // express.json() in the route will parse this
    .set('Content-Type', 'application/json');

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });

  expect(prismaMock.eventInvite.update).toHaveBeenCalledWith({
    where: { id: 'inv1' },
    data: { rsvp: 'yes' },
  });
});

test('RSVP invalid choice -> 400', async () => {
  prismaMock.eventInvite.findUnique.mockResolvedValueOnce({
    id: 'inv1',
    token: 'tok',
    clickedAt: new Date(),
  });

  const res = await request(makeApp())
    .post('/e/tok/rsvp')
    .send({ rsvp: 'lol-nope' })
    .set('Content-Type', 'application/json');

  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: 'bad rsvp' });

  // should NOT have called update in this branch
  expect(prismaMock.eventInvite.update).not.toHaveBeenCalled();
});

test('RSVP for unknown token -> 404', async () => {
  prismaMock.eventInvite.findUnique.mockResolvedValueOnce(null);

  const res = await request(makeApp())
    .post('/e/missing/rsvp')
    .send({ rsvp: 'yes' })
    .set('Content-Type', 'application/json');

  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: 'not found' });
});
