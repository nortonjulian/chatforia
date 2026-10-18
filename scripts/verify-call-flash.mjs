import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const load = async (path) => import(`data:text/javascript;base64,${Buffer.from(await read(path)).toString('base64')}`);
const { attachVisualAlerts } = await load('client/src/utils/visualAlerts.js');
const { flashIncomingCall } = await load('client/src/utils/callFlash.js');

function harness({ flash = true, visual = false, visible = true, reduced = false } = {}) {
  const nodes = new Set(), handlers = new Map(), timers = new Map(), banners = [];
  const doc = new EventTarget(), win = new EventTarget(), motion = new EventTarget();
  let sequence = 0, pulses = 0;
  doc.title = 'Chatforia'; doc.visibilityState = visible ? 'visible' : 'hidden';
  doc.hasFocus = () => doc.visibilityState === 'visible';
  doc.body = { appendChild(node) { nodes.add(node); pulses++; } };
  doc.createElement = () => ({ style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() { nodes.delete(this); } });
  motion.matches = reduced; win.matchMedia = () => motion;
  const schedule = (fn, delay, kind) => { const id = ++sequence; timers.set(id, { fn, delay, kind }); return id; };
  const cancel = (id) => timers.delete(id);
  const socket = {
    on(event, fn) { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event).add(fn); },
    off(event, fn) { handlers.get(event)?.delete(fn); },
  };
  const alerts = attachVisualAlerts({ socket, userId: 68, getEnabled: () => visual,
    getFlashEnabled: () => flash, show: (value) => banners.push(value), hide() {}, document: doc, window: win,
    setInterval: (fn, delay) => schedule(fn, delay, 'interval'), clearInterval: cancel,
    startCallFlash: () => flashIncomingCall({ document: doc, window: win,
      setTimeout: (fn, delay) => schedule(fn, delay, 'timeout'), clearTimeout: cancel }),
  });
  return { nodes, timers, banners, doc, motion, alerts, handlers, get pulses() { return pulses; },
    emit(event, value = { callId: 1007, callerId: 1, mode: 'VIDEO', offer: null }) { for (const fn of handlers.get(event) || []) fn(value); },
    setFlash(value) { flash = value; alerts.syncPreference(); },
    setVisual(value) { visual = value; alerts.syncPreference(); },
    expire() { for (const [id, timer] of [...timers]) if (timer.kind === 'timeout') { timers.delete(id); timer.fn(); } },
  };
}
test('voice invitation flashes with title/banner preference OFF', () => {
  const q = harness(); q.emit('call:incoming', { callId: 1, callerId: 1, mode: 'AUDIO' });
  assert.equal(q.nodes.size, 1); assert.equal(q.banners.length, 0); assert.equal(q.doc.title, 'Chatforia');
});
test('captured video-first event sequence produces exactly one brief pulse', () => {
  const q = harness(); q.emit('video:incoming'); q.emit('call:incoming'); q.emit('video:incoming');
  assert.equal(q.pulses, 1); assert.equal(q.nodes.size, 1);
  assert.equal([...q.timers.values()][0].delay, 220);
  q.expire(); assert.equal(q.nodes.size, 0); assert.equal(q.timers.size, 0);
  q.emit('call:incoming'); assert.equal(q.pulses, 1);
});
test('overlay is decorative, above dialogs, and cannot intercept clicks', () => {
  const q = harness(); q.emit('video:incoming'); const node = [...q.nodes][0];
  assert.equal(node.attrs['aria-hidden'], 'true');
  assert.equal(node.style.pointerEvents, 'none'); assert.equal(node.style.position, 'fixed');
  assert.equal(node.style.zIndex, '2147483647'); assert.equal(node.style.opacity, '0.85');
});
test('OFF suppresses flash while normal visual alerts remain enabled', () => {
  const q = harness({ flash: false, visual: true }); q.emit('video:incoming');
  assert.equal(q.nodes.size, 0); assert.equal(q.banners.length, 1);
});
test('reenabling never replays an OFF-period call, but a new call flashes', () => {
  const q = harness({ flash: false }); q.emit('video:incoming'); q.setFlash(true); q.emit('call:incoming');
  assert.equal(q.pulses, 0); q.emit('call:incoming', { callId: 1008, callerId: 1 }); assert.equal(q.pulses, 1);
});
test('switching flash OFF removes an active pulse immediately', () => {
  const q = harness(); q.emit('video:incoming'); q.setFlash(false);
  assert.equal(q.nodes.size, 0); assert.equal(q.timers.size, 0);
});
test('switching title/banner alerts OFF leaves independent call flash intact', () => {
  const q = harness({ visual: true }); q.emit('video:incoming'); q.setVisual(false); assert.equal(q.nodes.size, 1);
});
test('reduced motion prevents flash without suppressing call banner', () => {
  const q = harness({ reduced: true, visual: true }); q.emit('video:incoming');
  assert.equal(q.nodes.size, 0); assert.equal(q.banners.length, 1);
});
test('enabling reduced motion during the pulse removes it', () => {
  const q = harness(); q.emit('video:incoming'); q.motion.matches = true; q.motion.dispatchEvent(new Event('change'));
  assert.equal(q.nodes.size, 0); assert.equal(q.timers.size, 0);
});
test('hidden tabs never queue a flash to replay when visible', () => {
  const q = harness({ visible: false }); q.emit('video:incoming'); assert.equal(q.pulses, 0);
  q.doc.visibilityState = 'visible'; q.doc.dispatchEvent(new Event('visibilitychange')); q.emit('call:incoming');
  assert.equal(q.pulses, 0);
});
test('hiding the tab removes a pending pulse immediately', () => {
  const q = harness(); q.emit('video:incoming'); q.doc.visibilityState = 'hidden'; q.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(q.nodes.size, 0); assert.equal(q.timers.size, 0);
});
for (const event of ['call:ended', 'video:ended', 'call:answer']) {
  test(`${event} clears only the matching flash`, () => {
    const q = harness(); q.emit('video:incoming'); q.emit(event, { callId: 999 }); assert.equal(q.nodes.size, 1);
    q.emit(event, { callId: '1007' }); assert.equal(q.nodes.size, 0); assert.equal(q.timers.size, 0);
  });
}
test('own calls, malformed invitations and messages never flash', () => {
  const q = harness(); q.emit('call:incoming', { callId: 1007, callerId: 68 });
  q.emit('video:incoming', {}); q.emit('message:upsert', { item: { id: 123, senderId: 1, createdAt: new Date().toISOString() } });
  assert.equal(q.pulses, 0);
});
test('unmount/account cleanup removes overlay, timer and exact subscriptions', () => {
  const q = harness(); q.emit('video:incoming'); q.alerts.dispose(); q.alerts.dispose();
  assert.equal(q.nodes.size, 0); assert.equal(q.timers.size, 0);
  assert.ok([...q.handlers.values()].every((set) => set.size === 0));
  q.emit('video:incoming'); assert.equal(q.pulses, 1);
});
test('two different invitations never stack overlays', () => {
  const q = harness(); q.emit('video:incoming'); q.emit('call:incoming', { callId: 1008, callerId: 1 });
  assert.equal(q.nodes.size, 1); assert.equal(q.pulses, 2); assert.equal(q.timers.size, 1);
});
