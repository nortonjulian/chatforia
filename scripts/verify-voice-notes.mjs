import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createVoiceNoteHandlers } from '../server/services/voiceNoteTranscription.js';
import { hasPremiumAccess } from '../server/utils/planAccess.js';
import { voiceNotePreview } from '../client/src/utils/voiceNotePreview.js';

const fixed = new Date('2026-10-18T00:00:00Z');
function fixture() {
  const state = {
    user: { id: 65, plan: 'PREMIUM', subscriptionStatus: 'ACTIVE', a11yVoiceNoteSTT: true, a11yStoreTranscripts: true, preferredLanguage: 'en-US' },
    message: { id: 10, senderId: 1, chatRoomId: 83, revision: 1, createdAt: new Date('2026-10-17T23:00:00Z'), deletions: [], attachments: [{ id: 2, kind: 'AUDIO', url: 'https://media.example/audio.m4a', durationSec: 9 }] },
    member: { id: 7 }, rows: [], usage: 0, providerCalls: 0, saved: 0,
  };
  const db = {
    message: { findUnique: async () => structuredClone(state.message) },
    user: { findUnique: async () => structuredClone(state.user) },
    participant: { findFirst: async ({ where }) => { assert.deepEqual(where, { chatRoomId: 83, userId: 65 }); return state.member; } },
    transcript: {
      findFirst: async ({ where }) => state.rows.find(row => row.userId === where.userId && row.messageId === where.messageId && row.language === where.language && new Date(row.createdAt) >= where.createdAt.gte) || null,
      create: async ({ data }) => { state.saved++; const row = { id: 't1', ...data, createdAt: fixed }; state.rows.push(row); return row; },
    },
    sTTUsage: {
      upsert: async () => ({}),
      updateMany: async ({ where, data }) => {
        if (where.seconds?.lte !== undefined && state.usage > where.seconds.lte) return { count: 0 };
        if (where.seconds?.gte !== undefined && state.usage < where.seconds.gte) return { count: 0 };
        state.usage += (data.seconds.increment || 0) - (data.seconds.decrement || 0);
        return { count: 1 };
      },
    },
  };
  state.provider = async () => ({ text: 'The actual spoken words.' });
  const handlers = createVoiceNoteHandlers({ db, transcribe: async (...args) => { state.providerCalls++; return state.provider(...args); }, hasPremiumAccess,
    config: { FREE_STT_MIN_PER_MONTH: 20, FREE_STT_LANGS: ['en-US'] }, now: () => fixed });
  const request = (overrides = {}) => ({ params: { messageId: '10' }, user: { id: 65 }, body: {}, ...overrides });
  async function call(method = 'post', req = request()) {
    let status = 200, body;
    const res = { status(n) { status = n; return this; }, json(value) { body = value; return this; }, set() {} };
    await handlers[method](req, res);
    return { status, body };
  }
  return { state, call, request };
}

