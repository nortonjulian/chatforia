import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createCallHistoryFeed, subscribeCallHistory, CALL_HISTORY_EVENTS } from '../client/src/utils/callHistoryFeed.js';
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const row = (id, status = 'RINGING') => ({ id, status, createdAt: new Date(Date.UTC(2026, 9, 19, 0, id)).toISOString() });
function harness(fetchPage) {
  const jobs = new Map(), calls = []; let seq = 0, state;
  const feed = createCallHistoryFeed({ fetchPage: options => { calls.push(options); return fetchPage(options); },
    pageSize: 2, onChange: value => { state = value; },
    schedule: fn => { jobs.set(++seq, fn); return seq; }, cancel: id => jobs.delete(id) });
  return { feed, jobs, calls, get state() { return state; }, async run() {
    const pending = [...jobs.values()]; jobs.clear(); pending.forEach(fn => fn()); await tick();
  } };
}
test('history loads authenticated API rows, deduplicates and sorts by creation rather than end time', async () => {
  const old = { ...row(1), endedAt: '2099-01-01' };
  const h = harness(async () => ({ items: [old, row(2), row(2)] })); await tick();
  assert.deepEqual(h.state.items.map(x => x.id), [2, 1]); assert.equal(h.state.loading, false); h.feed.dispose();
});
test('incoming/ended aliases coalesce and reflect the latest saved status', async () => {
  let rows = [row(1)]; const h = harness(async () => ({ items: rows })); await tick();
  rows = [row(2), row(1, 'ENDED')]; h.feed.refresh(); h.feed.refresh(); h.feed.refresh();
  assert.equal(h.jobs.size, 1); await h.run(); assert.equal(h.calls.length, 2);
  assert.equal(h.state.items[1].status, 'ENDED'); h.feed.dispose();
});
test('a late initial response cannot overwrite a newer socket-triggered response', async () => {
  let old; let calls = 0;
  const h = harness(() => ++calls === 1 ? new Promise(resolve => { old = resolve; }) : Promise.resolve({ items: [row(2)] }));
  h.feed.refresh(); await h.run(); old({ items: [row(1)] }); await tick();
  assert.deepEqual(h.state.items.map(x => x.id), [2]); h.feed.dispose();
});
test('confirmed deletion cannot be resurrected by a stale server response', async () => {
  const h = harness(async () => ({ items: [row(2), row(1)] })); await tick();
  h.feed.remove([2]); assert.deepEqual(h.state.items.map(x => x.id), [1]); await h.run();
  assert.deepEqual(h.state.items.map(x => x.id), [1]); h.feed.dispose();
});
test('deletion from another session is reconciled by a complete authorized refresh', async () => {
  let rows = [row(2), row(1)]; const h = harness(async () => ({ items: rows })); await tick();
  rows = [row(1)]; h.feed.refresh(); await h.run(); assert.deepEqual(h.state.items.map(x => x.id), [1]); h.feed.dispose();
});
test('live refresh preserves the loaded page range and updates older rows', async () => {
  let ended = false;
  const h = harness(async ({ cursor }) => cursor ? ({ items: [row(2, ended ? 'ENDED' : 'RINGING'), row(1)] }) : ({ items: [row(4), row(3)], nextCursor: 3 }));
  await tick(); await h.feed.loadMore(); assert.deepEqual(h.state.items.map(x => x.id), [4, 3, 2, 1]);
  ended = true; h.feed.refresh(); await h.run();
  assert.equal(h.state.items.find(x => x.id === 2).status, 'ENDED'); assert.equal(h.state.items.length, 4); h.feed.dispose();
});
test('refresh during load-more invalidates its response and reconciles the full loaded range', async () => {
  let pending, hold = true;
  const h = harness(async ({ cursor }) => cursor ? hold ? new Promise(resolve => { pending = resolve; }) : { items: [row(2), row(1)] } : { items: [row(4), row(3)], nextCursor: 3 });
  await tick(); const more = h.feed.loadMore(); await tick(); hold = false; h.feed.refresh(); await h.run();
  pending({ items: [row(9)] }); await more;
  assert.deepEqual(h.state.items.map(x => x.id), [4, 3, 2, 1]); h.feed.dispose();
});
test('network failure preserves existing history, and focus/reconnect can retry', async () => {
  let fail = false; const h = harness(async () => { if (fail) throw new Error('offline'); return { items: [row(1)] }; });
  await tick(); fail = true; h.feed.refresh(); await h.run();
  assert.equal(h.state.items.length, 1); assert.equal(h.state.error, 'offline');
  fail = false; h.feed.refresh(); await h.run(); assert.equal(h.state.error, ''); h.feed.dispose();
});
test('disposal cancels queued refresh and ignores a response from a previous account', async () => {
  let resolve; const h = harness(() => new Promise(done => { resolve = done; }));
  const before = h.state; h.feed.refresh(); h.feed.dispose(); assert.equal(h.jobs.size, 0); resolve({ items: [row(99)] }); await tick();
  assert.equal(h.state, before); assert.equal(h.state.items.length, 0);
});
test('socket lifecycle, online, focus and visible-tab events refresh; cleanup removes exact listeners', () => {
  const socket = new EventEmitter(), events = new EventEmitter(), document = new EventEmitter(); document.hidden = false;
  const env = { document, addEventListener: events.on.bind(events), removeEventListener: events.off.bind(events) };
  document.addEventListener = document.on.bind(document); document.removeEventListener = document.off.bind(document);
  let refreshes = 0; const cleanup = subscribeCallHistory({ socket, env, refresh: () => refreshes++ });
  CALL_HISTORY_EVENTS.forEach(name => socket.emit(name)); ['online', 'focus', 'chatforia:call-history-changed'].forEach(name => events.emit(name));
  document.emit('visibilitychange'); assert.equal(refreshes, CALL_HISTORY_EVENTS.length + 4);
  document.hidden = true; document.emit('visibilitychange'); assert.equal(refreshes, CALL_HISTORY_EVENTS.length + 4);
  cleanup(); const old = refreshes; socket.emit('connect'); events.emit('focus'); document.hidden = false; document.emit('visibilitychange');
  assert.equal(refreshes, old); assert.equal(socket.listenerCount('call:ended'), 0);
});

