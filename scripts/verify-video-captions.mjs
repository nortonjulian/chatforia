import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createVideoCaptionProvider } from '../server/services/videoCaptionProvider.js';
import { createVideoCaptionSessions } from '../server/services/videoCaptionSessions.js';
import { hasPremiumAccess } from '../server/utils/planAccess.js';
import { createVideoCaptionReceiver, observeVideoCaptions } from '../client/src/utils/videoCaptions.js';

const OFFER = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const SESSION = 'qa-browser-session-00001';
function backend() {
  const state = { me: { id: 65, plan: 'PREMIUM', subscriptionStatus: 'ACTIVE', a11yLiveCaptions: true },
    call: { id: 20, participants: [{ status: 'JOINED', leftAt: null }] }, starts: 0, stops: [], time: Date.parse('2026-10-19'), timers: new Set() };
  const provider = { start: async sdp => { state.starts++; assert.equal(sdp, OFFER); return { id: 'rtc_test1', sdp: 'v=0\r\nanswer' }; }, stop: async id => state.stops.push(id) };
  const db = { user: { findUnique: async () => state.me }, call: { findFirst: async query => {
    assert.equal(query.where.id, 20); assert.equal(query.where.mode, 'VIDEO'); assert.equal(query.where.status, 'ACTIVE'); assert.equal(query.where.endedAt, null);
    assert.deepEqual(query.where.OR[2].participants.some, { userId: 65, status: 'JOINED', leftAt: null }); return state.call;
  } } };
  const service = createVideoCaptionSessions({ db, provider, hasPremiumAccess, now: () => state.time,
    schedule: fn => { state.timers.add(fn); return fn; }, cancel: fn => state.timers.delete(fn) });
  const req = overrides => ({ user: { id: 65 }, params: { callId: '20', sessionId: SESSION }, body: { sdp: OFFER }, ...overrides });
  const call = async (method = 'start', request = req()) => {
    let status = 200, body;
    await service[method](request, { set() {}, status(n) { status = n; return this; }, json(value) { body = value; return this; } });
    return { status, body };
  };
  return { state, provider, req, call, tick: async () => { for (const fn of [...state.timers]) await fn(); } };
}

