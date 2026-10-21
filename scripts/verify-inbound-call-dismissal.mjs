import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../server/routes/voiceWebhooks.js', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('async function finishInboundAppLeg('), source.indexOf('function inQuietHours('));
const start = source.indexOf("router.post('/inbound-app-complete'");
const end = source.indexOf('\nrouter.post(', start + 1);
const route = source.slice(start, end < 0 ? undefined : end);

async function run({ status = 'no-answer', count = 1, fail = false, callId = '940', voicemail = true } = {}) {
  const events = [], writes = [], actions = [];
  let handler;
  class VoiceResponse {
    say(...args) { actions.push(['say', ...args]); return this; }
    hangup() { actions.push(['hangup']); return this; }
    record(options) { actions.push(['record', options]); return this; }
    play(url) { actions.push(['play', url]); return this; }
    toString() { return JSON.stringify(actions); }
  }
  const context = {
    VoiceResponse, Date, Number, String, URLSearchParams, encodeURIComponent,
    console: { log() {}, error() {} },
    normalizeE164: value => value,
    isE164: value => /^\+\d+$/.test(value || ''),
    inQuietHours: () => false,
    prisma: {
      call: { updateMany: async mutation => {
        writes.push(mutation);
        if (fail) throw new Error('database unavailable');
        return { count };
      } },
      user: { findUnique: async () => ({ forwardingEnabledCalls: false, voicemailEnabled: voicemail, voicemailGreetingText: 'Leave a message' }) },
    },
    emitToUser: (...args) => events.push(args),
    router: { post: (_path, fn) => { handler = fn; } },
  };
  vm.runInNewContext(helper + route, context);
  let response;
  const res = { type() { return this; }, send(value) { response = value; return this; } };
  await handler({ body: { DialCallStatus: status, DialCallDuration: '4' }, query: {
    userId: '65', callId, phoneNumberId: '5', from: '+15550001111', to: '+15550009999',
  } }, res);
  return { events, writes, actions, response };
}

for (const [status, expected] of [['no-answer', 'MISSED'], ['busy', 'DECLINED'], ['completed', 'ENDED']]) {
  test(`${status} notifies only the inbound recipient after its saved transition`, async () => {
    const result = await run({ status });
    assert.equal(result.events.length, 1);
    const [account, event, payload] = result.events[0];
    assert.equal(account, 65);
    assert.equal(event, 'call:ended');
    assert.equal(payload.callId, 940);
    assert.equal(payload.status, expected);
    assert.equal(result.writes[0].where.callerId, 65);
    assert.equal(result.writes[0].where.id, 940);
    if (status !== 'completed') {
      const recording = result.actions.find(action => action[0] === 'record');
      assert.ok(recording, 'caller still receives voicemail recording instructions');
      assert.ok(recording[1].recordingStatusCallback.includes('relatedCallId=940'));
    }
  });
}

test('duplicate or already terminal callback cannot emit a fictitious transition', async () => {
  assert.equal((await run({ count: 0 })).events.length, 0);
});
test('failed database write cannot broadcast a completed transition', async () => {
  assert.equal((await run({ fail: true })).events.length, 0);
});
test('invalid call identity cannot write or broadcast', async () => {
  const result = await run({ callId: 'invalid' });
  assert.equal(result.writes.length, 0);
  assert.equal(result.events.length, 0);
});
test('voicemail OFF still dismisses recipient ringing', async () => {
  const result = await run({ voicemail: false });
  assert.equal(result.events.length, 1);
  assert.equal(result.actions.some(action => action[0] === 'record'), false);
});

const clientSource = readFileSync(new URL('../client/src/context/CallContext.jsx', import.meta.url), 'utf8');
const clientStart = clientSource.indexOf('  function onEnded(payload) {');
let depth = 0, clientEnd;
for (let i = clientSource.indexOf('{', clientStart); i < clientSource.length; i++) {
  if (clientSource[i] === '{') depth++;
  if (clientSource[i] === '}' && --depth === 0) { clientEnd = i + 1; break; }
}
const clientHandler = clientSource.slice(clientStart, clientEnd);
function receive(payload, active = null, incoming = { callId: 940 }) {
  let dismissed = false;
  const context = {
    activeRef: { current: active }, incomingRef: { current: incoming },
    answeringCallIdRef: { current: null },
    cleanup: () => { dismissed = true; },
    setPending() {}, setStatus() {},
  };
  vm.runInNewContext(clientHandler + '\nonEnded(' + JSON.stringify(payload) + ');', context);
  return dismissed;
}
test('actual browser ended handler dismisses the matching ringing prompt', async () => {
  const result = await run();
  assert.equal(receive(result.events[0][2]), true);
});
test('another call event cannot dismiss the current prompt', () => {
  assert.equal(receive({ callId: 941, status: 'MISSED' }), false);
});
test('outgoing app caller keeps its Twilio connection during voicemail handoff', () => {
  assert.equal(receive({ callId: 940, status: 'MISSED', reason: 'no_answer' },
    { callId: 940, mediaTransport: 'twilio-voice' }, null), false);
});