// Run the current production route handlers, with deterministic database/network boundaries.
const routeSource = (await readFile(new URL('../server/routes/calls.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?;\n/gm, '').replace('export default router;', '');
function server({ failWrite = false, existingCall = null, failCreate = false } = {}) {
  const routes = new Map(), emissions = [], deletions = [], queries = [];
  const records = [
    { ...row(1), callerId: 10, calleeId: 20, mode: 'VIDEO', voicemails: [] },
    { ...row(2), callerId: 20, calleeId: 10, mode: 'AUDIO', voicemails: [] },
    { ...row(3), callerId: 20, calleeId: 30, mode: 'VIDEO', voicemails: [] },
    { ...row(4), callerId: 20, calleeId: 30, memberIds: [10], mode: 'AUDIO', voicemails: [] },
  ];
  const owned = (item, userId) => item.callerId === userId || item.calleeId === userId || item.memberIds?.includes(userId);
  const prisma = {
    user: { findUnique: async ({ where }) => ({ id: where.id, username: `user${where.id}` }) },
    call: {
      findFirst: async () => existingCall,
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }) => {
        if (failCreate) throw Error('Creation failed');
        const created = { ...data, id: 50, createdAt: new Date() }; records.push(created); return created;
      },
      findMany: async query => {
        queries.push(query); const userId = query.where.historyDeletions.none.userId;
        assert.ok(query.where.OR.some(clause => clause.callerId === userId));
        assert.ok(query.where.OR.some(clause => clause.calleeId === userId));
        assert.ok(query.where.OR.some(clause => clause.participants?.some.userId === userId));
        const matches = records.filter(item => owned(item, userId) && !deletions.some(d => d.callId === item.id && d.userId === userId) && (!query.where.id || query.where.id.in.includes(item.id)));
        return query.select ? matches.map(({ id }) => ({ id })) : matches;
      },
      findUnique: async ({ where }) => records.find(item => item.id === where.id) || null,
      delete: () => { throw Error('Canonical call rows must never be deleted'); },
    },
    callParticipant: { findUnique: async ({ where }) => records.find(item => item.id === where.callId_userId.callId)?.memberIds?.includes(where.callId_userId.userId) ? {} : null },
    callHistoryDeletion: {
      createMany: async ({ data }) => { if (failWrite) throw Error('DB unavailable'); deletions.push(...data); return { count: data.length }; },
      upsert: async ({ create }) => { if (failWrite) throw Error('DB unavailable'); deletions.push(create); return create; },
    },
  };
  prisma.$executeRaw = async () => {};
  prisma.$transaction = callback => callback(prisma);
  const router = { use() {} };
  for (const method of ['get', 'post', 'delete', 'patch']) router[method] = (path, handler) => routes.set(`${method} ${path}`, handler);
  vm.runInNewContext(routeSource, { express: { Router: () => router }, asyncHandler: handler => handler,
    prisma, emitToUser: (...args) => emissions.push(args), requireAuth() {}, startHostedAllowanceMonitor() {},
    sendVoipCallPushToUser: async () => {}, sendPushToUser: async () => {}, console });
  return { emissions, deletions, records, queries, async request(method, path, { userId = 10, ids, id, body } = {}) {
    const res = { code: 200, headers: {}, status(code) { this.code = code; return this; }, set(key, value) { this.headers[key] = value; return this; }, json(body) { this.body = body; return this; } };
    await routes.get(`${method} ${path}`)({ user: { id: userId }, params: { id }, body: body || { ids }, query: {} }, res);
    return res;
  } };
}
test('actual bulk delete hides only owned rows and emits only to that account', async () => {
  const s = server(); const res = await s.request('post', '/history/delete-selected', { ids: [1, 2, 3, 4, 1, 'bad'] });
  assert.equal(res.code, 200); assert.equal(res.body.count, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(s.deletions)), [{ callId: 1, userId: 10 }, { callId: 2, userId: 10 }, { callId: 4, userId: 10 }]);
  assert.deepEqual(s.emissions.map(([id, event]) => [id, event]), [[10, 'call:history-changed']]);
  assert.equal(s.records.length, 4);
});
test('deleted calls stay hidden on fresh history requests while the other participant keeps them', async () => {
  const s = server(); await s.request('post', '/history/delete-selected', { ids: [1, 2] });
  const mine = await s.request('get', '/history'); const theirs = await s.request('get', '/history', { userId: 20 });
  assert.deepEqual(mine.body.items.map(x => x.id), [4]); assert.ok(theirs.body.items.some(x => x.id === 1));
  assert.equal(mine.headers['Cache-Control'], 'private, no-store');
});
test('bulk delete is idempotent and invalid IDs cannot broadcast or modify history', async () => {
  const s = server(); await s.request('post', '/history/delete-selected', { ids: [1] });
  const res = await s.request('post', '/history/delete-selected', { ids: [1, 3] }); assert.equal(res.body.count, 0);
  const bad = await s.request('post', '/history/delete-selected', { ids: [0, -1, 'bad'] }); assert.equal(bad.code, 400);
  assert.equal(s.emissions.length, 1); assert.equal(s.deletions.length, 1);
});
test('single-delete and clear-history notify only the requesting account and retain canonical calls', async () => {
  const s = server(); await s.request('delete', '/:id', { id: 1 }); await s.request('delete', '/history');
  assert.ok(s.emissions.every(([id, event]) => id === 10 && event === 'call:history-changed'));
  assert.equal(s.deletions.length, 3); assert.equal(s.records.length, 4);
});
test('nonmember cannot delete a foreign call or trigger an account refresh event', async () => {
  const s = server(); const res = await s.request('delete', '/:id', { id: 3 });
  assert.equal(res.code, 403); assert.equal(s.emissions.length, 0); assert.equal(s.deletions.length, 0);
});
test('failed database write cannot broadcast a deletion or report success', async () => {
  const s = server({ failWrite: true }); await assert.rejects(s.request('post', '/history/delete-selected', { ids: [1] }), /DB unavailable/);
  assert.equal(s.emissions.length, 0); assert.equal(s.deletions.length, 0);
});