test('eligible active video participant receives only an SDP answer; setup does not expose provider credentials', async () => {
  const f = backend(); assert.deepEqual(await f.call(), { status: 200, body: { sdp: 'v=0\r\nanswer' } }); assert.equal(f.state.starts, 1);
  assert.equal((await f.call('lease')).status, 200); await f.call('stop'); assert.deepEqual(f.state.stops, ['rtc_test1']);
});
for (const change of [{ plan: 'FREE' }, { plan: 'PLUS' }, { subscriptionStatus: 'PAST_DUE' }, { subscriptionStatus: 'CANCELED' }, { subscriptionEndsAt: '2026-10-18' }]) test(`server denies ineligible Premium access ${JSON.stringify(change)}`, async () => {
  const f = backend(); Object.assign(f.state.me, change); assert.equal((await f.call()).status, 402); assert.equal(f.state.starts, 0);
});
test('TRIALING Premium retains caption eligibility', async () => { const f = backend(); f.state.me.subscriptionStatus = 'TRIALING'; assert.equal((await f.call()).status, 200); await f.call('stop'); });
test('saved OFF preference rejects setup before contacting provider', async () => {
  const f = backend(); f.state.me.a11yLiveCaptions = false; assert.equal((await f.call()).status, 403); assert.equal(f.state.starts, 0);
});
test('nonmember, ended, nonactive or wrong-mode call rejected by scoped ACTIVE VIDEO query', async () => {
  const f = backend(); f.state.call = null; assert.equal((await f.call()).status, 403); assert.equal(f.state.starts, 0);
});
test('a participant who left cannot continue using primary caller/callee identity', async () => {
  const f = backend(); f.state.call.participants[0].leftAt = new Date(); assert.equal((await f.call()).status, 403);
});
test('missing authentication and malformed IDs do not create a session', async () => {
  const f = backend(); assert.equal((await f.call('start', f.req({ user: null }))).status, 401);
  assert.equal((await f.call('start', f.req({ params: { callId: '0', sessionId: SESSION } }))).status, 400); assert.equal(f.state.starts, 0);
});
test('malformed, oversized and video-bearing offers are rejected', async () => {
  const f = backend(); for (const sdp of ['', 'not sdp', OFFER + 'm=video 9 RTP\r\n', 'v=0\n' + 'x'.repeat(80001)]) assert.equal((await f.call('start', f.req({ body: { sdp } }))).status, 400);
});
test('duplicate setup is rejected before allocating a second provider session', async () => {
  const f = backend(); await f.call(); assert.equal((await f.call()).status, 409); assert.equal(f.state.starts, 1); await f.call('stop');
});
test('OFF during provider setup closes the new provider connection before returning SDP', async () => {
  const f = backend(); f.provider.start = async () => { f.state.me.a11yLiveCaptions = false; return { id: 'rtc_test1', sdp: 'v=0' }; };
  assert.equal((await f.call()).status, 403); assert.deepEqual(f.state.stops, ['rtc_test1']);
});
test('call ending during setup prevents the answer from being disclosed', async () => {
  const f = backend(); f.provider.start = async () => { f.state.call = null; return { id: 'rtc_test1', sdp: 'v=0' }; };
  assert.equal((await f.call()).status, 403); assert.deepEqual(f.state.stops, ['rtc_test1']);
});
test('cancelling pending setup closes a late provider connection', async () => {
  const f = backend(); let resolve;
  f.provider.start = () => new Promise(r => { resolve = r; });
  const pending = f.call(); await new Promise(setImmediate); await f.call('stop'); resolve({ id: 'rtc_test1', sdp: 'v=0' });
  assert.equal((await pending).status, 409); assert.deepEqual(f.state.stops, ['rtc_test1']);
});
for (const [name, change] of [ ['saved OFF', s => { s.me.a11yLiveCaptions = false; }], ['lost entitlement', s => { s.me.plan = 'FREE'; }], ['ended call', s => { s.call = null; }], ['expired client lease', s => { s.time += 21000; }] ]) test(`${name} stops the provider on the server watchdog`, async () => {
  const f = backend(); await f.call(); change(f.state); await f.tick(); assert.deepEqual(f.state.stops, ['rtc_test1']); assert.equal(f.state.timers.size, 0);
});
test('stale or other-session cleanup cannot close the current browser session', async () => {
  const f = backend(); await f.call(); await f.call('stop', f.req({ params: { callId: '20', sessionId: 'different-session-00001' } })); assert.equal(f.state.stops.length, 0); await f.call('stop');
});
test('lease cannot renew a session after opt-out', async () => {
  const f = backend(); await f.call(); f.state.me.a11yLiveCaptions = false; assert.equal((await f.call('lease')).status, 403); assert.equal(f.state.stops.length, 1);
});
test('failed setup releases the account slot for an explicit retry', async () => {
  const f = backend(), original = f.provider.start; f.provider.start = async () => { throw new Error('provider failed'); };
  assert.equal((await f.call()).status, 503); f.provider.start = original; assert.equal((await f.call()).status, 200); await f.call('stop');
});

test('provider creates a transcription-only session and uses the ephemeral secret for SDP exchange', async () => {
  const calls = []; const provider = createVideoCaptionProvider({ env: { OPENAI_API_KEY: 'server-key' }, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('client_secrets')) return { ok: true, json: async () => ({ value: 'temporary-secret' }) };
    if (url.endsWith('/hangup')) return { ok: true };
    return { ok: true, headers: new Map([['location', '/v1/realtime/calls/rtc_test1']]), text: async () => 'v=0\r\nanswer' };
  } });
  const result = await provider.start(OFFER); assert.equal(result.id, 'rtc_test1');
  const config = JSON.parse(calls[0].options.body); assert.equal(config.session.type, 'transcription'); assert.equal(config.session.audio.input.transcription.model, 'gpt-4o-transcribe');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer temporary-secret'); assert.equal(calls[1].options.body, OFFER);
  await provider.stop(result.id); assert.match(calls[2].url, /rtc_test1\/hangup$/);
});
test('missing provider configuration and failed provider requests fail explicitly', async () => {
  await assert.rejects(createVideoCaptionProvider({ env: {} }).start(OFFER));
  await assert.rejects(createVideoCaptionProvider({ env: { OPENAI_API_KEY: 'key' }, fetchImpl: async () => ({ ok: false }) }).start(OFFER));
});

