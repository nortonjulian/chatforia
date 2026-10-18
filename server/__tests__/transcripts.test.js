/** @jest-environment node */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const db = {
  message: { findUnique: jest.fn() }, participant: { findFirst: jest.fn() }, user: { findUnique: jest.fn() },
  transcript: { findFirst: jest.fn(), create: jest.fn() }, sTTUsage: { upsert: jest.fn(), updateMany: jest.fn() },
};
const transcribe = jest.fn();
await jest.unstable_mockModule('../utils/prismaClient.js', () => ({ default: db }));
await jest.unstable_mockModule('../services/stt/voiceNote.js', () => ({ transcribeVoiceNote: transcribe }));
await jest.unstable_mockModule('../middleware/auth.js', () => ({ requireAuth: (req, res, next) => {
  if (!req.headers['x-user']) return res.sendStatus(401);
  req.user = { id: 65 }; next();
} }));
const { default: router } = await import('../routes/transcripts.js');
const app = express(); app.use(express.json()); app.use(router);
const user = { id: 65, plan: 'PREMIUM', subscriptionStatus: 'ACTIVE', a11yVoiceNoteSTT: true, a11yStoreTranscripts: true, preferredLanguage: 'en-US' };
const message = { id: 10, senderId: 1, chatRoomId: 83, revision: 1, createdAt: new Date(), attachments: [{ kind: 'AUDIO', url: 'https://media.example/a.m4a', durationSec: 9 }], deletions: [] };
beforeEach(() => {
  jest.resetAllMocks();
  db.message.findUnique.mockResolvedValue(message); db.participant.findFirst.mockResolvedValue({ id: 1 }); db.user.findUnique.mockResolvedValue(user);
  db.transcript.findFirst.mockResolvedValue(null); db.transcript.create.mockImplementation(async ({ data }) => ({ id: 't1', ...data }));
  db.sTTUsage.upsert.mockResolvedValue({}); db.sTTUsage.updateMany.mockResolvedValue({ count: 1 });
  transcribe.mockResolvedValue({ text: 'Actual recorded words' });
});
test('both endpoints require authentication', async () => {
  expect((await request(app).post('/media/10/transcribe')).status).toBe(401);
  expect((await request(app).get('/transcripts/10')).status).toBe(401);
});
test('real transcript is returned immediately using current schema and attachment-based audio', async () => {
  const res = await request(app).post('/media/10/transcribe').set('x-user', '65');
  expect(res.status).toBe(200); expect(res.body.transcript.segments).toEqual([{ text: 'Actual recorded words' }]);
  expect(db.participant.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { chatRoomId: 83, userId: 65 } }));
  expect(db.transcript.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 65, messageId: 10 }) }));
  expect(res.headers['cache-control']).toBe('private, no-store');
});
for (const method of ['get', 'post']) test(`${method} rejects a nonmember before accessing transcript data`, async () => {
  db.participant.findFirst.mockResolvedValue(null);
  const url = method === 'get' ? '/transcripts/10' : '/media/10/transcribe';
  expect((await request(app)[method](url).set('x-user', '65')).status).toBe(403);
  expect(db.transcript.findFirst).not.toHaveBeenCalled(); expect(transcribe).not.toHaveBeenCalled();
});
test('GET scopes cached text to the current user and does not run a provider', async () => {
  db.transcript.findFirst.mockResolvedValue({ segments: [{ text: 'Saved words' }] });
  const res = await request(app).get('/transcripts/10').set('x-user', '65');
  expect(res.body.transcript.segments[0].text).toBe('Saved words');
  expect(db.transcript.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 65, messageId: 10 }) }));
  expect(transcribe).not.toHaveBeenCalled();
});
test('expired audio is unavailable on GET and POST', async () => {
  db.message.findUnique.mockResolvedValue({ ...message, expiresAt: new Date(0) });
  expect((await request(app).get('/transcripts/10').set('x-user', '65')).status).toBe(404);
  expect((await request(app).post('/media/10/transcribe').set('x-user', '65')).status).toBe(404);
});
test('saved OFF preference prevents generation', async () => {
  db.user.findUnique.mockResolvedValue({ ...user, a11yVoiceNoteSTT: false });
  expect((await request(app).post('/media/10/transcribe').set('x-user', '65')).status).toBe(403);
  expect(transcribe).not.toHaveBeenCalled();
});
test('provider failure returns an explicit error and refunds the reservation', async () => {
  transcribe.mockRejectedValue(new Error('provider failed'));
  const res = await request(app).post('/media/10/transcribe').set('x-user', '65');
  expect(res.status).toBe(503); expect(res.body.code).toBe('TRANSCRIPTION_UNAVAILABLE');
  expect(db.sTTUsage.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { seconds: { decrement: 9 } } }));
});
test('no-store preference returns text without writing a transcript', async () => {
  db.user.findUnique.mockResolvedValue({ ...user, a11yStoreTranscripts: false });
  const res = await request(app).post('/media/10/transcribe').set('x-user', '65');
  expect(res.status).toBe(200); expect(res.body.transcript.ephemeral).toBe(true); expect(db.transcript.create).not.toHaveBeenCalled();
});
test('invalid IDs are rejected rather than passed into Prisma', async () => {
  expect((await request(app).post('/media/0/transcribe').set('x-user', '65')).status).toBe(400);
  expect(db.message.findUnique).not.toHaveBeenCalled();
});
