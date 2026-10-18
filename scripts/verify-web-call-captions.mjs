import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
const root = new URL('../', import.meta.url);
const read = (file) => readFile(new URL(file, root), 'utf8');
const load = async (file) => import(`data:text/javascript;base64,${Buffer.from(await read(file)).toString('base64')}`);
const { subscribeCallCaptions, captionAppearance } = await load('client/src/utils/callCaptions.js');
function harness(callId) {
  if (arguments.length === 0) callId = 1027;
  const handlers = new Set(), text = [];
  const socket = { on: (name, handler) => { assert.equal(name, 'call:caption'); handlers.add(handler); },
    off: (name, handler) => { assert.equal(name, 'call:caption'); handlers.delete(handler); } };
  const stop = subscribeCallCaptions({ socket, callId, onText: (value) => text.push(value) });
  return { text, handlers, stop, emit: (event) => [...handlers].forEach((fn) => fn(event)) };
}
test('matches numeric and string call IDs; partials replace and final aliases deduplicate', () => {
  const q = harness(); q.emit({ callId: '1027', text: 'Hello' });
  q.emit({ callId: 1027, text: 'Hello world', isFinal: true });
  q.emit({ callId: 1027, text: 'Hello world', isFinal: true });
  assert.deepEqual(q.text, ['Hello', 'Hello world']);
});
test('other calls and malformed/empty captions never disclose text', () => {
  const q = harness();
  for (const event of [null, {}, { callId: 1028, text: 'Wrong call' }, { callId: 1027, text: {} }, { callId: 1027, text: '  ' }]) q.emit(event);
  assert.deepEqual(q.text, []);
});
test('unmount and call changes remove exact subscription and reject late delivery', () => {
  const q = harness(); const late = [...q.handlers][0]; q.stop(); q.stop();
  late({ callId: 1027, text: 'Late private text' }); assert.equal(q.handlers.size, 0); assert.deepEqual(q.text, []);
});
test('callee captions exclude the callee own outbound speech', () => {
  const q = harness(); q.emit({ callId: 1027, text: 'My own speech', track: 'outbound_track' });
  q.emit({ callId: 1027, text: 'Remote caller', track: 'inbound_track' });
  assert.deepEqual(q.text, ['Remote caller']);
});
test('invalid call IDs never subscribe', () => {
  for (const id of [null, undefined, '', 0, -1, 'unknown']) assert.equal(harness(id).handlers.size, 0);
});
test('caption size is bounded without persisting transcript text', () => {
  const q = harness(); q.emit({ callId: 1027, text: 'x'.repeat(5000) }); assert.equal(q.text[0].length, 4000);
});
test('all four font sizes and three backgrounds have explicit browser styles', () => {
  assert.deepEqual(['sm','md','lg','xl'].map((size) => captionAppearance(size, 'dark').fontSize), ['0.875rem','1rem','1.25rem','1.5rem']);
  assert.equal(captionAppearance('lg','light').color, '#111');
  assert.equal(captionAppearance('lg','dark').color, '#fff');
  assert.equal(captionAppearance('lg','transparent').background, 'transparent');
});

const source = await read('server/routes/voiceWebhooks.js');
const start = source.indexOf("router.post('/transcription',");
const end = source.indexOf("\nrouter.post('/client'", start);
async function callback({ callee = { eligible: true, a11yLiveCaptions: true }, exists = true,
  valid = true, event = 'transcription-content', data = '{"transcript":"Hello from caller"}' } = {}) {
  let handler, query; const emitted = [];
  vm.runInNewContext(source.slice(start, end), {
    router: { post: (_path, fn) => { handler = fn; } },
    process: { env: { TWILIO_AUTH_TOKEN: 'test', APP_API_ORIGIN: 'https://api.example.com' } },
    URL, console, twilio: { validateRequest: () => valid },
    prisma: { call: { findFirst: async (args) => { query = args; return exists ? { id: 1027, callee } : null; } } },
    hasPremiumAccess: (user) => user?.eligible === true,
    emitToUser: (...args) => emitted.push(args),
  });
  let status;
  await handler({ originalUrl: '/webhooks/voice/transcription?backendCallId=1027&captionUserId=65',
    query: { backendCallId: '1027', captionUserId: '65' }, get: () => 'signed',
    body: { TranscriptionEvent: event, TranscriptionData: data, Track: 'inbound_track', Final: 'true' } },
  { sendStatus: (code) => { status = code; } });
  return { emitted, query, status };
}
test('actual callback sends only to the eligible call recipient and requires an unended call', async () => {
  const q = await callback(); assert.equal(q.status, 204); assert.equal(q.emitted.length, 1);
  assert.equal(q.emitted[0][0], 65); assert.equal(q.emitted[0][1], 'call:caption');
  assert.equal(q.emitted[0][2].text, 'Hello from caller');
  assert.equal(q.query.where.endedAt, null); assert.equal(q.query.where.calleeId, 65);
});
test('saved OFF or failed Premium eligibility blocks callback disclosure', async () => {
  for (const callee of [null, { eligible: false, a11yLiveCaptions: true }, { eligible: true, a11yLiveCaptions: false }]) {
    const q = await callback({ callee }); assert.equal(q.status, 204); assert.equal(q.emitted.length, 0);
  }
});
test('invalid signature or recipient mismatch cannot emit', async () => {
  for (const options of [{ valid: false }, { exists: false }]) {
    const q = await callback(options); assert.equal(q.status, 403); assert.equal(q.emitted.length, 0);
  }
});
test('lifecycle-only, empty and malformed transcript events cannot emit', async () => {
  for (const options of [{ event: 'transcription-started' }, { data: '{}' }, { data: 'invalid' }]) {
    const q = await callback(options); assert.equal(q.emitted.length, 0);
  }
});