test('iOS attachment-based voice note returns real provider text and stores only for the requesting account', async () => {
  const f = fixture(); const r = await f.call();
  assert.equal(r.status, 200); assert.equal(r.body.transcript.segments[0].text, 'The actual spoken words.');
  assert.equal(f.state.rows[0].userId, 65); assert.equal(f.state.usage, 9);
  assert.equal(f.state.message.rawContent, undefined);
});
test('legacy audioUrl remains supported', async () => {
  const f = fixture(); f.state.message.attachments = []; f.state.message.audioUrl = 'https://media.example/old.mp3';
  assert.equal((await f.call()).status, 200);
});
test('duplicate concurrent requests share one provider call and one charge', async () => {
  const f = fixture(); const rs = await Promise.all([f.call(), f.call()]);
  assert.ok(rs.every(r => r.status === 200)); assert.equal(f.state.providerCalls, 1); assert.equal(f.state.usage, 9); assert.equal(f.state.saved, 1);
});
test('fresh requests and GET reuse the account-scoped transcript without another charge', async () => {
  const f = fixture(); await f.call(); await f.call(); assert.equal((await f.call('get')).body.transcript.segments[0].text, 'The actual spoken words.'); assert.equal(f.state.providerCalls, 1);
});
test('old mock results are regenerated', async () => {
  const f = fixture(); f.state.rows.push({ userId: 65, messageId: 10, language: 'en-US', createdAt: fixed, segments: [{ text: 'This is a mock transcription.' }] });
  assert.equal((await f.call()).body.transcript.segments[0].text, 'The actual spoken words.'); assert.equal(f.state.providerCalls, 1);
});
test('transcripts belonging to another account are never reused', async () => {
  const f = fixture(); f.state.rows.push({ userId: 68, messageId: 10, language: 'en-US', createdAt: fixed, segments: [{ text: 'private' }] });
  assert.equal((await f.call('get')).body.transcript, null);
});
for (const [name, change, code] of [
  ['nonmember', s => { s.member = null; }, 403],
  ['deleted for everyone', s => { s.message.deletedForAll = true; }, 404],
  ['deleted for this viewer', s => { s.message.deletions = [{ userId: 65 }]; }, 404],
  ['expired', s => { s.message.expiresAt = new Date('2026-10-17'); }, 404],
  ['moderated', s => { s.message.isHiddenByModeration = true; }, 404],
  ['cleared history', s => { s.member.clearedAt = fixed; }, 404],
  ['preference off', s => { s.user.a11yVoiceNoteSTT = false; }, 403],
  ['missing audio', s => { s.message.attachments = []; }, 404],
]) test(`${name} cannot generate or retrieve a transcript`, async () => {
  const f = fixture(); change(f.state);
  assert.equal((await f.call()).status, code); assert.equal((await f.call('get')).status, code); assert.equal(f.state.providerCalls, 0);
});
for (const id of ['0', '-1', '1.2', 'abc', '9007199254740992']) test(`invalid ID ${id} is rejected`, async () => {
  const f = fixture(); assert.equal((await f.call('post', f.request({ params: { messageId: id } }))).status, 400);
});
test('store-off returns an ephemeral transcript and never saves or retrieves existing text', async () => {
  const f = fixture(); f.state.user.a11yStoreTranscripts = false;
  assert.equal((await f.call()).body.transcript.ephemeral, true); assert.equal(f.state.saved, 0); assert.equal((await f.call('get')).body.transcript, null);
});
test('opt-out during provider work prevents disclosure and restores usage', async () => {
  const f = fixture(); f.state.provider = async () => { f.state.user.a11yVoiceNoteSTT = false; return { text: 'secret' }; };
  assert.equal((await f.call()).status, 403); assert.equal(f.state.saved, 0); assert.equal(f.state.usage, 0);
});
test('deletion during provider work prevents disclosure', async () => {
  const f = fixture(); f.state.provider = async () => { f.state.message.deletedForAll = true; return { text: 'secret' }; };
  assert.equal((await f.call()).status, 404); assert.equal(f.state.saved, 0);
});
test('audio revision changing during provider work cannot attach stale text', async () => {
  const f = fixture(); f.state.provider = async () => { f.state.message.revision++; return { text: 'old' }; };
  assert.equal((await f.call()).status, 409); assert.equal(f.state.saved, 0);
});
test('provider failure restores allowance and permits an explicit retry', async () => {
  const f = fixture(); f.state.provider = async () => { throw new Error('provider'); };
  assert.equal((await f.call()).status, 503); assert.equal(f.state.usage, 0);
  f.state.provider = async () => ({ text: 'retry worked' });
  assert.equal((await f.call()).body.transcript.segments[0].text, 'retry worked');
});
test('silence returns an empty finished transcript', async () => {
  const f = fixture(); f.state.provider = async () => ({ text: '' }); assert.deepEqual((await f.call()).body.transcript.segments, []);
});
test('Free English allowance works; insufficient allowance blocks the provider', async () => {
  const f = fixture(); f.state.user.plan = 'FREE'; assert.equal((await f.call()).status, 200);
  const g = fixture(); g.state.user.plan = 'FREE'; g.state.usage = 1199; assert.equal((await g.call()).status, 402); assert.equal(g.state.providerCalls, 0);
});
for (const user of [{ plan: 'FREE' }, { plan: 'PLUS' }, { plan: 'PREMIUM', subscriptionStatus: 'CANCELED' }, { plan: 'PREMIUM', subscriptionEndsAt: '2026-10-17' }]) test(`noneligible language gated: ${JSON.stringify(user)}`, async () => {
  const f = fixture(); Object.assign(f.state.user, user, { preferredLanguage: 'es' }); assert.equal((await f.call()).status, 402); assert.equal(f.state.providerCalls, 0);
});
test('Premium language is sent to the provider rather than translated', async () => {
  const f = fixture(); f.state.user.preferredLanguage = 'es'; f.state.provider = async (url, lang) => { assert.equal(lang, 'es'); return { text: 'Hola' }; }; assert.equal((await f.call()).status, 200);
});
test('sidebar normalizes voice-note markers without changing real text', () => {
  const t = (_, fallback) => fallback;
  assert.equal(voiceNotePreview('[voice note]', t), 'Voice note'); assert.equal(voiceNotePreview(' [AUDIO] ', t), 'Voice note');
  assert.equal(voiceNotePreview('A real caption', t), 'A real caption'); assert.equal(voiceNotePreview('[other]', t), '[other]');
});