const hookSource = (await readFile(new URL('../client/src/hooks/useCallHistory.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace('export function useCallHistory', 'function useCallHistory');
function hookHarness({ accountId = 10, fetchPage = async () => ({ items: [] }) } = {}) {
  const slots = [], effects = [], socket = new EventEmitter(), envEvents = new EventEmitter();
  let index = 0, userId = accountId, localCall = {}, current; const jobs = new Map(); let seq = 0;
  const env = { addEventListener: envEvents.on.bind(envEvents), removeEventListener: envEvents.off.bind(envEvents) };
  const useState = initial => { const n = index++; if (!slots[n]) slots[n] = { value: initial }; return [slots[n].value, value => { slots[n].value = typeof value === 'function' ? value(slots[n].value) : value; }]; };
  const useRef = value => { const n = index++; if (!slots[n]) slots[n] = { current: value }; return slots[n]; };
  const useEffect = (fn, deps) => { const n = index++, old = slots[n]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) effects.push(() => { old?.cleanup?.(); slots[n] = { deps, cleanup: fn() }; }); };
  const useCallback = (fn, deps) => { const n = index++, old = slots[n]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) slots[n] = { deps, fn }; return slots[n].fn; };
  const hook = vm.runInNewContext(hookSource + '\nuseCallHistory;', {
    useState, useRef, useEffect, useCallback, useSocketRaw: () => socket, useCall: () => localCall,
    getCallHistoryPage: options => fetchPage(userId, options),
    createCallHistoryFeed: options => createCallHistoryFeed({ ...options, schedule: fn => { jobs.set(++seq, fn); return seq; }, cancel: id => jobs.delete(id) }),
    subscribeCallHistory: options => subscribeCallHistory({ ...options, env }),
  });
  function render() { index = 0; current = hook(userId); effects.splice(0).forEach(fn => fn()); return current; }
  render();
  return { socket, jobs, render, get current() { return current; },
    account(id) { userId = id; return render(); }, call(value) { localCall = value; return render(); },
    async flush() { await tick(); render(); },
    async run() { const callbacks = [...jobs.values()]; jobs.clear(); callbacks.forEach(fn => fn()); await tick(); render(); },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
test('actual shared hook fetches once on mount and refreshes on local outgoing lifecycle', async () => {
  let calls = 0; const h = hookHarness({ fetchPage: async () => { calls++; return { items: [row(calls)] }; } });
  await h.flush(); assert.equal(calls, 1); h.call({ active: { callId: 12 }, pending: true, status: 'Connecting' });
  await h.run(); assert.equal(calls, 2); assert.equal(h.current.items[0].id, 2); h.dispose();
});
test('actual shared hook cannot disclose previous account history after an account switch', async () => {
  let resolveOld;
  const h = hookHarness({ fetchPage: userId => userId === 10 ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ items: [row(20)] }) });
  assert.equal(h.account(20).items.length, 0); await h.flush(); assert.equal(h.current.items[0].id, 20);
  resolveOld({ items: [row(10)] }); await h.flush(); assert.equal(h.current.items[0].id, 20); h.dispose();
});
test('actual shared hook refreshes on reconnect and releases old socket subscriptions', async () => {
  let calls = 0; const h = hookHarness({ fetchPage: async () => { calls++; return { items: [] }; } });
  await h.flush(); h.socket.emit('connect'); h.socket.emit('call:history-changed'); await h.run();
  assert.equal(calls, 2); h.dispose(); assert.equal(h.socket.listenerCount('connect'), 0); assert.equal(h.jobs.size, 0);
});
test('signed-out shared hook does not fetch private history', async () => {
  let calls = 0; const h = hookHarness({ accountId: null, fetchPage: async () => { calls++; return { items: [row(1)] }; } });
  await h.flush(); assert.equal(calls, 0); assert.equal(h.current.items.length, 0); h.dispose();
});

const apiSource = (await readFile(new URL('../client/src/api/calls.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace(/export /g, '');
test('actual API wrapper preserves pagination and sends only explicit selected IDs to bulk deletion', async () => {
  const calls = [];
  const api = vm.runInNewContext(apiSource + '\n({ getCallHistoryPage, deleteCallHistory });', { axiosClient: {
    get: async (...args) => { calls.push(args); return { data: { items: [row(12)], nextCursor: 12 } }; },
    post: async (...args) => { calls.push(args); return { data: { ok: true, count: 2 } }; },
  } });
  const result = await api.getCallHistoryPage({ limit: 25, cursor: 99 });
  assert.equal(result.nextCursor, 12); assert.equal(calls[0][0], '/calls/history');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), { params: { limit: 25, cursor: 99 } });
  await api.deleteCallHistory([12, 13]); assert.equal(calls[1][0], '/calls/history/delete-selected');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1][1])), { ids: [12, 13] });
});
test('actual bulk API wrapper rejects an unacknowledged success response', async () => {
  const api = vm.runInNewContext(apiSource + '\n({ deleteCallHistory });', { axiosClient: { post: async () => ({ data: {} }) } });
  await assert.rejects(api.deleteCallHistory([1]), /Could not delete selected calls/);
});


