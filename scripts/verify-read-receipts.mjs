// Run with Node. Production functions execute with controlled Prisma/socket
// boundaries; this does not replace real PostgreSQL or physical-device QA.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { recordMessageReads } from '../server/services/readReceiptService.js';
import { registerReadReceipts } from '../server/sockets/readReceipts.js';
const source = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

function database({ enabled = true, member = true } = {}) {
  const reads = new Map(), shared = new Map(), writes = [];
  const rows = [1, 2, 3].map((id) => ({ id, chatRoomId: 10, senderId: 8 }));
  let preference = enabled, failPublic = false, attempts = 0, conflict = false;
  const prisma = {
    user: {
      findUnique: async () => ({ id: 7, username: 'reader', showReadReceipts: preference }),
      update: async ({ where, data }) => {
        if (failPublic) throw new Error('public write failed');
        writes.push(data);
        for (const { id } of data.readMessages.connect) shared.set(id, where.id);
        return { id: where.id };
      },
    },
    participant: {
      findUnique: async () => member ? { userId: 7 } : null,
      findFirst: async () => member ? { id: 1 } : null,
      findMany: async () => member ? [{ chatRoomId: 10 }] : [],
    },
    messageRead: {
      findUnique: async ({ where }) => {
        const date = reads.get(where.messageId_userId.messageId);
        return date ? { readAt: date } : null;
      },
      findMany: async ({ where }) => where?.messageId
        ? [...reads.keys()].filter((id) => where.messageId.in.includes(id)).map((messageId) => ({ messageId }))
        : [...reads].map(([messageId, readAt]) => ({ messageId, userId: 7, readAt })),
      createMany: async ({ data }) => {
        for (const row of data) if (!reads.has(row.messageId)) reads.set(row.messageId, row.readAt);
      },
    },
    message: {
      findUnique: async ({ where }) => rows.find((row) => row.id === where.id),
      findMany: async ({ where, select }) => {
        if (select?.readBy) return rows.filter((row) => where.id.in.includes(row.id)).map((row) => ({
          id: row.id, readBy: shared.has(row.id) ? [{ id: 7 }] : [],
        }));
        if (where.id.in) return rows.filter((row) => where.id.in.includes(row.id));
        return rows.filter((row) => row.id <= where.id.lte && !reads.has(row.id));
      },
    },
    $transaction: async (fn, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      attempts++;
      if (conflict) { conflict = false; throw Object.assign(new Error('conflict'), { code: 'P2034' }); }
      const before = new Map(reads), beforeShared = new Map(shared);
      try { return await fn(prisma); } catch (error) {
        reads.clear(); before.forEach((date, id) => reads.set(id, date));
        shared.clear(); beforeShared.forEach((reader, id) => shared.set(id, reader));
        throw error;
      }
    },
  };
  return {
    prisma, reads, shared, writes,
    set enabled(value) { preference = value; },
    set failPublic(value) { failPublic = value; },
    set conflict(value) { conflict = value; },
    get attempts() { return attempts; },
  };
}

test('ON saves private and shared reads without changing message content', async () => {
  const h = database();
  const result = await recordMessageReads(h.prisma, [1, 1, 2], 7);
  assert.deepEqual(result.sharedIds, [1, 2]);
  assert.equal(h.reads.size, 2);
  assert.deepEqual(h.writes, [{ readMessages: { connect: [{ id: 1 }, { id: 2 }] } }]);
});
test('OFF saves badge state but creates no public receipt', async () => {
  const h = database({ enabled: false });
  const result = await recordMessageReads(h.prisma, [1], 7);
  assert.equal(h.reads.size, 1);
  assert.deepEqual(result.sharedIds, []);
  assert.equal(h.shared.size, 0);
});
test('reenabling never publishes messages first read privately', async () => {
  const h = database({ enabled: false });
  await recordMessageReads(h.prisma, [1], 7);
  const firstDate = h.reads.get(1);
  h.enabled = true;
  const result = await recordMessageReads(h.prisma, [1, 2], 7);
  assert.deepEqual(result.sharedIds, [2]);
  assert.equal(h.reads.get(1), firstDate);
  assert.equal(h.shared.has(1), false);
});
test('duplicate reads retain first timestamp and produce no new public events', async () => {
  const h = database();
  await recordMessageReads(h.prisma, [1], 7);
  const firstDate = h.reads.get(1);
  assert.deepEqual((await recordMessageReads(h.prisma, [1], 7)).sharedIds, []);
  assert.equal(h.reads.get(1), firstDate);
});
test('failed shared write rolls back private state so retry is safe', async () => {
  const h = database(); h.failPublic = true;
  await assert.rejects(recordMessageReads(h.prisma, [1], 7), /public write failed/);
  assert.equal(h.reads.size, 0);
  h.failPublic = false;
  assert.deepEqual((await recordMessageReads(h.prisma, [1], 7)).sharedIds, [1]);
});
test('serialization conflict retries the whole decision', async () => {
  const h = database(); h.conflict = true;
  assert.deepEqual((await recordMessageReads(h.prisma, [1], 7)).sharedIds, [1]);
  assert.equal(h.attempts, 2);
});

