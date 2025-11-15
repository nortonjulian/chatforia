import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// --- Prisma mocks ------------------------------------------------------------

const mockParticipantFindFirst = jest.fn();
const mockMessageFindUnique = jest.fn();
const mockTranscriptUpsert = jest.fn();
const mockTranscriptFindUnique = jest.fn();

jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  default: {
    participant: {
      findFirst: mockParticipantFindFirst,
    },
    message: {
      findUnique: mockMessageFindUnique,
    },
    transcript: {
      upsert: mockTranscriptUpsert,
      findUnique: mockTranscriptFindUnique,
    },
  },
}));

// --- Auth mock ---------------------------------------------------------------

jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, res, next) => {
    // Tests can override user, but default to a basic logged-in user
    if (!req.user) req.user = { id: 123, plan: 'PREMIUM' };
    next();
  },
}));

// Import router under test AFTER mocks
const { default: transcriptsRouter } = await import('../routes/transcripts.js');

// --- Helper: build app -------------------------------------------------------

function createApp({ user } = {}) {
  const app = express();
  app.use(express.json());

  // Inject a custom user if provided
  app.use((req, res, next) => {
    if (user) req.user = user;
    next();
  });

  app.use('/', transcriptsRouter);

  // Basic Boom-aware error handler (for safety, though POST catches most)
  app.use((err, req, res, next) => {
    if (err && err.isBoom && err.output) {
      return res
        .status(err.output.statusCode)
        .json(err.output.payload);
    }
    return res
      .status(500)
      .json({
        statusCode: 500,
        error: 'Internal Server Error',
        message: err?.message || 'Internal error',
      });
  });

  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParticipantFindFirst.mockReset();
  mockMessageFindUnique.mockReset();
  mockTranscriptUpsert.mockReset();
  mockTranscriptFindUnique.mockReset();
});

// --- Tests -------------------------------------------------------------------

