import { messageCacheKey, assertMessageCacheKey } from '../client/src/utils/messageCacheKey.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const quiet = { log() {}, warn() {}, error() {} };
function execute(source, bindings = {}, names = []) {
  const ctx = vm.createContext({ console: quiet, Date, Set, Map, Number, Promise,
    setTimeout, clearTimeout, queueMicrotask, ...bindings });
  vm.runInContext(source.replace(/^import .*;\n/gm, '').replace(/\bexport /g, '') +
    `\nthis.result = {${names.join(',')}};`, ctx);
  return ctx.result;
}
const expirySource = read('client/src/utils/messageExpiry.js');
const expiry = execute(expirySource, {}, ['isMessageExpired','expiryEventMessageId']);
const past = new Date(Date.now() - 60_000).toISOString();
const future = new Date(Date.now() + 60_000).toISOString();
const json = (value) => JSON.parse(JSON.stringify(value));
function busHarness() {
  const events = [];
  const bus = execute(read('server/services/socketBus.js'), {},
    ['setSocketIo','setHelpers','emitMessageExpiryNotice','emitMessageExpired']);
  bus.setSocketIo({ to(room) { return { emit(event, payload) { events.push({room,event,payload}); } }; } });
  return { bus, events };
}
for (const [name, message, expected] of [
  ['deadline elapsed', {expiresAt:past}, true],
  ['deadline upcoming', {expiresAt:future}, false],
  ['OFF message', {expiresAt:null}, false],
  ['legacy message', {}, false],
  ['malformed deadline', {expiresAt:'bad'}, false],
]) test(name, () => assert.equal(expiry.isMessageExpired(message), expected));
test('exact deadline expires without extending to a later sweep', () => {
  assert.equal(expiry.isMessageExpired({expiresAt:past}, new Date(past).getTime()), true);
});
test('expiry event validates room, id and deadline', () => {
  const event = {id:42,chatRoomId:83,expiresAt:past};
  assert.equal(expiry.expiryEventMessageId(event,83),42);
  for (const patch of [{chatRoomId:82},{id:0},{id:1.2},{expiresAt:future},{expiresAt:'bad'}]) {
    assert.equal(expiry.expiryEventMessageId({...event,...patch},83),null);
  }
});
test('server notice is content-free, room-scoped, and supports both event names', () => {
  const {bus,events} = busHarness();
  bus.emitMessageExpiryNotice(83,42,past);
  assert.equal(events.length,2);
  assert.deepEqual(events.map(e=>e.event),['message:expired','message_expired']);
  for (const event of events) {
    assert.equal(event.room,'83');
    assert.deepEqual(Object.keys(event.payload).sort(),['chatRoomId','expiresAt','id','messageId','roomId']);
    assert.equal(event.payload.id,42);
  }
});
test('invalid/future expiry cannot emit', () => {
  const {bus,events} = busHarness();
  for (const args of [[0,42,past],[83,0,past],[83,1.2,past],[83,42,null],[83,42,future]]) bus.emitMessageExpiryNotice(...args);
  assert.equal(events.length,0);
});
test('tombstone path preserves canonical clients and also emits expiry', async () => {
  const {bus,events} = busHarness();
  bus.setHelpers({fetchMessageById:async()=>({id:42,chatRoomId:83,deletedForAll:true,expiresAt:past})});
  await bus.emitMessageExpired(83,42,past);
  assert.deepEqual(events.map(e=>e.event),['message:upsert','message:expired','message_expired']);
});
function cronHarness({ rows = [{id:42,chatRoomId:83,expiresAt:past}], fail = false, pending } = {}) {
  const {bus,events} = busHarness();
  let tick, writes = 0, stopped = false;
  const prisma = {message:{
    async findMany(options) { assert.equal(options.select.expiresAt,true); return pending ? pending : rows; },
    async deleteMany() { writes++; if(fail)throw Error('write failed'); return {count:rows.length}; },
  }};
  const {initDeleteExpired} = execute(read('server/cron/deleteExpiredMessages.js'), {
    prisma, emitMessageExpiryNotice:bus.emitMessageExpiryNotice,
    setInterval(fn) { tick=fn; return 9; }, clearInterval(id) { stopped=id===9; },
  }, ['initDeleteExpired']);
  const handle = initDeleteExpired(); // Exactly how production starts it: no io.
  return {tick,events,handle,get writes(){return writes;},get stopped(){return stopped;}};
}
test('production no-io startup publishes after a successful permanent deletion', async () => {
  const h=cronHarness(); await h.tick(); assert.equal(h.writes,1); assert.equal(h.events.length,2);
  await h.handle.stop(); assert.equal(h.stopped,true);
});
test('failed deletion cannot publish expiry', async () => {
  const h=cronHarness({fail:true}); await h.tick(); assert.equal(h.events.length,0);
});
test('empty sweep never writes or emits', async () => {
  const h=cronHarness({rows:[]}); await h.tick(); assert.equal(h.writes,0); assert.equal(h.events.length,0);
});
test('overlapping sweep cannot process the same batch concurrently', async () => {
  let release; const pending=new Promise(resolve=>{release=resolve;});
  const h=cronHarness({pending}); const first=h.tick(); await h.tick();
  release([{id:42,chatRoomId:83,expiresAt:past}]); await first;
  assert.equal(h.writes,1); assert.equal(h.events.length,2);
});
function storeHarness() {
  const rows = new Map();
  const asyncRequest = (run) => { const req={}; queueMicrotask(()=>{try{req.result=run();req.onsuccess?.();}catch(e){req.error=e;req.onerror?.();}});return req; };
  const os={get(key){return asyncRequest(()=>structuredClone(rows.get(key)));},
    put(row){return asyncRequest(()=>{rows.set(row.key,structuredClone(row));return row.key;});}};
  const source=read('client/src/utils/messagesStore.js')
    .replace(/import \{ assertMessageCacheKey \} from .*;\n/,'')
    .replace(/import \{ normalizeMessage, mergePageIntoState \} from .*;\n/,'')
    .replace(/async function _getConn\(mode = 'readonly'\) \{[\s\S]*?\n\}/,'async function _getConn() { return os; }');
  const store=execute(source,{os,assertMessageCacheKey,isMessageExpired:expiry.isMessageExpired,normalizeMessage:m=>m},
    ['getRoomMessages','removeExpiredMessages','upsertMessage']);
  return {rows,store};
}
test('cached history and search input exclude elapsed messages after a fresh read', async () => {
  const h=storeHarness(); h.rows.set('65:83',{key:'65:83',messages:[{id:42,expiresAt:past},{id:43,expiresAt:null}]});
  const result=await h.store.getRoomMessages('65:83'); assert.deepEqual(json(result.map(m=>m.id)),[43]);
});
test('expiry purges exactly one room and preserves its unrelated messages', async () => {
  const h=storeHarness(); h.rows.set('65:83',{key:'65:83',messages:[{id:42,expiresAt:past},{id:43,expiresAt:null}]});
  h.rows.set('65:82',{key:'65:82',messages:[{id:44,expiresAt:null}]});
  await h.store.removeExpiredMessages('65:83',[42]);
  assert.deepEqual(h.rows.get('65:83').messages.map(m=>m.id),[43]);
  assert.equal(h.rows.get('65:82').messages[0].id,44);
});
test('late expired upsert cannot resurrect cached content', async () => {
  const h=storeHarness(); h.rows.set('65:83',{key:'65:83',messages:[{id:43,expiresAt:null}]});
  await h.store.upsertMessage('65:83',{id:42,expiresAt:past,rawContent:'stale'});
  assert.deepEqual(h.rows.get('65:83').messages.map(m=>m.id),[43]);
});
test('duplicate expiry is idempotent and an unknown room stays absent', async () => {
  const h=storeHarness(); await h.store.removeExpiredMessages('65:83',[42]); await h.store.removeExpiredMessages('65:83',[42]);
  assert.equal(h.rows.size,0);
});
test('open thread clock, expiry listeners, and sidebar invalidation are wired', () => {
  const thread=read('client/src/components/ChatView.jsx');
  assert.match(thread,/const expiryNow = useNow\(\)/);
  assert.match(thread,/\{visibleMessages\.map/);
  for(const event of ['message:expired','message_expired']) {
    assert.ok(thread.includes(`socket.on('${event}', handleRealtimeExpired)`));
    assert.ok(thread.includes(`socket.off('${event}', handleRealtimeExpired)`));
    assert.ok(read('client/src/components/ChatroomsSidebar.jsx').includes(`'${event}'`));
  }
  assert.match(thread,/expiredMessageIds\.current\.has\(Number\(incoming.id\)\)/);
});
test('API preview filters expiry before cleanup and includes the message deadline', () => {
  const route=read('server/routes/conversations.js');
  assert.match(route,/AND: \[\{ OR: \[\{ expiresAt: null \}, \{ expiresAt: \{ gt: new Date\(\) \} \}\] \}\]/);
  assert.match(route,/expiresAt: lastMsg.expiresAt\?\.toISOString\(\) \?\? null/);
  assert.match(read('server/index.js'),/expiresAt: message.expiresAt/);
  assert.match(read('server/cron/cleanup.js'),/where: \{ expiresAt: \{ lt: now \}, deletedForAll: true \}/);
});
function expiryController(initial) {
  let messages=initial, purges=[], refreshes=0;
  const expiredMessageIds={current:new Set()};
  const bindings={
    currentRoomId:83, currentUserId:65, chatroom:{id:83}, messages,
    messageCacheKey,
    isMessageExpired:expiry.isMessageExpired, expiryEventMessageId:expiry.expiryEventMessageId,
    expiredMessageIds, setMessages(update){messages=update(messages);},
    removeExpiredMessages(room,ids){purges.push({room,ids});return Promise.resolve();},
    Event:class {constructor(type){this.type=type;}},
    window:{dispatchEvent(){refreshes++;}},
  };
  const source=read('client/src/components/ChatView.jsx');
  const a=source.indexOf('  const handleRealtimeExpired =');
  const b=source.indexOf("  socket.on('message:expired'",a);
  const on=execute(source.slice(a,b),bindings,['handleRealtimeExpired']).handleRealtimeExpired;
  const c=source.indexOf('    const expired = messages.filter');
  const d=source.indexOf('  }, [expiryNow, messages, chatroom?.id]);',c);
  const tick=execute('function tick() {\n'+source.slice(c,d)+'\n}',bindings,['tick']).tick;
  return {on,tick,expiredMessageIds,get messages(){return messages;},get purges(){return purges;},get refreshes(){return refreshes;}};
}
test('actual open-thread expiry callback removes one message without affecting another', () => {
  const h=expiryController([{id:42,expiresAt:past},{id:43,expiresAt:null}]);
  h.on({id:42,chatRoomId:83,expiresAt:past});
  assert.deepEqual(h.messages.map(m=>m.id),[43]); assert.equal(h.purges[0].room,'65:83');
});
test('actual open-thread callback ignores another room and future expiry', () => {
  const h=expiryController([{id:42,expiresAt:null}]);
  h.on({id:42,chatRoomId:82,expiresAt:past}); h.on({id:42,chatRoomId:83,expiresAt:future});
  assert.equal(h.messages.length,1); assert.equal(h.purges.length,0);
});
test('actual clock removes elapsed content and refreshes previews without a socket', () => {
  const h=expiryController([{id:42,expiresAt:past},{id:43,expiresAt:future},{id:44,expiresAt:null}]);
  h.tick(); assert.deepEqual(h.messages.map(m=>m.id),[43,44]);
  assert.equal(h.refreshes,1); assert.equal(h.expiredMessageIds.current.has(42),true);
});


test('unscoped room keys cannot access the message cache', async () => {
  const h = storeHarness();

  await assert.rejects(
    h.store.getRoomMessages(83),
    /account-scoped key/
  );

  await assert.rejects(
    h.store.upsertMessage(83, {
      id: 42,
      expiresAt: null,
    }),
    /account-scoped key/
  );

  await assert.rejects(
    h.store.removeExpiredMessages(83, [42]),
    /account-scoped key/
  );

  assert.equal(h.rows.size, 0);
});

test('different accounts cannot read each others cached rooms', async () => {
  const h = storeHarness();

  h.rows.set('65:83', {
    key: '65:83',
    messages: [{ id: 42, rawContent: 'Account 65' }],
  });

  h.rows.set('1:83', {
    key: '1:83',
    messages: [{ id: 43, rawContent: 'Account 1' }],
  });

  const first = await h.store.getRoomMessages('65:83');
  const second = await h.store.getRoomMessages('1:83');

  assert.deepEqual(first.map(m => m.id), [42]);
  assert.deepEqual(second.map(m => m.id), [43]);
});
