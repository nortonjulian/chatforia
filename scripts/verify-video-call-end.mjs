import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
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
function setup(extra = {}) {
  const c = clock(), storage = extra.storage ?? memory(), sent = [], pending = [], settled = [], failed = [];
  const q = createVideoCallEndQueue({ accountId: 65, env: c.env, storage,
    send: async (body, signal) => { sent.push({ body, signal }); return reply(); },
    onPending: id => pending.push(id), onSettled: id => settled.push(id), onFailure: id => failed.push(id), ...extra });
  return { ...c, storage, sent, pending, settled, failed, q };
}

test('video hangup is saved before network work and removed only after acknowledgement', async () => {
  let resolve;
  const h = setup({ send: () => new Promise(done => { resolve = done; }) });
  h.q.enqueue(1056, 'ended');
  assert.deepEqual(JSON.parse(h.storage.getItem('chatforia:pendingVideoEnds:65')), [{ callId: 1056, reason: 'ended' }]);
  resolve(reply()); await tick();
  assert.equal(h.storage.getItem('chatforia:pendingVideoEnds:65'), null);
  assert.deepEqual(h.settled, [1056]); h.q.dispose();
});
test('offline hangup sends nothing; online retries exact call without reopening media', async () => {
  const h = setup(); h.env.navigator.onLine = false; h.q.enqueue(1056, 'ended');
  assert.equal(h.sent.length, 0); assert.deepEqual(h.pending, [1056]);
  h.env.navigator.onLine = true; h.events.emit('online'); await tick();
  assert.equal(h.sent[0].body.callId, 1056); assert.equal(h.settled.length, 1); h.q.dispose();
});
test('failed fetch retains intent and succeeds with bounded backoff', async () => {
  let calls = 0;
  const h = setup({ send: async () => { if (++calls === 1) throw new TypeError('offline'); return reply(); } });
  h.q.enqueue(12); await tick(); await h.advance(999); assert.equal(calls, 1);
  await h.advance(1); assert.equal(calls, 2); assert.deepEqual(h.settled, [12]); h.q.dispose();
});
test('HTTP 503 and unacknowledged 200 cannot silently discard hangup', async () => {
  const results = [reply(503), reply(200, {}), reply()];
  const h = setup({ send: async () => results.shift() }); h.q.enqueue(12); await tick();
  assert.ok(h.storage.getItem('chatforia:pendingVideoEnds:65'));
  await h.advance(1000); assert.ok(h.storage.getItem('chatforia:pendingVideoEnds:65'));
  await h.advance(2000); assert.deepEqual(h.settled, [12]); h.q.dispose();
});
test('online and focus events coalesce an in-flight call and preserve its first reason', async () => {
  let resolve, calls = 0;
  const h = setup({ send: () => { calls++; return new Promise(done => { resolve = done; }); } });
  h.q.enqueue(12, 'ended'); h.q.enqueue(12, 'media_disconnected'); h.events.emit('online'); h.events.emit('focus');
  assert.equal(calls, 1); resolve(reply()); await tick(); assert.deepEqual(h.settled, [12]); h.q.dispose();
});
test('hung request times out, aborts, and retries rather than blocking forever', async () => {
  let calls = 0, signal;
  const h = setup({ send: (_body, s) => { signal = s; return ++calls === 1 ? new Promise(() => {}) : Promise.resolve(reply()); } });
  h.q.enqueue(12); await h.advance(8000); assert.equal(signal.aborted, true);
  await h.advance(1000); assert.equal(calls, 2); assert.deepEqual(h.settled, [12]); h.q.dispose();
});
test('same-account page reload restores pending end and another account does not send it', async () => {
  const storage = memory(), h = setup({ storage }); h.env.navigator.onLine = false; h.q.enqueue(12); h.q.dispose();
  const other = setup({ storage, accountId: 1 }); await other.advance(0); assert.equal(other.sent.length, 0); other.q.dispose();
  const restored = setup({ storage }); await restored.advance(0); assert.equal(restored.sent[0].body.callId, 12); restored.q.dispose();
});
test('account switch and disposal abort old requests and reject late completion', async () => {
  let current = true, resolve, signal;
  const h = setup({ isCurrentAccount: () => current, send: (_body, s) => { signal = s; return new Promise(done => { resolve = done; }); } });
  h.q.enqueue(12); current = false; h.q.dispose(); resolve(reply()); await tick();
  assert.equal(signal.aborted, true); assert.equal(h.settled.length, 0);
  assert.ok(h.storage.getItem('chatforia:pendingVideoEnds:65')); assert.equal(h.events.listenerCount('online'), 0);
});
test('a late acknowledgement for an old call preserves a newer pending call', async () => {
  const done = new Map(); const h = setup({ send: body => new Promise(resolve => done.set(body.callId, resolve)) });
  h.q.enqueue(12); h.q.enqueue(13); done.get(12)(reply()); await tick();
  assert.deepEqual(JSON.parse(h.storage.getItem('chatforia:pendingVideoEnds:65')).map(x => x.callId), [13]); h.q.dispose();
});
test('another installation authority rejection is surfaced and never retried', async () => {
  const h = setup({ send: async () => reply(200, { ok: true, ignored: true, code: 'CALL_NOT_AUTHORITATIVE_DEVICE' }) });
  h.q.enqueue(12); await tick(); await h.advance(60000);
  assert.deepEqual(h.failed, [12]); assert.equal(h.settled.length, 0); h.q.dispose();
});
test('permission/not-found rejections are surfaced; expired authentication retains intent', async () => {
  for (const status of [400, 403, 404, 410]) {
    const h = setup({ send: async () => reply(status) }); h.q.enqueue(12); await tick(); assert.deepEqual(h.failed, [12]); h.q.dispose();
  }
  const h = setup({ send: async () => reply(401) }); h.q.enqueue(12); await tick();
  assert.ok(h.storage.getItem('chatforia:pendingVideoEnds:65')); h.q.dispose();
});
test('invalid IDs, corrupt storage, and denied storage cannot corrupt another call', async () => {
  const h = setup(); for (const id of [0, -1, 1.2, 'x', Number.MAX_SAFE_INTEGER + 1]) h.q.enqueue(id);
  assert.equal(h.sent.length, 0); h.q.dispose();
  const denied = setup({ storage: { getItem() { throw Error(); }, setItem() { throw Error(); }, removeItem() { throw Error(); } } });
  denied.q.enqueue(12); await tick(); assert.deepEqual(denied.settled, [12]); denied.q.dispose();
});