test('new video invitation notifies both account histories after its transaction commits', async () => {
  const s = server(); const res = await s.request('post', '/invite', { body: { calleeId: 20, mode: 'VIDEO' } });
  assert.equal(res.code, 201);
  assert.deepEqual(s.emissions.filter(([, event]) => event === 'call:history-changed').map(([id]) => id), [10, 20]);
  assert.ok(s.records.some(item => item.id === res.body.callId));
});
test('rejected duplicate invitation cannot publish a fictitious history change', async () => {
  const s = server({ existingCall: { id: 10, callerId: 20, calleeId: 10, status: 'RINGING' } });
  const res = await s.request('post', '/invite', { body: { calleeId: 20, mode: 'VIDEO' } });
  assert.equal(res.code, 409); assert.equal(s.emissions.length, 0);
});
test('failed call creation cannot publish a history change', async () => {
  const s = server({ failCreate: true });
  await assert.rejects(s.request('post', '/invite', { body: { calleeId: 20, mode: 'AUDIO' } }), /Creation failed/);
  assert.equal(s.emissions.length, 0);
});
test('external call creation refreshes only the owning account history', async () => {
  const s = server(); const res = await s.request('post', '/start-external', { body: { phoneNumber: '+15555550123' } });
  assert.equal(res.code, 201); assert.deepEqual(s.emissions.map(([id, event]) => [id, event]), [[10, 'call:history-changed']]);
});