const event = (type, item_id, fields = {}) => JSON.stringify({ type, item_id, ...fields });
test('partial deltas accumulate, final text replaces, and duplicate provider events do not duplicate words', () => {
  const text = [], receiver = createVideoCaptionReceiver(t => text.push(t));
  receiver.receive(event('input_audio_buffer.speech_started', 'one'));
  receiver.receive(event('conversation.item.input_audio_transcription.delta', 'one', { delta: 'Hello', event_id: 'a' }));
  receiver.receive(event('conversation.item.input_audio_transcription.delta', 'one', { delta: ' world', event_id: 'b' }));
  receiver.receive(event('conversation.item.input_audio_transcription.delta', 'one', { delta: ' world', event_id: 'b' }));
  receiver.receive(event('conversation.item.input_audio_transcription.completed', 'one', { transcript: 'Hello world.' }));
  assert.deepEqual(text, ['Hello', 'Hello world', 'Hello world.']);
});
test('an older utterance finishing late cannot replace the current speaker text', () => {
  const text = [], r = createVideoCaptionReceiver(t => text.push(t));
  r.receive(event('input_audio_buffer.committed', 'old')); r.receive(event('input_audio_buffer.committed', 'new'));
  r.receive(event('conversation.item.input_audio_transcription.completed', 'new', { transcript: 'New sentence' }));
  r.receive(event('conversation.item.input_audio_transcription.completed', 'old', { transcript: 'Stale sentence' }));
  assert.deepEqual(text, ['New sentence']);
});
test('malformed events, unrelated events and delivery after disposal cannot expose text', () => {
  const text = [], r = createVideoCaptionReceiver(t => text.push(t));
  for (const value of ['bad JSON', '{}', 'null', event('response.audio_transcript.delta', 'wrong', { delta: 'unrelated' }), event('conversation.item.input_audio_transcription.delta', 'one', { delta: {} })]) r.receive(value);
  r.dispose(); r.receive(event('conversation.item.input_audio_transcription.completed', 'one', { transcript: 'Late' })); assert.deepEqual(text, []);
});
test('caption text is bounded and a late partial cannot corrupt a finished utterance', () => {
  const text = [], r = createVideoCaptionReceiver(t => text.push(t));
  r.receive(event('conversation.item.input_audio_transcription.completed', 'one', { transcript: 'x'.repeat(6000) }));
  r.receive(event('conversation.item.input_audio_transcription.delta', 'one', { delta: 'late' })); assert.equal(text.length, 1); assert.equal(text[0].length, 4000);
});