// Execute the uploaded production CallProvider body with deterministic hook and
// SDK boundaries. Its actual event handlers and actions run unmodified.
function provider() {
  const c = clock(), storage = memory(), socket = new EventEmitter(), sent = [], rooms = [], notices = [];
  let slots = [], index = 0, effects = [], value;
  const voice = { initialize: async () => {}, hangup() {}, callStatus: null };
  class Stream { constructor() { this.tracks = []; } getTracks() { return this.tracks; } addTrack(t) { this.tracks.push(t); } removeTrack(t) { this.tracks = this.tracks.filter(x => x !== t); } }
  let respondEnd = async () => reply();
  const fetch = async (url, options = {}) => {
    const body = JSON.parse(options.body || '{}'); sent.push({ url, body });
    return url.endsWith('/calls/end') ? respondEnd(body, options.signal) : reply();
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
  const render = () => { index = 0; value = Component({ me: { id: 65, plan: 'PREMIUM' } }); const jobs = effects; effects = []; jobs.forEach(fn => fn()); return value; };
  render();
  return { ...c, sent, rooms, notices, socket, storage, render, get value() { return value; },
    setEndResponder(fn) { respondEnd = fn; },
    async answer(id = 12) {
      socket.emit('video:incoming', { callId: id, mode: 'VIDEO', fromUser: { id: 1 } }); render();
      await value.acceptCall(); render(); return rooms.at(-1);
    }, dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
test('actual provider clears video locally while offline and notifies backend after online', async () => {
  const p = provider(); await p.answer(); p.env.navigator.onLine = false;
  await p.value.endCall('ended'); p.render(); assert.equal(p.value.active, null);
  assert.equal(p.sent.filter(x => x.url.endsWith('/calls/end')).length, 0);
  p.env.navigator.onLine = true; p.events.emit('online'); await tick();
  assert.equal(p.sent.filter(x => x.url.endsWith('/calls/end'))[0].body.callId, 12); p.dispose();
});
test('terminal video room loss sends call-scoped hangup; temporary reconnect does not', async () => {
  const p = provider(), room = await p.answer(); room.emit('reconnecting', { code: 53001 }); p.render();
  assert.equal(p.value.active.callId, 12); assert.equal(p.sent.filter(x => x.url.endsWith('/calls/end')).length, 0);
  room.emit('disconnected', room, { code: 53002 }); p.render(); await tick();
  assert.equal(p.value.active, null); assert.equal(p.sent.filter(x => x.url.endsWith('/calls/end'))[0].body.reason, 'media_disconnected'); p.dispose();
});
test('manual video cleanup sends only one request, with the original end reason', async () => {
  const p = provider(); await p.answer(); await p.value.endCall('ended'); p.render(); await tick();
  const ends = p.sent.filter(x => x.url.endsWith('/calls/end')); assert.equal(ends.length, 1); assert.equal(ends[0].body.reason, 'ended'); p.dispose();
});
test('backend acknowledgement for an old call cannot clear newer active video', async () => {
  const p = provider(); let done; p.setEndResponder(() => new Promise(resolve => { done = resolve; }));
  const old = await p.answer(12); await p.value.endCall('ended'); p.render(); await p.answer(13);
  old.emit('disconnected', old, { code: 53002 }); done(reply()); await tick(); p.render();
  assert.equal(p.value.active.callId, 13); p.dispose();
});
test('remote-ended cleanup does not echo another hangup to the backend', async () => {
  const p = provider(); await p.answer(); p.socket.emit('video:ended', { callId: 12, status: 'ENDED' }); p.render();
  assert.equal(p.value.active, null); assert.equal(p.sent.filter(x => x.url.endsWith('/calls/end')).length, 0); p.dispose();
});
test('duplicate-identity room loss does not end the replacement client call', async () => {
  const p = provider(), room = await p.answer(); room.emit('disconnected', room, { code: 53205 }); p.render();
  assert.equal(p.value.active, null); assert.equal(p.sent.filter(x => x.url.endsWith('/calls/end')).length, 0); p.dispose();
});
test('terminal room loss while offline retains the end until connectivity returns', async () => {
  const p = provider(), room = await p.answer(); p.env.navigator.onLine = false;
  room.emit('disconnected', room, { code: 53002 }); p.render();
  assert.equal(p.value.active, null); assert.ok(p.storage.getItem('chatforia:pendingVideoEnds:65'));
  p.env.navigator.onLine = true; p.events.emit('online'); await tick();
  assert.equal(p.sent.filter(x => x.url.endsWith('/calls/end')).length, 1); p.dispose();
});
test('ordinary audio hangup preserves its existing request and local cleanup path', async () => {
  const p = provider(); p.socket.emit('call:incoming', { callId: 20, mode: 'AUDIO', fromUser: { id: 1 } }); p.render();
  await p.value.endCall('ended'); p.render();
  assert.equal(p.value.incoming, null); assert.equal(p.sent.filter(x => x.url.endsWith('/calls/end')).length, 1);
  assert.equal(p.storage.getItem('chatforia:pendingVideoEnds:65'), null); p.dispose();
});
test('successful video decline does not enqueue a new recovery request', async () => {
  const p = provider(); p.socket.emit('video:incoming', { callId: 20, mode: 'VIDEO', fromUser: { id: 1 } }); p.render();
  await p.value.rejectCall(); p.render();
  assert.equal(p.value.incoming, null); assert.equal(p.sent.filter(x => x.url.endsWith('/calls/end')).length, 1);
  assert.equal(p.storage.getItem('chatforia:pendingVideoEnds:65'), null); p.dispose();
});
test('repeated failures back off to thirty seconds and one pending notice', async () => {
  let attempts = 0; const h = setup({ send: async () => { attempts++; throw Error('network'); } });
  h.q.enqueue(12); await tick(); await h.advance(100000);
  assert.equal(attempts, 8); assert.deepEqual(h.pending, [12]); h.q.dispose();
});