const providerSource = fs.readFileSync(new URL('../server/services/stt/voiceNote.js', import.meta.url), 'utf8');
function providerFixture() {
  const calls = [];
  const env = { OPENAI_API_KEY: 'unit-test', R2_PUBLIC_BASE: 'https://media.example' };
  class OpenAI { constructor(options) { assert.equal(options.maxRetries, 0); } audio = { transcriptions: { create: async value => { calls.push(value); value.file.destroy(); return { text: 'spoken audio' }; } } }; }
  let fetched;
  const fetch = async (url, options) => { fetched = { url, options }; return { ok: true, headers: new Map([['content-type', 'audio/mp4']]), body: (async function* () { yield Buffer.from('audio'); })() }; };
  const source = providerSource.replace(/^import .*;\n/gm, '').replace(/export /g, '') + '\n;({ voiceNoteMediaURL, transcribeVoiceNote });';
  const exports = vm.runInNewContext(source, { OpenAI, fs, ...fsp, os, path, process: { env }, URL, AbortSignal, Buffer, fetch });
  return { ...exports, calls, env, fetched: () => fetched };
}
test('provider reads real media bytes, calls OpenAI transcription, and removes temporary audio', async () => {
  const p = providerFixture(); assert.equal((await p.transcribeVoiceNote('https://media.example/note.m4a', 'en-US')).text, 'spoken audio');
  assert.equal(p.calls[0].model, 'gpt-4o-transcribe'); assert.equal(p.calls[0].language, 'en'); assert.equal(p.fetched().options.redirect, 'error');
  assert.equal(fs.existsSync(path.dirname(p.calls[0].file.path)), false);
});
test('provider fails explicitly without a key; arbitrary media origins and credentials are rejected', async () => {
  const p = providerFixture(); delete p.env.OPENAI_API_KEY;
  await assert.rejects(p.transcribeVoiceNote('https://media.example/note.m4a', 'en'), /not configured/);
  for (const url of ['http://media.example/a', 'https://127.0.0.1/a', 'https://evil.example/a', 'https://user:pass@media.example/a']) assert.throws(() => p.voiceNoteMediaURL(url, p.env));
});
test('active UI mounts one transcript per media message; uses the authenticated API and keeps the player intact', () => {
  const bubble = fs.readFileSync(new URL('../client/src/components/chat/MessageBubble.jsx', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('../client/src/components/chat/VoiceNoteTranscript.jsx', import.meta.url), 'utf8');
  const a11y = fs.readFileSync(new URL('../server/routes/a11y.js', import.meta.url), 'utf8');
  assert.equal((bubble.match(/<VoiceNoteTranscript /g) || []).length, 1); assert.match(bubble, /<audio/);
  assert.match(ui, /axiosClient.post/); assert.match(ui, /result\?\.scope !== scope/); assert.match(ui, /controller.abort/); assert.doesNotMatch(ui, /fetch\(/);
  assert.match(a11y, /router.use\(transcriptsRouter\)/); assert.doesNotMatch(a11y, /stt.transcribeFromUrl/);
});
