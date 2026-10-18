import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');
const code = await source('client/src/utils/visualAlerts.js');
const { attachVisualAlerts } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

function harness({ enabled = true, foreground = false } = {}) {
  const clock = Date.parse('2026-10-18T02:00:00Z');
  const doc = new EventTarget();
  doc.title = 'Group chat — Chatforia';
  doc.visibilityState = foreground ? 'visible' : 'hidden';
  doc.hasFocus = () => foreground;
  const win = new EventTarget();
  const events = new Map();
  const timers = new Map();
  const banners = [], hidden = [];
  let sequence = 0;
  const socket = {
    on(event, handler) { if (!events.has(event)) events.set(event, new Set()); events.get(event).add(handler); },
    off(event, handler) { events.get(event)?.delete(handler); },
  };
  const alerts = attachVisualAlerts({ socket, userId: 68, getEnabled: () => enabled,
    document: doc, window: win, now: () => clock,
    show: (banner) => banners.push(banner), hide: (id) => hidden.push(id),
    setInterval: (callback) => { const id = ++sequence; timers.set(id, callback); return id; },
    clearInterval: (id) => timers.delete(id),
  });
  return { clock, doc, win, timers, events, banners, hidden, alerts,
    emit(event, payload) { for (const handler of events.get(event) || []) handler(payload); },
    message(id, extra = {}) { return { item: { id, chatRoomId: 83, sender: { id: 1 }, createdAt: new Date(clock + 1).toISOString(), ...extra } }; },
    tick() { for (const callback of [...timers.values()]) callback(); },
    focus() { foreground = true; doc.visibilityState = 'visible'; win.dispatchEvent(new Event('focus')); },
    setEnabled(value) { enabled = value; alerts.syncPreference(); },
  };
}