describe('POST /media/:messageId/transcribe', () => {
  it('no-ops (ok:true) when message has no audio', async () => {
    mockMessageFindUnique.mockResolvedValueOnce({
      id: 42,
      audioUrl: null,
      chatRoomId: 10,
    });

    const app = createApp({ user: { id: 123, plan: 'PREMIUM' } });

    const res = await request(app)
      .post('/media/42/transcribe')
      .send();

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });

    // Membership and transcript should not be checked
    expect(mockParticipantFindFirst).not.toHaveBeenCalled();
    expect(mockTranscriptUpsert).not.toHaveBeenCalled();
  });

  it('returns 402 when user is not premium and STT_FREE is false', async () => {
    mockMessageFindUnique.mockResolvedValueOnce({
      id: 99,
      audioUrl: 'media/audio-99',
      chatRoomId: 5,
    });

    mockParticipantFindFirst.mockResolvedValueOnce({ id: 1 });

    const app = createApp({ user: { id: 123, plan: 'free' } });

    const res = await request(app)
      .post('/media/99/transcribe')
      .send();

    expect(res.statusCode).toBe(402);
    expect(res.body).toEqual({ ok: false, reason: 'PREMIUM_REQUIRED' });

    // Should not try to upsert transcript when gating fails
    expect(mockTranscriptUpsert).not.toHaveBeenCalled();
  });

  it('creates a stub transcript in DB for premium user', async () => {
    mockMessageFindUnique.mockResolvedValueOnce({
      id: 100,
      audioUrl: 'media/audio-100',
      chatRoomId: 7,
    });

    mockParticipantFindFirst.mockResolvedValueOnce({ id: 1 });

    mockTranscriptUpsert.mockResolvedValueOnce({});

    const app = createApp({ user: { id: 123, plan: 'PREMIUM' } });

    const res = await request(app)
      .post('/media/100/transcribe')
      .send();

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(mockMessageFindUnique).toHaveBeenCalledWith({
      where: { id: 100 },
      select: { id: true, audioUrl: true, chatRoomId: true },
    });
    expect(mockParticipantFindFirst).toHaveBeenCalledWith({
      where: { chatRoomId: 7, userId: 123 },
      select: { id: true },
    });

    expect(mockTranscriptUpsert).toHaveBeenCalledTimes(1);
    const args = mockTranscriptUpsert.mock.calls[0][0];

    expect(args.where).toEqual({ messageId: 100 });
    expect(args.create.messageId).toBe(100);
    expect(args.create.transcript.segments[0].text).toBe('(transcript coming soon)');
    expect(args.update.transcript.segments[0].text).toBe('(transcript coming soon)');
  });

  it('returns 403 when user is not a participant', async () => {
    mockMessageFindUnique.mockResolvedValueOnce({
      id: 101,
      audioUrl: 'media/audio-101',
      chatRoomId: 20,
    });

    // Membership check fails
    mockParticipantFindFirst.mockResolvedValueOnce(null);

    const app = createApp({ user: { id: 123, plan: 'PREMIUM' } });

    const res = await request(app)
      .post('/media/101/transcribe')
      .send();

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Transcription failed' });

    expect(mockTranscriptUpsert).not.toHaveBeenCalled();
  });

  it('falls back to in-memory store when transcript upsert throws, and GET returns stub', async () => {
    const messageId = 202;

    // POST: message exists with audio, user is participant
    mockMessageFindUnique.mockResolvedValueOnce({
      id: messageId,
      audioUrl: 'media/audio-202',
      chatRoomId: 50,
    });

    mockParticipantFindFirst.mockResolvedValueOnce({ id: 1 });

    // Upsert throws (e.g. table not created yet)
    mockTranscriptUpsert.mockRejectedValueOnce(new Error('no such table'));

    const app = createApp({ user: { id: 123, plan: 'PREMIUM' } });

    const postRes = await request(app)
      .post(`/media/${messageId}/transcribe`)
      .send();

    expect(postRes.statusCode).toBe(200);
    expect(postRes.body).toEqual({ ok: true });

    // Now GET should read from in-memory fallback
    // Make DB lookup either throw or return null
    mockTranscriptFindUnique.mockResolvedValueOnce(null);

    const getRes = await request(app)
      .get(`/transcripts/${messageId}`)
      .send();

    expect(getRes.statusCode).toBe(200);
    expect(getRes.body).toHaveProperty('transcript');
    expect(getRes.body.transcript).toHaveProperty('segments');
    expect(getRes.body.transcript.segments[0].text).toBe('(transcript coming soon)');
  });
});

describe('GET /transcripts/:messageId', () => {
  it('returns 400 with transcript:null for invalid id', async () => {
    const app = createApp({ user: { id: 123, plan: 'PREMIUM' } });

    const res = await request(app)
      .get('/transcripts/not-a-number')
      .send();

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ transcript: null });
  });

  it('returns transcript from DB when available', async () => {
    const messageId = 300;
    const dbTranscript = {
      segments: [{ text: 'hello from db' }],
    };

    mockTranscriptFindUnique.mockResolvedValueOnce({
      transcript: dbTranscript,
    });

    const app = createApp({ user: { id: 123, plan: 'PREMIUM' } });

    const res = await request(app)
      .get(`/transcripts/${messageId}`)
      .send();

    expect(res.statusCode).toBe(200);
    expect(mockTranscriptFindUnique).toHaveBeenCalledWith({
      where: { messageId },
      select: { transcript: true },
    });
    expect(res.body).toEqual({ transcript: dbTranscript });
  });

  it('returns empty transcript when neither DB nor memory have data', async () => {
    const messageId = 400;

    // DB lookup fails (e.g. table not present)
    mockTranscriptFindUnique.mockRejectedValueOnce(new Error('no such table'));

    const app = createApp({ user: { id: 123, plan: 'PREMIUM' } });

    const res = await request(app)
      .get(`/transcripts/${messageId}`)
      .send();

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ transcript: { segments: [] } });
  });
});
