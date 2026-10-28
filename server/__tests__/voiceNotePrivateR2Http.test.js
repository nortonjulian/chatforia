/** @jest-environment node */
import { jest, describe, test, expect, beforeEach, afterAll } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { Readable } from 'node:stream';

const state = {
  member: true,
  deleted: false,
  enabled: true,
  mediaUrl: 'https://cdn.chatforia.com/uploads/u7/voice.webm',
};
const r2Send = jest.fn(async ({ input }) => {
  if (input.Bucket !== 'fixture-private-bucket' || input.Key !== 'uploads/u7/voice.webm') {
    throw new Error('Unexpected private object');
  }
  return {
    ContentType: 'audio/webm;codecs=opus',
    ContentLength: 10,
    Body: Readable.from([Buffer.from('audio-data')]),
  };
});
const transcribeCreate = jest.fn(async ({ file, language, model }) => {
  let bytes = '';
  for await (const chunk of file) bytes += chunk.toString();
  if (bytes !== 'audio-data' || language !== 'en' || model !== 'gpt-4o-transcribe') {
    throw new Error('Unexpected transcription input');
  }
  return { text: 'Private voice note transcript' };
});
const db = {
  message: {
    findUnique: jest.fn(async () => ({
      id: 100,
      chatRoomId: 31,
      senderId: 7,
      createdAt: new Date('2026-10-01'),
      revision: 1,
      deletedForAll: state.deleted,
      deletedAt: null,
      isHiddenByModeration: false,
      deletions: [],
      attachments: [{
        id: 200,
        kind: 'AUDIO',
        mimeType: 'audio/webm',
        url: state.mediaUrl,
        durationSec: 4,
        deletedAt: null,
        createdAt: new Date('2026-10-01'),
      }],
    })),
  },
  participant: {
    findFirst: jest.fn(async () => state.member ? { id: 50, clearedAt: null } : null),
  },
  user: {
    findUnique: jest.fn(async () => ({
      id: 7,
      plan: 'PREMIUM',
      a11yVoiceNoteSTT: state.enabled,
      a11yStoreTranscripts: true,
      preferredLanguage: 'en-US',
    })),
  },
  transcript: {
    findFirst: jest.fn(async () => null),
    create: jest.fn(async ({ data }) => ({
      id: 401,
      segments: data.segments,
      language: data.language,
      createdAt: new Date('2026-10-26'),
    })),
  },
  sTTUsage: {
    upsert: jest.fn(async () => ({ id: 1 })),
    updateMany: jest.fn(async () => ({ count: 1 })),
  },
};

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({ __esModule: true, default: db }));
await jest.unstable_mockModule('../utils/r2.js', () => ({ __esModule: true, r2: { send: r2Send } }));
await jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: (req, res, next) => {
    const id = Number(req.get('x-test-user-id'));
    if (!Number.isSafeInteger(id) || id <= 0) return res.sendStatus(401);
    req.user = { id, role: 'USER' };
    next();
  },
}));
await jest.unstable_mockModule('../utils/planAccess.js', () => ({
  __esModule: true, hasPremiumAccess: () => true,
}));
await jest.unstable_mockModule('openai', () => ({
  __esModule: true,
  default: class FakeOpenAI {
    audio = { transcriptions: { create: transcribeCreate } };
  },
}));

const { default: transcriptsRouter } = await import('../routes/transcripts.js');
const app = express();
app.use(express.json());
app.use(transcriptsRouter);

const previousBucket = process.env.R2_BUCKET;
const previousKey = process.env.OPENAI_API_KEY;
const previousFetch = global.fetch;
beforeEach(() => {
  state.member = true;
  state.deleted = false;
  state.enabled = true;
  state.mediaUrl = 'https://cdn.chatforia.com/uploads/u7/voice.webm';
  process.env.R2_BUCKET = 'fixture-private-bucket';
  process.env.OPENAI_API_KEY = 'test-key-not-real';
  global.fetch = jest.fn(async () => { throw new Error('Public CDN fetch must never occur'); });
});
afterAll(() => {
  if (previousBucket === undefined) delete process.env.R2_BUCKET;
  else process.env.R2_BUCKET = previousBucket;
  if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousKey;
  global.fetch = previousFetch;
});
const requestTranscript = (userId = 7) => request(app)
  .post('/media/100/transcribe')
  .set('x-test-user-id', String(userId))
  .send({ language: 'en-US' });

describe('voice-note HTTP transcription from private R2 storage', () => {
  test('authorized user gets transcript via R2 read, with no CDN request', async () => {
    const response = await requestTranscript();
    expect(response.status).toBe(200);
    expect(response.body.transcript.segments).toEqual([{ text: 'Private voice note transcript' }]);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(r2Send).toHaveBeenCalledTimes(1);
    expect(transcribeCreate).toHaveBeenCalledTimes(1);
    expect(db.transcript.create).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('newly uploaded bare R2 key transcribes through private storage, never public CDN', async () => {
    state.mediaUrl = 'uploads/u7/voice.webm';
    const response = await requestTranscript();
    expect(response.status).toBe(200);
    expect(response.body.transcript.segments).toEqual([{ text: 'Private voice note transcript' }]);
    expect(r2Send).toHaveBeenCalledTimes(1);
    expect(r2Send.mock.calls[0][0].input.Key).toBe(state.mediaUrl);
    expect(transcribeCreate).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('anonymous user is rejected without R2 read or transcription', async () => {
    const response = await request(app).post('/media/100/transcribe').send({ language: 'en-US' });
    expect(response.status).toBe(401);
    expect(r2Send).not.toHaveBeenCalled();
    expect(transcribeCreate).not.toHaveBeenCalled();
  });

  test('nonparticipant receives no R2 bytes or transcription', async () => {
    state.member = false;
    const response = await requestTranscript(8);
    expect(response.status).toBe(403);
    expect(r2Send).not.toHaveBeenCalled();
    expect(transcribeCreate).not.toHaveBeenCalled();
  });

  test('deleted voice note cannot be transcribed', async () => {
    state.deleted = true;
    const response = await requestTranscript();
    expect(response.status).toBe(404);
    expect(r2Send).not.toHaveBeenCalled();
    expect(transcribeCreate).not.toHaveBeenCalled();
  });

  test('missing private bucket fails closed without a CDN request', async () => {
    delete process.env.R2_BUCKET;
    const response = await requestTranscript();
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('PRIVATE_STORAGE_UNAVAILABLE');
    expect(r2Send).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(db.transcript.create).not.toHaveBeenCalled();
  });
});