function browser() {
  const intervals = new Map(), timeouts = new Map(), peers = [], copies = [], requests = [], status = [], text = [];
  let id = 0;
  function track(name, kind = 'audio') { return { id: name, kind, readyState: 'live', stopped: false,
    stop() { this.stopped = true; }, clone() { const c = track(name + '-clone', kind); copies.push(c); return c; } }; }
  const remote = track('remote-audio'), local = track('local-mic'), video = track('remote-video', 'video');
  const tracks = [remote], contexts = [], outputs = [];
  class Stream {
    constructor(tracks) { this.tracks = tracks; }
    getTracks() { return this.tracks; }
    getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
  }
  class AudioGraph {
    constructor() { contexts.push(this); this.state = 'running'; this.sources = []; }
    createMediaStreamDestination() {
      const output = track('local-caption-output-' + outputs.length);
      outputs.push(output);
      return this.destination = { stream: new Stream([output]) };
    }
    createMediaStreamSource(stream) {
      const source = { stream, connect(destination) { this.destination = destination; },
        disconnect() { this.disconnected = true; } };
      this.sources.push(source);
      return source;
    }
    async resume() {} async close() { this.closed = true; }
  }
  const api = { post: async (url, body, options) => { requests.push({ url, body, options }); return { data: { sdp: 'v=0\r\nanswer' } }; }, delete: async url => { requests.push({ delete: url }); } };
  class Peer {
    constructor() { peers.push(this); this.connectionState = 'new'; this.sent = []; }
    addTransceiver(track, options) { this.sent.push({ track, options }); }
    createDataChannel() { return this.channel = { readyState: 'connecting', close() { this.closed = true; } }; }
    async createOffer() { return { type: 'offer', sdp: OFFER }; }
    async setLocalDescription() {} async setRemoteDescription() {}
    close() { this.closed = true; }
  }
  const env = { AudioContext: AudioGraph, MediaStream: Stream, crypto: { randomUUID: () => SESSION }, RTCPeerConnection: Peer,
    setInterval: (fn, ms) => { intervals.set(++id, { fn, ms }); return id; }, clearInterval: i => intervals.delete(i),
    setTimeout: (fn, ms) => { timeouts.set(++id, { fn, ms }); return id; }, clearTimeout: i => timeouts.delete(i),
  };
  const stop = observeVideoCaptions({ api, callId: 20, remoteStream: { current: { getAudioTracks: () => tracks, getVideoTracks: () => [video] } }, env, onText: t => text.push(t), onStatus: s => status.push(s) });
  return { env, api, requests, peers, copies, remote, local, video, tracks, status, text, stop,
    tick: async ms => { for (const timer of [...intervals.values()]) if (timer.ms === ms) await timer.fn(); await new Promise(setImmediate); },
    intervals, timeouts, contexts, outputs };
}
test('single received caller is re-sourced through local Web Audio before sending; call media stays untouched', async () => {
  const f = browser(); await f.tick(500); assert.equal(f.peers.length, 1); assert.equal(f.peers[0].sent.length, 1);
  assert.notEqual(f.peers[0].sent[0].track, f.copies[0]);
  assert.equal(f.peers[0].sent[0].track, f.outputs[0]);
  assert.equal(f.contexts[0].sources[0].stream.getTracks()[0], f.copies[0]);
  assert.equal(f.contexts[0].sources[0].destination, f.contexts[0].destination);
  assert.equal(f.contexts[0].sources.length, 1); assert.equal(f.peers[0].sent[0].options.direction, 'sendonly'); assert.equal(f.requests[0].body.sdp, OFFER);
  f.stop(); assert.equal(f.remote.stopped, false); assert.equal(f.local.stopped, false); assert.equal(f.video.stopped, false); assert.equal(f.copies[0].stopped, true);
  assert.equal(f.outputs[0].stopped, true); assert.equal(f.contexts[0].closed, true);
  assert.equal(f.contexts[0].sources[0].disconnected, true);
  assert.equal(f.peers[0].closed, true); assert.ok(f.requests.some(r => r.delete)); assert.equal(f.intervals.size, 0);
});
test('actual data-channel transcript reaches the renderer, but late delivery after cleanup cannot', async () => {
  const f = browser(); await f.tick(500); const channel = f.peers[0].channel;
  channel.onmessage({ data: event('conversation.item.input_audio_transcription.completed', 'one', { transcript: 'Remote caller words' }) });
  assert.ok(f.text.includes('Remote caller words')); f.stop();
  channel.onmessage({ data: event('conversation.item.input_audio_transcription.completed', 'two', { transcript: 'Late' }) }); assert.ok(!f.text.includes('Late'));
});
test('remote track replacement releases only the caption connection and starts with the replacement audio', async () => {
  const f = browser(); await f.tick(500); const replacement = { ...f.remote, id: 'replacement' }; f.tracks.splice(0, 1, replacement); await f.tick(500);
  assert.equal(f.peers.length, 2); assert.equal(f.peers[0].closed, true); assert.equal(f.remote.stopped, false); f.stop();
});
test('no remote audio means no provider request, and a disposed development probe cannot start capture', async () => {
  const f = browser(); f.tracks.length = 0; await f.tick(500); assert.equal(f.requests.length, 0); f.stop(); await f.tick(500); assert.equal(f.requests.length, 0);
});
test('failed lease clears text and stops caption capture while leaving the call running', async () => {
  const f = browser(); await f.tick(500); f.api.post = async () => { throw new Error('revoked'); }; await f.tick(5000);
  assert.equal(f.status.at(-1), 'error'); assert.equal(f.text.at(-1), ''); assert.equal(f.remote.stopped, false); assert.equal(f.copies[0].stopped, true); f.stop();
});
test('provider errors are visible and do not terminate the real call', async () => {
  const f = browser(); await f.tick(500); f.peers[0].channel.onmessage({ data: JSON.stringify({ type: 'error' }) });
  assert.equal(f.status.at(-1), 'error'); assert.equal(f.remote.stopped, false); f.stop();
});
test('CallScreen selects video captions only for video; voice captions and media wiring are preserved', async () => {
  const source = await readFile(new URL('../client/src/components/call/CallScreen.jsx', import.meta.url), 'utf8');
  assert.match(source, /isVideo \? \(\s*<VideoCallCaptions callId=\{active.callId\} remoteStream=\{remoteStream\}/);
  assert.match(source, /<CallCaptions callId=\{active.callId\}/); assert.match(source, /srcObject = remote/);
});

test('multi-participant capture mixes only remote audio and releases its own context and copies', async () => {
  const f = browser(); const second = { ...f.remote, id: 'second-remote' }; f.tracks.push(second);
  const mixed = { id: 'mixed-output', kind: 'audio', stopped: false, stop() { this.stopped = true; } };
  let context;
  f.env.MediaStream = class { constructor(tracks) { this.tracks = tracks; } getTracks() { return this.tracks; } getAudioTracks() { return this.tracks; } };
  f.env.AudioContext = class {
    constructor() { context = this; this.state = 'running'; this.sources = []; }
    createMediaStreamDestination() { return { stream: new f.env.MediaStream([mixed]) }; }
    createMediaStreamSource(stream) { this.sources.push(stream); return { connect() {}, disconnect() {} }; }
    async resume() {} async close() { this.closed = true; }
  };
  await f.tick(500); assert.equal(f.copies.length, 2); assert.equal(context.sources.length, 2);
  assert.equal(f.peers[0].sent[0].track, mixed); f.stop();
  assert.equal(context.closed, true); assert.ok(f.copies.every(t => t.stopped)); assert.equal(mixed.stopped, true); assert.equal(f.remote.stopped, false); assert.equal(second.stopped, false);
});
test('closing during SDP negotiation rejects a late answer and removes the pending provider session', async () => {
  const f = browser(); let resolve;
  f.api.post = (url, body, options) => { f.requests.push({ url, body, options }); return new Promise(r => { resolve = r; }); };
  await f.tick(500); const signal = f.requests[0].options.signal; f.stop(); assert.equal(signal.aborted, true);
  resolve({ data: { sdp: 'v=0\r\nlate answer' } }); await new Promise(setImmediate);
  assert.equal(f.peers[0].closed, true); assert.equal(f.remote.stopped, false); assert.equal(f.status.includes('ready'), false); assert.ok(f.requests.some(r => r.delete));
});

test('long calls renew their caption connection without stopping the call', async () => {
  const f = backend(); await f.call(); let result;
  for (let i = 0; i < 159; i++) { f.state.time += 19000; result = await f.call('lease'); }
  assert.equal(result.status, 200); assert.equal(result.body.reconnect, true); await f.call('stop');
  const b = browser(); await b.tick(500); const originalPost = b.api.post;
  b.api.post = async (url, ...args) => url.endsWith('/lease') ? { data: { reconnect: true } } : originalPost(url, ...args);
  await b.tick(5000); await b.tick(500); assert.equal(b.peers.length, 2); assert.equal(b.peers[0].closed, true); assert.equal(b.remote.stopped, false); b.stop();
});

for (const mode of ['unavailable', 'suspended', 'resume failure', 'missing output']) test(`caption audio ${mode} fails explicitly without affecting the call or allocating a provider`, async () => {
  const f = browser();
  if (mode === 'unavailable') delete f.env.AudioContext;
  else {
    const Original = f.env.AudioContext;
    f.env.AudioContext = class extends Original {
      constructor() { super(); if (mode === 'suspended') this.state = 'suspended'; }
      async resume() { if (mode === 'resume failure') throw new Error('not allowed'); }
      createMediaStreamDestination() {
        const destination = super.createMediaStreamDestination();
        if (mode === 'missing output') destination.stream.tracks = [];
        return destination;
      }
    };
  }
  await f.tick(500);
  assert.equal(f.status.at(-1), 'error'); assert.equal(f.requests.length, 0);
  assert.ok(f.copies.every(t => t.stopped)); assert.equal(f.remote.stopped, false);
  assert.equal(f.local.stopped, false); assert.equal(f.video.stopped, false);
  if (f.contexts.length) assert.equal(f.contexts[0].closed, true);
  f.stop();
});
test('disposing during caption audio resume releases the late graph without starting a connection', async () => {
  const f = browser(), Original = f.env.AudioContext; let resume;
  f.env.AudioContext = class extends Original { resume() { return new Promise(resolve => { resume = resolve; }); } };
  await f.tick(500); f.stop(); resume(); await new Promise(setImmediate);
  assert.equal(f.peers.length, 0); assert.equal(f.requests.length, 0);
  assert.equal(f.contexts[0].closed, true); assert.ok(f.copies.every(t => t.stopped));
  assert.equal(f.outputs[0].stopped, true); assert.equal(f.remote.stopped, false);
});
test('caption audio graph never connects to a speaker destination', async () => {
  const f = browser(); await f.tick(500);
  assert.ok(f.contexts[0].sources.every(source => source.destination === f.contexts[0].destination));
  f.stop();
});