function socketHarness(db) {
  let handler;
  const events = [];
  registerReadReceipts({ to: (room) => ({ emit: (...event) => events.push([room, ...event]) }) },
    { user: { id: 7 }, on: (_event, fn) => { handler = fn; } },
    { prisma: db.prisma, IS_TEST: true });
  return { events, async fire(payload = { roomId: 10, messageId: 1 }) {
    let ack; await handler(payload, (value) => { ack = value; }); return ack;
  } };
}
test('socket ON emits both client formats and OFF emits neither', async () => {
  for (const enabled of [true, false]) {
    const db = database({ enabled }), h = socketHarness(db);
    assert.equal((await h.fire()).ok, true);
    assert.equal(db.reads.size, 1);
    assert.deepEqual(h.events.map((event) => event[1]), enabled ? ['message:read', 'message_read'] : []);
    const count = h.events.length;
    assert.equal((await h.fire()).created, false);
    assert.equal(h.events.length, count);
  }
});
test('socket membership and room boundaries block receipt writes', async () => {
  const db = database({ member: false });
  assert.equal((await socketHarness(db).fire()).error, 'FORBIDDEN');
  assert.equal(db.reads.size, 0);
  const other = database();
  assert.equal((await socketHarness(other).fire({ roomId: 99, messageId: 1 })).error, 'MESSAGE_NOT_IN_ROOM');
  assert.equal(other.reads.size, 0);
});

function routeHarness(db, kind) {
  let handler, synced = 0;
  const events = [];
  const s = source('server/routes/messages.js');
  const start = s.indexOf(kind === 'bulk' ? "router.post(\n  '/read-bulk'," : "router.patch(\n  '/:id/read',");
  const end = s.indexOf(kind === 'bulk' ? '/**\n * REACTIONS' : '// POST /messages/read-bulk', start);
  vm.runInNewContext(s.slice(start, end), {
    router: { post: (_path, _auth, fn) => { handler = fn; }, patch: (_path, _auth, fn) => { handler = fn; } },
    requireAuth: () => {}, asyncHandler: (fn) => fn, IS_TEST: false, prisma: db.prisma,
    recordMessageReads, Boom: { forbidden: () => new Error('FORBIDDEN'), notFound: () => new Error('NOT_FOUND') },
    emitMessageUpsertPerParticipant: async (...event) => events.push(['upsert', ...event]),
    getParticipantUserIds: async () => [7, 8], emitToUser: (...event) => events.push(event),
    syncBadgeToUserDevices: async () => { synced++; },
  });
  return { events, get synced() { return synced; }, async request() {
    let body;
    await handler({ user: { id: 7 }, params: { id: 1 }, body: { ids: [1] },
      app: { get: () => ({ to: () => ({ emit: (...event) => events.push(event) }) }) },
    }, { json: (value) => { body = value; } });
    return body;
  } };
}
for (const kind of ['single', 'bulk']) {
  test(`${kind} route checks saved reader preference and keeps badge sync`, async () => {
    for (const enabled of [true, false]) {
      const db = database({ enabled }), h = routeHarness(db, kind);
      assert.equal((await h.request()).ok, true);
      assert.equal(db.reads.size, 1);
      assert.equal(h.synced, 1);
      assert.equal(h.events.length > 0, enabled);
    }
  });
  test(`${kind} route rejects a nonmember without recording or broadcasting`, async () => {
    const db = database({ member: false }), h = routeHarness(db, kind);
    if (kind === 'single') await assert.rejects(h.request(), /FORBIDDEN/);
    else await h.request();
    assert.equal(db.reads.size, 0);
    assert.equal(h.events.length, 0);
  });
}

test('history returns only deliberately shared reader/message pairs', async () => {
  const db = database();
  await recordMessageReads(db.prisma, [1], 7);
  db.enabled = false; await recordMessageReads(db.prisma, [2], 7); db.enabled = true;
  let handler;
  const s = source('server/routes/reads.js').replace('import express from "express";', '').replace('export const', 'const');
  vm.runInNewContext(s, { express: { Router: () => ({ get: (_path, fn) => { handler = fn; } }) }, console });
  async function request() {
    let body;
    await handler({ params: { roomId: '10' }, query: {}, user: { id: 8 }, prisma: db.prisma },
      { json: (value) => { body = value; }, status: () => { throw new Error('unexpected status'); } });
    return body;
  }
  assert.deepEqual((await request()).reads.map((row) => row.messageId), [1]);
  db.enabled = false;
  assert.deepEqual((await request()).reads.map((row) => row.messageId), [1]);
});

test('realtime shapers include deliberately shared readers, never private reads', () => {
  const service = source('server/services/messageService.js');
  assert.equal((service.match(/readBy: \{/g) || []).length, 2);
  assert.equal((service.match(/select: \{ id: true, username: true, avatarUrl: true \}/g) || []).length >= 2, true);
});
