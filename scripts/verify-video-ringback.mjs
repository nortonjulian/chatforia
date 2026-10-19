import assert from 'node:assert/strict';
import { test } from 'node:test';
import { videoRingbackUrl, startVideoRingback } from '../client/src/utils/videoRingback.js';
const flush = () => new Promise(setImmediate);
function harness({ volume = 0.35, play } = {}) {
  const sounds = [], statuses = [];
  class Audio {
    constructor(src) { this.src = src; this.paused = true; this.currentTime = 0; this.plays = 0; sounds.push(this); }
    play() { this.plays++; if (play) return play(this); this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
    removeAttribute() { this.src = ''; }
    load() { this.released = true; }
  }
  const controller = startVideoRingback({ volume, AudioImpl: Audio, onStatus: s => statuses.push(s) });
  return { controller, sounds, statuses };
}
test('generated ringback is cached PCM mono WAV with a six-second cadence', () => {
  const url = videoRingbackUrl(), bytes = Buffer.from(url.split(',')[1], 'base64');
  assert.equal(url, videoRingbackUrl()); assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE'); assert.equal(bytes.readUInt16LE(20), 1);
  assert.equal(bytes.readUInt16LE(22), 1); assert.equal(bytes.readUInt32LE(24), 8000);
  assert.equal(bytes.readUInt16LE(34), 16); assert.equal(bytes.readUInt32LE(40), 6 * 8000 * 2);
  assert.equal(bytes.readUInt32LE(4), bytes.length - 8);
});
test('two seconds of dual-frequency tone followed by exactly four seconds of silence', () => {
  const bytes = Buffer.from(videoRingbackUrl().split(',')[1], 'base64');
  let energy = 0;
  for (let i = 0; i < 48000; i++) {
    const sample = bytes.readInt16LE(44 + i * 2);
    if (i >= 16000) assert.equal(sample, 0);
    else { energy += sample * sample; assert.ok(Math.abs(sample) < 12000); }
  }
  assert.ok(energy > 1e10); assert.equal(bytes.readInt16LE(44), 0);
  for (const frequency of [440, 480]) {
    let real = 0, imaginary = 0;
    for (let i = 40; i < 15960; i++) {
      const value = bytes.readInt16LE(44 + i * 2);
      real += value * Math.cos(2 * Math.PI * frequency * i / 8000);
      imaginary += value * Math.sin(2 * Math.PI * frequency * i / 8000);
    }
    assert.ok(Math.hypot(real, imaginary) / 15920 > 2000);
  }
});
test('one local looping player respects saved volume and releases on stop', async () => {
  const f = harness(); await flush();
  assert.equal(f.sounds.length, 1); assert.equal(f.sounds[0].volume, 0.35); assert.equal(f.sounds[0].loop, true);
  assert.deepEqual(f.statuses, ['playing']); f.controller.stop();
  assert.equal(f.sounds[0].paused, true); assert.equal(f.sounds[0].src, ''); assert.equal(f.sounds[0].released, true);
});
test('muted preference never allocates an audio element', async () => {
  const f = harness({ volume: 0 }); f.controller.retry(); await flush(); assert.equal(f.sounds.length, 0);
});
test('browser autoplay rejection is recoverable on the same player', async () => {
  let blocked = true;
  const f = harness({ play: audio => blocked ? Promise.reject(Object.assign(new Error(), { name: 'NotAllowedError' })) : (audio.paused = false, Promise.resolve()) });
  await flush(); assert.deepEqual(f.statuses, ['blocked']); blocked = false; f.controller.retry(); await flush();
  assert.equal(f.sounds.length, 1); assert.deepEqual(f.statuses, ['blocked', 'playing']); f.controller.stop();
});
test('late playback after answer or cancellation is silenced and cannot restart', async () => {
  let resolve;
  const f = harness({ play: audio => new Promise(r => { resolve = () => { audio.paused = false; r(); }; }) });
  f.controller.stop(); resolve(); await flush(); f.controller.retry();
  assert.equal(f.sounds[0].paused, true); assert.equal(f.sounds[0].plays, 1); assert.deepEqual(f.statuses, []);
});
test('repeated enable gestures cannot overlap playback attempts', async () => {
  let resolve;
  const f = harness({ play: () => new Promise(r => { resolve = r; }) });
  f.controller.retry(); f.controller.retry(); assert.equal(f.sounds[0].plays, 1);
  resolve(); await flush(); f.controller.stop(); f.controller.stop();
});

import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
const source = await readFile(new URL('../client/src/utils/videoCallEndQueue.js', import.meta.url), 'utf8');
const { createVideoCallEndQueue } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const providerSource = (await readFile(new URL('../client/src/context/CallContext.jsx', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace(/export /g, '')
  .replace('return <CallCtx.Provider value={value}>{children}</CallCtx.Provider>;', 'return value;');
const tick = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const reply = (status = 200, body = { ok: true }) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
function memory() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key), data };
}
function clock() {
  let time = 0, seq = 0;
  const tasks = new Map(), events = new EventEmitter();
  const env = {
    Date: { now: () => time }, navigator: { onLine: true }, AbortController,
    setTimeout: (fn, delay = 0) => { tasks.set(++seq, { fn, at: time + delay }); return seq; },
    clearTimeout: id => tasks.delete(id),
    addEventListener: (name, fn) => events.on(name, fn),
    removeEventListener: (name, fn) => events.off(name, fn),
  };
  return { env, events, tasks, async advance(ms) {
    const end = time + ms;
    for (let count = 0; count < 1000; count++) {
      const next = [...tasks.entries()].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) { time = end; await tick(); return; }
      time = next[1].at; tasks.delete(next[0]); next[1].fn(); await tick();
    }
    throw new Error('Runaway timer');
  } };
}
function provider() {
  const tones = []; let accountId = 65; let inviteStatus = 200;
  const c = clock(), storage = memory(), socket = new EventEmitter(), sent = [], rooms = [], notices = [];
  let slots = [], index = 0, effects = [], value;
  const voice = { initialize: async () => {}, hangup() {}, callStatus: null, startBrowserCall: async () => {} };
  class Stream { constructor() { this.tracks = []; } getTracks() { return this.tracks; } addTrack(t) { this.tracks.push(t); } removeTrack(t) { this.tracks = this.tracks.filter(x => x !== t); } }
  let respondEnd = async () => reply();
  const fetch = async (url, options = {}) => {
    const body = JSON.parse(options.body || '{}'); sent.push({ url, body });
    return url.endsWith('/calls/end') ? respondEnd(body, options.signal) : url.endsWith('/calls/invite') ? reply(inviteStatus, { callId: 12, error: 'Invite rejected' }) : reply();
  };
  const hooks = {
    useState(initial) { const n = index++; if (!slots[n]) slots[n] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[n].value, next => { slots[n].value = typeof next === 'function' ? next(slots[n].value) : next; }]; },
    useRef(initial) { const n = index++; if (!slots[n]) slots[n] = { current: initial }; return slots[n]; },
    useEffect(fn, deps) { const n = index++, old = slots[n];
      if (!old || deps.some((v, i) => !Object.is(v, old.deps[i]))) {
        effects.push(() => { old?.cleanup?.(); slots[n] = { deps, cleanup: fn() }; });
      } },
  };
  const Component = vm.runInNewContext(providerSource + '\nCallProvider;', {
    getVolume: () => 0.35,
    startVideoRingback: options => {
      const tone = { options, stops: 0, retries: 0, stop() { this.stops++; }, retry() { this.retries++; } };
      tones.push(tone); return tone;
    },
    ...hooks, createContext: () => ({}), useContext: () => ({}), useSocketRaw: () => socket,
    useTwilioVoice: () => voice, API_BASE: 'https://api.test', MediaStream: Stream, fetch,
    navigator: c.env.navigator, window: { sessionStorage: storage },
    notifications: { show: x => notices.push(x), hide() {} },
    createVideoCallEndQueue: options => createVideoCallEndQueue({ ...options, env: c.env }),
    joinRoom: async () => {
      const room = new EventEmitter(); room.participants = new Map(); room.localParticipant = { tracks: new Map() };
      room.disconnect = () => room.emit('disconnected', room); rooms.push(room); return room;
    }, console,
  });
  const render = () => { index = 0; value = Component({ me: { id: accountId, plan: 'PREMIUM' } }); const jobs = effects; effects = []; jobs.forEach(fn => fn()); return value; };
  render();
  return { ...c, sent, rooms, notices, socket, storage, tones, render,
    setAccount(id) { accountId = id; render(); },
    setInviteStatus(status) { inviteStatus = status; },
    async dial(mode = 'VIDEO') { await value.startCallByUser({ calleeId: 1, mode }); render(); render(); return rooms.at(-1); }, get value() { return value; },
    setEndResponder(fn) { respondEnd = fn; },
    async answer(id = 12) {
      socket.emit('video:incoming', { callId: id, mode: 'VIDEO', fromUser: { id: 1 } }); render();
      await value.acceptCall(); render(); return rooms.at(-1);
    }, dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

const peer = () => ({ tracks: new Map(), on() {} });
test('actual provider starts one outgoing video ringback, with saved volume', async () => {
  const p = provider(); await p.dial(); p.render(); assert.equal(p.tones.length, 1);
  assert.equal(p.tones[0].options.volume, 0.35); p.dispose();
});
test('actual peer join stops immediately; media reconnect does not ring again', async () => {
  const p = provider(), room = await p.dial(); room.emit('participantConnected', peer());
  assert.ok(p.tones[0].stops); p.render(); room.emit('participantDisconnected', peer()); p.render();
  room.emit('participantConnected', peer()); p.render(); assert.equal(p.tones.length, 1); p.dispose();
});
for (const status of ['DECLINED', 'MISSED', 'ENDED']) test(`actual ${status} handler stops this call tone`, async () => {
  const p = provider(); await p.dial(); p.socket.emit('video:ended', { callId: 12, status });
  assert.ok(p.tones[0].stops); p.render(); assert.equal(p.value.active, null); p.dispose();
});
test('wrong-call event cannot stop outgoing ringback', async () => {
  const p = provider(); await p.dial(); p.socket.emit('call:ended', { callId: 13, status: 'ENDED' });
  p.render(); assert.equal(p.tones[0].stops, 0); p.dispose();
});
test('offline local cancel immediately stops tone without waiting for network', async () => {
  const p = provider(); await p.dial(); p.env.navigator.onLine = false;
  await p.value.endCall('hangup'); assert.ok(p.tones[0].stops); p.render(); assert.equal(p.value.active, null); p.dispose();
});
test('incoming video and outgoing voice do not create video ringback', async () => {
  const p = provider(); await p.answer(); assert.equal(p.tones.length, 0); p.value.cleanup(); p.render();
  await p.dial('AUDIO'); assert.equal(p.tones.length, 0); p.dispose();
});
test('rejected invitation does not start a tone', async () => {
  const p = provider(); p.setInviteStatus(429); await assert.rejects(p.dial(), /Invite rejected/);
  p.render(); assert.equal(p.tones.length, 0); p.dispose();
});
test('account switch and unmount stop their owned ringback', async () => {
  const p = provider(); await p.dial(); p.setAccount(68); assert.ok(p.tones[0].stops);
  assert.equal(p.tones.length, 1); p.dispose();
  const q = provider(); await q.dial(); q.dispose(); assert.ok(q.tones[0].stops);
});
test('blocked ringback retries same player; late status after connection is ignored', async () => {
  const p = provider(), room = await p.dial(), tone = p.tones[0];
  tone.options.onStatus('blocked'); p.render(); assert.equal(p.value.videoRingbackStatus, 'blocked');
  p.value.retryVideoRingback(); assert.equal(tone.retries, 1); assert.equal(p.tones.length, 1);
  room.emit('participantConnected', peer()); p.render(); tone.options.onStatus('error'); p.render();
  assert.equal(p.value.videoRingbackStatus, null); p.dispose();
});