test('canonical incoming message shows a banner and immediately changes background title', () => {
  const qa = harness();
  qa.emit('message:upsert', qa.message(42));
  assert.equal(qa.banners.length, 1);
  assert.match(qa.doc.title, /New message/);
  qa.tick(); assert.equal(qa.doc.title, 'Group chat — Chatforia');
  qa.tick(); assert.match(qa.doc.title, /New message/);
});
test('legacy aliases and duplicate upserts share a single alert', () => {
  const qa = harness();
  for (const event of ['message:upsert', 'message:new', 'receive:message', 'message:upsert']) qa.emit(event, qa.message(42));
  assert.equal(qa.banners.length, 1);
  assert.equal(qa.timers.size, 1);
});
test('a different message alerts independently without stacking title timers', () => {
  const qa = harness();
  qa.emit('message:upsert', qa.message(42)); qa.emit('message:upsert', qa.message(43));
  assert.equal(qa.banners.length, 2); assert.equal(qa.timers.size, 1);
});
test('own messages never alert', () => {
  const qa = harness();
  qa.emit('message:upsert', qa.message(42, { sender: { id: 68 } }));
  assert.equal(qa.banners.length, 0);
});
test('edits, deletions, expired rows and explicit receipt events never alert', () => {
  const qa = harness();
  const variants = [{ editedAt: '2026-10-18' }, { deletedAt: '2026-10-18' }, { deletedForAll: true },
    { expiresAt: new Date(qa.clock - 1).toISOString() }, { readBy: [{ id: 68 }] }];
  variants.forEach((extra, index) => qa.emit('message:upsert', qa.message(42 + index, extra)));
  for (const event of ['message:edited', 'message:deleted', 'message_read', 'message:read']) qa.emit(event, qa.message(99));
  assert.equal(qa.banners.length, 0);
});
test('historical reconnect hydration is not presented as a new message', () => {
  const qa = harness();
  qa.emit('message:upsert', qa.message(42, { createdAt: new Date(qa.clock - 60_000).toISOString() }));
  assert.equal(qa.banners.length, 0);
});
test('malformed messages are ignored without a crash', () => {
  const qa = harness();
  for (const payload of [null, {}, { item: {} }, qa.message(-1), qa.message(1, { createdAt: 'bad' }), qa.message(2, { sender: null })]) qa.emit('message:upsert', payload);
  assert.equal(qa.banners.length, 0);
});
test('supported wrapper formats and string sender IDs work', () => {
  const qa = harness();
  const row = qa.message(42, { sender: undefined, senderId: '1' }).item;
  qa.emit('message:new', { message: row });
  qa.emit('receive:message', { shaped: { ...row, id: 43 } });
  qa.emit('message:upsert', { ...row, id: 44 });
  assert.equal(qa.banners.length, 3);
});
test('OFF suppresses banners and title changes', () => {
  const qa = harness({ enabled: false }); qa.emit('message:upsert', qa.message(42));
  assert.equal(qa.banners.length, 0); assert.equal(qa.timers.size, 0);
  assert.equal(qa.doc.title, 'Group chat — Chatforia');
});
test('reenabling does not replay OFF-period events, but allows future messages', () => {
  const qa = harness({ enabled: false }); qa.emit('message:upsert', qa.message(42));
  qa.setEnabled(true); qa.emit('message:new', qa.message(42)); qa.emit('message:upsert', qa.message(43));
  assert.equal(qa.banners.length, 1); assert.equal(qa.banners[0].id, 'a11y-message-43');
});
test('switching OFF stops the current blink and dismisses its banners', () => {
  const qa = harness(); qa.emit('message:upsert', qa.message(42)); qa.setEnabled(false);
  assert.equal(qa.doc.title, 'Group chat — Chatforia'); assert.equal(qa.timers.size, 0);
  assert.deepEqual(qa.hidden, ['a11y-message-42']);
});
test('returning to a focused visible tab restores its original title', () => {
  const qa = harness(); qa.emit('message:upsert', qa.message(42)); qa.focus();
  assert.equal(qa.doc.title, 'Group chat — Chatforia'); assert.equal(qa.timers.size, 0);
});
test('visible foreground events show a banner without a blinking title', () => {
  const qa = harness({ foreground: true }); qa.emit('message:upsert', qa.message(42));
  assert.equal(qa.banners.length, 1); assert.equal(qa.timers.size, 0);
});
test('navigation title updates survive blink cleanup', () => {
  const qa = harness(); qa.emit('message:upsert', qa.message(42)); qa.doc.title = 'Contacts — Chatforia';
  qa.tick(); qa.focus(); assert.equal(qa.doc.title, 'Contacts — Chatforia');
});
test('incoming call/video aliases deduplicate and ending clears the matching alert', () => {
  const qa = harness(); const call = { callId: 'c-1', callerId: 1 };
  qa.emit('call:incoming', call); qa.emit('video:incoming', call);
  assert.equal(qa.banners.length, 1); assert.match(qa.doc.title, /Incoming call/);
  qa.emit('call:ended', { callId: 'other' }); assert.equal(qa.timers.size, 1);
  qa.emit('call:ended', call); assert.equal(qa.timers.size, 0);
  assert.deepEqual(qa.hidden, ['a11y-call-c-1']);
});
test('call answer and participant invitations use the same visual lifecycle', () => {
  const qa = harness(); const call = { callId: 7, fromUser: { id: 1 } };
  qa.emit('call:participant-invite', call); assert.equal(qa.banners.length, 1);
  qa.emit('call:answer', call); assert.equal(qa.timers.size, 0);
});
test('outgoing calls and malformed invitations do not alert', () => {
  const qa = harness(); qa.emit('call:incoming', { callId: 7, callerId: 68 });
  qa.emit('call:incoming', {}); qa.emit('video:incoming', null);
  assert.equal(qa.banners.length, 0);
});
test('message bodies, caller names and encrypted content never enter visual alerts', () => {
  const qa = harness();
  qa.emit('message:upsert', qa.message(42, { rawContent: 'SECRET', contentCiphertext: 'CIPHER', sender: { id: 1, username: 'PRIVATE-NAME' } }));
  const visible = JSON.stringify(qa.banners) + qa.doc.title;
  for (const value of ['SECRET', 'CIPHER', 'PRIVATE-NAME']) assert.equal(visible.includes(value), false);
});
test('dispose removes exact subscriptions, restores title and stops all future alerts', () => {
  const qa = harness(); qa.emit('message:upsert', qa.message(42)); qa.alerts.dispose();
  assert.equal(qa.timers.size, 0); assert.equal(qa.doc.title, 'Group chat — Chatforia');
  assert.equal([...qa.events.values()].every((handlers) => handlers.size === 0), true);
  qa.emit('message:upsert', qa.message(43)); assert.equal(qa.banners.length, 1);
});
test('observer never mutates incoming message metadata', () => {
  const qa = harness(); const message = qa.message(42); const original = structuredClone(message);
  qa.emit('message:upsert', message); assert.deepEqual(message, original);
});
test('app-wide mounting uses latest account preference without audio or permission requests', async () => {
  const app = await source('client/src/App.jsx'); const component = await source('client/src/components/VisualAlerts.jsx');
  assert.match(app, /<VisualAlerts \/>/);
  assert.match(component, /useSocketRaw\(\)/);
  assert.match(component, /a11yVisualAlerts === true/);
  assert.match(component, /\[socket, userId\]/);
  assert.doesNotMatch(component + code, /playSound|new Audio|requestPermission|axios|fetch\(/);
});
