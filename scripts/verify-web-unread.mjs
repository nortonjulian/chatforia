// Dependency-free regression harness: executes the production route and React
// effect callbacks with controlled database/DOM/socket boundaries.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');

function routeHarness(messages, { member = true } = {}) {
  let handler;
  const read = new Set();
  const emissions = [];
  let synced = 0;
  const prisma = {
    participant: {
      findFirst: async () => member ? { id: 1 } : null,
      findMany: async () => member ? [{ chatRoomId: 10 }] : [],
    },
    message: {
      findUnique: async ({ where }) => messages.find((m) => m.id === where.id),
      findMany: async ({ where, take }) => {
        if (where.id?.in) return messages.filter((m) => where.id.in.includes(m.id));
        return messages.filter((m) =>
          m.chatRoomId === where.chatRoomId && m.id <= where.id.lte &&
          m.senderId !== where.senderId.not && !m.deletedForAll &&
          !read.has(m.id) && (!m.expiresAt || m.expiresAt > new Date())
        ).sort((a, b) => a.id - b.id).slice(0, take);
      },
    },
    messageRead: {
      createMany: async ({ data }) => { data.forEach((row) => read.add(row.messageId)); },
    },
  };
  const errors = Object.fromEntries([
    ['badRequest', 400], ['forbidden', 403],
  ].map(([name, status]) => [name, (message) => Object.assign(new Error(message), { status })]));
  const s = source('server/routes/messages.js');
  const start = s.indexOf("router.post(\n  '/read-bulk',");
  assert.ok(start >= 0);
  const end = s.indexOf('/**\n * REACTIONS', start);
  vm.runInNewContext(s.slice(start, end), {
    router: { post: (_path, _auth, fn) => { handler = fn; } },
    requireAuth: () => {}, asyncHandler: (fn) => fn, prisma, Boom: errors,
    IS_TEST: false,
    emitMessageUpsertPerParticipant: async () => {},
    getParticipantUserIds: async () => [7, 8],
    emitToUser: (...args) => emissions.push(args),
    syncBadgeToUserDevices: async () => { synced++; },
  });
  return {
    read, emissions,
    get synced() { return synced; },
    async request(body) {
      let result;
      await handler({ user: { id: 7, username: 'reader' }, body }, {
        json: (value) => { result = value; return value; },
      });
      return result;
    },
  };
}
const row = (id, extra = {}) => ({ id, chatRoomId: 10, senderId: 8, ...extra });

test('room request persists all unread messages through a loaded boundary', async () => {
  const h = routeHarness([row(1), row(2), row(3)]);
  const reply = await h.request({ chatRoomId: 10, throughMessageId: 2 });
  assert.deepEqual([...h.read], [1, 2]);
  assert.equal(reply.count, 2);
  assert.equal(reply.hasMore, false);
  assert.equal(h.synced, 1);
  assert.ok(h.emissions.some(([, event]) => event === 'message_read'));
});
test('same boundary is idempotent and newer arrivals remain unread', async () => {
  const h = routeHarness([row(1), row(2), row(3)]);
  await h.request({ chatRoomId: 10, throughMessageId: 2 });
  const reply = await h.request({ chatRoomId: 10, throughMessageId: 2 });
  assert.equal(reply.count, 0);
  assert.equal(h.read.has(3), false);
});
test('read boundary requires room membership', async () => {
  const h = routeHarness([row(1)], { member: false });
  await assert.rejects(h.request({ chatRoomId: 10, throughMessageId: 1 }), { status: 403 });
  assert.equal(h.read.size, 0);
});
test('another room cannot supply the read boundary', async () => {
  const h = routeHarness([row(1, { chatRoomId: 99 })]);
  await assert.rejects(h.request({ chatRoomId: 10, throughMessageId: 1 }), { status: 400 });
});
test('unbounded room-only request is rejected instead of silently succeeding', async () => {
  const h = routeHarness([row(1)]);
  await assert.rejects(h.request({ chatRoomId: 10, limit: 50 }), { status: 400 });
});
test('own, deleted, expired and other-room messages are excluded', async () => {
  const h = routeHarness([
    row(1, { senderId: 7 }), row(2, { deletedForAll: true }),
    row(3, { expiresAt: new Date(0) }), row(4, { chatRoomId: 99 }), row(5),
  ]);
  await h.request({ chatRoomId: 10, throughMessageId: 5 });
  assert.deepEqual([...h.read], [5]);
});
test('backlogs larger than 500 drain in bounded batches', async () => {
  const h = routeHarness(Array.from({ length: 502 }, (_, i) => row(i + 1)));
  const first = await h.request({ chatRoomId: 10, throughMessageId: 501 });
  assert.equal(first.count, 500);
  assert.equal(first.hasMore, true);
  const second = await h.request({ chatRoomId: 10, throughMessageId: 501 });
  assert.equal(second.count, 1);
  assert.equal(second.hasMore, false);
  assert.equal(h.read.has(502), false);
});
test('existing explicit ID clients remain compatible and deduplicate IDs', async () => {
  const h = routeHarness([row(1), row(2)]);
  const reply = await h.request({ messageIds: [1, 1, -1, 0, 'bad'] });
  assert.equal(reply.count, 1);
  assert.deepEqual([...h.read], [1]);
});

