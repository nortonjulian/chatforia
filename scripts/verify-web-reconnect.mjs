// Executes production receipt code and React effect bodies with controlled
// network/socket boundaries. Live browser testing remains required.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');
const helper = source('client/src/utils/readReceiptRecovery.js');
const { mergeRecoveredReadReceipts: merge, recoverLoadedReadReceipts: recover } =
  await import(`data:text/javascript;base64,${Buffer.from(helper).toString('base64')}`);
const row = (id, extra = {}) => ({ id, chatRoomId: 10, senderId: 7, readBy: [], ...extra });
const reader = { id: 8, username: 'reader' };
const page = (items, nextCursorId = null) => ({ items, nextCursorId });

test('missed receipt updates an existing message without any newer message', async () => {
  const messages = [row(5)];
  const rows = await recover({ messages, roomId: 10, userId: 7, isActive: () => true,
    fetchLatest: async () => page([row(5, { readBy: [reader] })]),
    fetchOlder: async () => assert.fail('unexpected older request') });
  assert.deepEqual(merge(messages, rows, 10)[0].readBy, [reader]);
});
test('receipt recovery preserves edited text, originals, encryption, attachments and delivery state', () => {
  const message = row(5, { rawContent: 'edited', decryptedContent: 'translation',
    decryptedOriginalContent: 'original', decryptedOriginalKey: 'revision-key',
    encryptedKeyForMe: 'key', contentCiphertext: 'cipher', editedAt: 'revision',
    attachments: [{ id: 2 }], deliveryState: 'sent', reactionSummary: { smile: 1 } });
  const next = merge([message], [row(5, { readBy: [reader], rawContent: 'stale' })], 10)[0];
  const { readBy, ...unchanged } = next;
  const { readBy: old, ...before } = message;
  assert.deepEqual(unchanged, before);
  assert.strictEqual(next.attachments, message.attachments);
});
test('private reads stay private and prior public receipts remain disclosed', () => {
  const messages = [row(5), row(6, { readBy: [reader] })];
  assert.strictEqual(merge(messages, [row(5), row(6)], 10), messages);
});
test('duplicate recovery is idempotent and sender cannot count as a reader', () => {
  const messages = [row(5, { readBy: [reader] })];
  assert.strictEqual(merge(messages, [row(5, { readBy: [reader, { id: 7 }, { id: -1 }] })], 10), messages);
});
test('only exact shared reader/message pairs are applied', () => {
  const result = merge([row(5), row(6)], [row(5, { readBy: [reader] })], 10);
  assert.deepEqual(result[0].readBy, [reader]);
  assert.deepEqual(result[1].readBy, []);
});
test('unknown, deleted and wrong-room rows cannot restore messages', () => {
  const messages = [row(5, { deletedForAll: true }), row(6), row(7)];
  assert.strictEqual(merge(messages, [row(5, { readBy: [reader] }),
    row(6, { deletedForAll: true, readBy: [reader] }),
    row(7, { chatRoomId: 20, readBy: [reader] }), row(99, { readBy: [reader] })], 10), messages);
});
test('older loaded outgoing receipts are recovered across history pages', async () => {
  const cursors = [];
  const rows = await recover({ messages: [row(5), row(90)], roomId: 10, userId: 7,
    isActive: () => true, fetchLatest: async () => page([row(90)], 90),
    fetchOlder: async (_room, cursor) => { cursors.push(cursor);
      return cursor === 90 ? page([row(50)], 50) : page([row(5, { readBy: [reader] })]); } });
  assert.deepEqual(cursors, [90, 50]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].readBy, [reader]);
});
test('pagination stops at the loaded boundary and cannot loop on a repeated cursor', async () => {
  let calls = 0;
  await recover({ messages: [row(5)], roomId: 10, userId: 7, isActive: () => true,
    fetchLatest: async () => page([row(90)], 90),
    fetchOlder: async () => { calls++; return page([row(90)], 90); } });
  assert.equal(calls, 1);
});
test('room/account cleanup discards a late network response', async () => {
  let active = true;
  const rows = await recover({ messages: [row(5)], roomId: 10, userId: 7,
    isActive: () => active, fetchLatest: async () => { active = false; return page([row(5, { readBy: [reader] })]); } });
  assert.deepEqual(rows, []);
});
test('no outgoing server messages means no recovery request', async () => {
  const rows = await recover({ messages: [row(-1), row(5, { senderId: 8 })], roomId: 10,
    userId: 7, isActive: () => true, fetchLatest: async () => assert.fail('unexpected request') });
  assert.deepEqual(rows, []);
});
function events() {
  const handlers = new Map();
  const on = (name, fn) => { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn); };
  const off = (name, fn) => handlers.get(name)?.delete(fn);
  return { handlers, on, off, addEventListener: on, removeEventListener: off,
    async fire(name) { await Promise.all([...(handlers.get(name) || [])].map((fn) => fn())); } };
}
function receiptEffect({ fail = false, deferred = null } = {}) {
  const socket = events(), window = events(), document = { ...events(), visibilityState: 'visible' };
  let messages = [row(5)], calls = 0, cleanup;
  const s = source('client/src/components/ChatView.jsx');
  const start = s.indexOf('  // Receipt recovery is independent');
  const end = s.indexOf('\n  useEffect(() => {\n  if (!socket) return;\n\n  const onReaction', start);
  assert.ok(start > 0 && end > start);
  vm.runInNewContext(s.slice(start, end), {
    socket, window, document, chatroom: { id: 10 }, currentUserId: 7,
    receiptMessagesRef: { current: messages },
    recoverLoadedReadReceipts: recover, mergeRecoveredReadReceipts: merge,
    fetchLatestMessages: async () => { calls++; if (fail) throw Error('offline');
      return deferred ? await deferred : page([row(5, { readBy: [reader] })]); },
    fetchOlderMessages: async () => assert.fail('unexpected pagination'),
    setMessages: (fn) => { messages = fn(messages); }, console: { warn() {} },
    useEffect: (effect) => { cleanup = effect(); },
  });
  return { socket, window, document, cleanup, get calls() { return calls; }, get messages() { return messages; } };
}
test('actual ChatView connect handler recovers Seen without a refresh', async () => {
  const h = receiptEffect(); await h.socket.fire('connect');
  assert.deepEqual(h.messages[0].readBy, [reader]);
});
test('online, focus and visible-tab recovery work independently of new-message deltas', async () => {
  const h = receiptEffect();
  await h.window.fire('online'); await h.window.fire('focus'); await h.document.fire('visibilitychange');
  assert.equal(h.calls, 3);
  assert.deepEqual(h.messages[0].readBy, [reader]);
});
test('receipt request failure leaves message state intact and listeners permit retry', async () => {
  const h = receiptEffect({ fail: true });
  await h.socket.fire('connect'); await h.window.fire('online');
  assert.equal(h.calls, 2); assert.deepEqual(h.messages, [row(5)]);
});
test('overlapping reconnect and online signals coalesce and retry after an in-flight request', async () => {
  let resolve;
  const deferred = new Promise((done) => { resolve = done; });
  const h = receiptEffect({ deferred });
  const pending = h.socket.fire('connect');
  await h.window.fire('online');
  assert.equal(h.calls, 1);
  resolve(page([row(5, { readBy: [reader] })])); await pending;
  await new Promise((done) => setImmediate(done));
  assert.equal(h.calls, 2);
  assert.deepEqual(h.messages[0].readBy, [reader]);
});
test('actual effect cleanup prevents updates to another conversation', async () => {
  let resolve;
  const deferred = new Promise((done) => { resolve = done; });
  const h = receiptEffect({ deferred });
  const pending = h.socket.fire('connect'); h.cleanup();
  resolve(page([row(5, { readBy: [reader] })])); await pending;
  assert.deepEqual(h.messages, [row(5)]);
  await h.window.fire('online'); assert.equal(h.calls, 1);
});
function sidebarEffect(connected = false) {
  const socket = { ...events(), connected }, window = events(), document = events();
  const timers = new Map(); let count = 0, tick = 0, cleanup;
  const s = source('client/src/components/ChatroomsSidebar.jsx');
  const start = s.indexOf('  /* ---------------- authoritative live conversation state');
  const end = s.indexOf('  /* ---------------- UI states', start);
  vm.runInNewContext(s.slice(start, end), {
    socket, window, document, __testSkipLoad: false, load: () => { count++; },
    setTimeout: (fn) => { timers.set(++tick, fn); return tick; }, clearTimeout: (id) => timers.delete(id),
    useEffect: (effect) => { cleanup = effect(); },
  });
  return { socket, window, document, cleanup, get count() { return count; },
    flush() { for (const fn of timers.values()) fn(); timers.clear(); } };
}
test('Chat list live message aliases coalesce into one authoritative refresh', async () => {
  const h = sidebarEffect();
  for (const event of ['message:upsert', 'message:new', 'receive:message', 'message_read', 'message:read']) await h.socket.fire(event);
  h.flush(); assert.equal(h.count, 1);
});
test('Chat list catches up after reconnect, online and already-connected mount', async () => {
  const h = sidebarEffect(true); h.flush(); assert.equal(h.count, 1);
  await h.socket.fire('connect'); h.flush(); assert.equal(h.count, 2);
  await h.window.fire('online'); h.flush(); assert.equal(h.count, 3);
});
test('Chat list cleanup cancels pending refreshes and removes listeners', async () => {
  const h = sidebarEffect(); await h.socket.fire('message:upsert'); h.cleanup(); h.flush();
  await h.socket.fire('connect'); await h.window.fire('online'); h.flush(); assert.equal(h.count, 0);
});
test('Chat list uses the raw provider socket and rejoins its current rooms on reconnect', async () => {
  const s = source('client/src/components/ChatroomsSidebar.jsx');
  assert.ok(s.includes('const { socket } = useSocket() ?? {};'));
  const start = s.indexOf('    useEffect(() => {\n    if (!socket) return;');
  const end = s.indexOf('\n  useEffect(() => {', start + 10);
  const socket = { ...events(), connected: true, emit: (...args) => emissions.push(args) };
  const emissions = []; let cleanup;
  vm.runInNewContext(s.slice(start, end), {
    socket, items: [{ kind: 'chat', id: 10 }, { kind: 'sms', id: 20 }],
    useEffect: (effect) => { cleanup = effect(); },
  });
  await socket.fire('connect'); assert.equal(emissions.length, 2);
  assert.equal(JSON.stringify(emissions[0]), JSON.stringify(['join:rooms', ['10']]));
  cleanup(); await socket.fire('connect'); assert.equal(emissions.length, 2);
});