function eventTarget() {
  const handlers = new Map();
  return {
    handlers,
    addEventListener: (name, fn) => handlers.set(name, fn),
    removeEventListener: (name, fn) => { if (handlers.get(name) === fn) handlers.delete(name); },
    dispatchEvent: (event) => handlers.get(event.type)?.(event),
  };
}
function effectsHarness({ visible = true, focused = true, atBottom = true, fail = false, pages = [] } = {}) {
  const timers = new Map();
  let tick = 0;
  let cleanup;
  const requests = [];
  const window = eventTarget();
  const document = { ...eventTarget(), visibilityState: visible ? 'visible' : 'hidden', hasFocus: () => focused };
  const viewport = { ...eventTarget(), scrollHeight: 1000, scrollTop: atBottom ? 900 : 0, clientHeight: 100 };
  const context = {
    window, document, Event: class { constructor(type) { this.type = type; } },
    chatroom: { id: 10 }, currentUserId: 7, messages: [row(1), row(2)],
    scrollViewportRef: { current: viewport },
    useRef: (value) => ({ current: value }),
    useEffect: (effect) => { cleanup = effect(); },
    setTimeout: (fn) => { const id = ++tick; timers.set(id, fn); return id; },
    clearTimeout: (id) => timers.delete(id),
    axiosClient: { post: async (path, body) => {
      requests.push({ path, body });
      if (fail) throw new Error('network');
      return { data: pages.shift() ?? { ok: true, count: 2, hasMore: false } };
    } },
    console: { error() {} },
  };
  const s = source('client/src/components/ChatView.jsx');
  const a = s.indexOf('  const readThroughRef =');
  const b = s.indexOf('    const jumpToMessage', a);
  assert.ok(a > 0 && b > a);
  vm.runInNewContext(s.slice(a, b), context);
  return { requests, window, document, viewport, cleanup: () => cleanup?.(),
    async flush() { const pending = [...timers.values()]; timers.clear(); for (const fn of pending) await fn(); },
  };
}
test('web read request includes a real loaded message boundary and refreshes sidebar after save', async () => {
  const h = effectsHarness();
  let refreshed = 0;
  h.window.addEventListener('sidebar:reload-rooms', () => refreshed++);
  await h.flush();
  assert.equal(h.requests[0].path, '/messages/read-bulk');
  assert.equal(h.requests[0].body.chatRoomId, 10);
  assert.equal(h.requests[0].body.throughMessageId, 2);
  assert.equal(refreshed, 1);
});
for (const [name, options] of [
  ['hidden tab', { visible: false }], ['unfocused window', { focused: false }],
  ['reading older messages', { atBottom: false }],
]) test(`${name} does not mark the conversation read`, async () => {
  const h = effectsHarness(options); await h.flush(); assert.equal(h.requests.length, 0);
});
test('failed read request does not clear sidebar and retries on focus', async () => {
  const h = effectsHarness({ fail: true });
  let refreshed = 0;
  h.window.addEventListener('sidebar:reload-rooms', () => refreshed++);
  await h.flush(); assert.equal(refreshed, 0);
  h.window.dispatchEvent({ type: 'focus' }); await h.flush();
  assert.equal(h.requests.length, 2);
});
test('successful read boundary is not submitted again on focus', async () => {
  const h = effectsHarness(); await h.flush();
  h.window.dispatchEvent({ type: 'focus' }); await h.flush();
  assert.equal(h.requests.length, 1);
});
test('client drains backlog batches with the same cutoff', async () => {
  const h = effectsHarness({ pages: [
    { ok: true, count: 500, hasMore: true }, { ok: true, count: 1, hasMore: false },
  ] });
  await h.flush();
  assert.equal(h.requests.length, 2);
  assert.ok(h.requests.every(({ body }) => body.throughMessageId === 2));
});
test('leaving the thread cancels pending reads and removes listeners', async () => {
  const h = effectsHarness(); h.cleanup(); await h.flush();
  assert.equal(h.requests.length, 0);
  assert.equal(h.window.handlers.size, 0);
  assert.equal(h.document.handlers.size, 0);
  assert.equal(h.viewport.handlers.size, 0);
});
test('duplicate message, own-message and receipt events share one authoritative recount', async () => {
  const s = source('client/src/components/ChatroomsSidebar.jsx');
  const a = s.indexOf('  /* ---------------- authoritative live conversation state');
  const b = s.indexOf('  /* ---------------- UI states', a);
  const handlers = new Map(); const timers = new Map(); let cleanup; let loads = 0; let tick = 0;
  vm.runInNewContext(s.slice(a, b), {
    useEffect: (effect) => { cleanup = effect(); }, __testSkipLoad: false,
    socket: { on: (event, fn) => handlers.set(event, fn), off: (event) => handlers.delete(event) },
    load: () => { loads++; }, window: eventTarget(), document: eventTarget(),
    setTimeout: (fn) => { const id = ++tick; timers.set(id, fn); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  for (const event of ['message:new', 'message:upsert', 'receive:message', 'message_read', 'message:read']) {
    handlers.get(event)({ item: row(2), reader: { id: 7 } });
  }
  assert.equal(timers.size, 1);
  for (const fn of timers.values()) fn();
  assert.equal(loads, 1);
  cleanup(); assert.equal(handlers.size, 0);
});

test('late conversation responses cannot restore a stale unread count', async () => {
  const s = source('client/src/components/ChatroomsSidebar.jsx');
  const a = s.indexOf('  const load = useCallback(');
  const b = s.indexOf('\n  useEffect(() => {\n    load();', a);
  assert.ok(a > 0 && b > a);
  const pending = []; const renders = []; const cached = [];
  const context = {
    useCallback: (fn) => fn, __testSkipLoad: false,
    loadRequestRef: { current: 0 }, itemsRef: { current: [row(1)] },
    setErr: () => {}, setItems: (rows) => renders.push(rows), setLoading: () => {},
    CACHE_KEY: 'test', t: (_key, fallback) => fallback,
    localStorage: { getItem: () => null, setItem: (_key, value) => cached.push(JSON.parse(value)) },
    sortThreadsNewestFirst: (rows) => rows,
    axiosClient: { get: () => new Promise((resolve) => pending.push(resolve)) },
    console,
  };
  vm.runInNewContext(s.slice(a, b) + '\nglobalThis.runLoad = load;', context);
  const stale = context.runLoad();
  const fresh = context.runLoad();
  pending[1]({ data: { items: [{ id: 10, unreadCount: 0 }] } }); await fresh;
  pending[0]({ data: { items: [{ id: 10, unreadCount: 12 }] } }); await stale;
  assert.equal(renders.length, 1);
  assert.equal(renders[0][0].unreadCount, 0);
  assert.equal(cached.at(-1)[0].unreadCount, 0);
});
