import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const source = name => readFile(new URL(name, root), 'utf8');
const load = async name => import(`data:text/javascript;base64,${Buffer.from(await source(name)).toString('base64')}`);
const { allowanceResetAt, hostedAllowanceResponse } = await load('server/utils/hostedAllowanceResponse.js');
const { callingAllowance } = await load('client/src/utils/callAllowance.js');
const { PLAN_ENTITLEMENTS } = await load('server/config/planEntitlements.js');

function snapshot({ used = 600, limit = 1800, remaining = 1200, resetAt = '2026-11-01T00:00:00.000Z' } = {}) {
  return { resetAt, usage: { hostedParticipantSeconds: { used, limit, remaining } } };
}
const availability = { monthKey: '2026-10', limit: 1800, used: 1800, remaining: 0 };

test('UTC calendar reset handles year boundaries and leap February', () => {
  assert.equal(allowanceResetAt('2026-10'), '2026-11-01T00:00:00.000Z');
  assert.equal(allowanceResetAt('2026-12'), '2027-01-01T00:00:00.000Z');
  assert.equal(allowanceResetAt('2028-02'), '2028-03-01T00:00:00.000Z');
  for (const value of [null, '', '2026-00', '2026-13', '2026-1', 'x2026-01', '0001-01']) {
    assert.equal(allowanceResetAt(value), null);
  }
});

test('owner limit error preserves existing client fields and explains reset and action', () => {
  const body = hostedAllowanceResponse(availability, true);
  assert.equal(body.code, 'PLAN_ALLOWANCE_EXCEEDED');
  assert.equal(body.detail, 'hostedParticipantSeconds');
  for (const key of ['limit', 'used', 'remaining', 'monthKey']) assert.equal(body[key], availability[key]);
  assert.equal(body.resetAt, '2026-11-01T00:00:00.000Z');
  assert.equal(body.allowanceOwner, 'self');
  assert.match(body.error, /^Your monthly app-calling allowance/);
  assert.match(body.error, /November 1, 2026 at 00:00 UTC/);
  assert.match(body.error, /My plan/);
  assert.doesNotMatch(body.error, /Hosted|hostedParticipantSeconds/);
});

test('recipient is told it is the caller allowance, with no invented reset on malformed data', () => {
  const body = hostedAllowanceResponse({ ...availability, monthKey: undefined }, false);
  assert.equal(body.allowanceOwner, 'caller');
  assert.match(body.error, /^The caller’s/);
  assert.match(body.error, /start a new call using your own allowance/);
  assert.equal(body.resetAt, null);
  assert.doesNotMatch(body.error, /Invalid Date|resets on/);
});

test('UI derives remaining and two-person time from server seconds', () => {
  const model = callingAllowance(snapshot());
  assert.equal(model.remaining, '20');
  assert.equal(model.limit, '30');
  assert.equal(model.twoPersonMinutes, '10');
  assert.equal(model.exhausted, false);
  assert.ok(model.resetLabel.includes('2026'));
  for (const minutes of [120, 500, 1000]) {
    assert.equal(callingAllowance(snapshot({ used: 0, limit: minutes * 60, remaining: minutes * 60 })).twoPersonMinutes,
      new Intl.NumberFormat().format(minutes / 2));
  }
});

test('UI never rounds remaining time up or trusts an inconsistent larger remaining value', () => {
  assert.equal(callingAllowance(snapshot({ remaining: 5 })).remaining, '0');
  assert.equal(callingAllowance(snapshot({ used: 1790, remaining: 1800 })).remaining, '0.1');
  const exhausted = callingAllowance(snapshot({ used: 1900, remaining: 0 }));
  assert.equal(exhausted.remaining, '0');
  assert.equal(exhausted.exhausted, true);
});

test('invalid counters cannot render an available allowance; unlimited is explicit', () => {
  for (const value of [-1, '1800', NaN, Infinity, undefined]) {
    for (const key of ['limit', 'remaining', 'used']) {
      const data = snapshot();
      data.usage.hostedParticipantSeconds[key] = value;
      assert.equal(callingAllowance(data), null);
    }
  }
  assert.equal(callingAllowance(null), null);
  assert.equal(callingAllowance(snapshot({ limit: null, remaining: null })).unlimited, true);
  assert.equal(callingAllowance(snapshot({ resetAt: 'bad' })).resetLabel, null);
});

// Run real route bodies with deterministic HTTP/Prisma boundaries, without a DB,
// credentials, Twilio network calls, or starting the production allowance monitor.
async function routeHarness(file, overrides = {}) {
  const routes = new Map();
  const router = { use() {} };
  for (const method of ['get', 'post', 'patch', 'delete']) {
    router[method] = (path, ...handlers) => routes.set(`${method} ${path}`, handlers.at(-1));
  }
  const writes = [];
  const prisma = {
    call: { findUnique: async () => ({ id: 9, callerId: 1, calleeId: 2 }),
      findFirst: async () => ({ id: 9, callerId: 1, calleeId: 2 }),
      updateMany: async value => { writes.push(value); return { count: 1 }; } },
    callParticipant: { findUnique: async () => ({ userId: 2 }),
      updateMany: async value => { writes.push(value); return { count: 2 }; },
      update: async value => { writes.push(value); return value; } },
    user: { findUnique: async () => ({ plan: 'FREE' }) },
  };
  const deps = {
    express: { Router: () => router }, asyncHandler: fn => fn,
    requireAuth() {}, startHostedAllowanceMonitor() {}, prisma,
    emitToUser() {}, sendPushToUser: async () => {},
    hostedAllowanceResponse, allowanceResetAt,
    getUsageAvailability: async () => availability,
    getPlanEntitlements: () => PLAN_ENTITLEMENTS.FREE,
    getUsageSummary: async () => ({ monthKey: '2026-10', entitlements: PLAN_ENTITLEMENTS.FREE, usage: {} }),
    premiumConfig: { tones: {}, themes: {} }, requirePremium() {},
    ...overrides,
  };
  const code = (await source(file)).replace(/^import\s[\s\S]*?;\s*$/gm, '').replace(/export default router;/, '');
  vm.runInNewContext(code, { ...deps, console, Date, Intl, process: { env: {} } });
  async function request(key, { userId = 2, body = {}, params = {} } = {}) {
    const res = { statusCode: 200, body: null,
      status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
    await routes.get(key)({ user: { id: userId }, body, params }, res);
    return res;
  }
  return { request, prisma, writes };
}

test('answer route rejects exhausted caller before answer claims or participant writes', async () => {
  const h = await routeHarness('server/routes/calls.js');
  const res = await h.request('post /answer', { body: { callId: 9 } });
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.allowanceOwner, 'caller');
  assert.equal(res.body.resetAt, '2026-11-01T00:00:00.000Z');
  assert.equal(h.writes.length, 0);
});

test('answer route still rejects a non-callee before disclosing caller allowance', async () => {
  const h = await routeHarness('server/routes/calls.js');
  const res = await h.request('post /answer', { userId: 3, body: { callId: 9 } });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'ONLY_CALLEE_CAN_ANSWER');
  assert.equal(res.body.limit, undefined);
});

test('extra participant answer returns same structured exhaustion without joining', async () => {
  const h = await routeHarness('server/routes/calls.js');
  const res = await h.request('post /:id/answer-participant', { body: { answer: { sdp: 'qa' } }, params: { id: '9' } });
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.code, 'PLAN_ALLOWANCE_EXCEEDED');
  assert.equal(h.writes.length, 0);
});

test('video token distinguishes host allowance from recipient allowance', async () => {
  const h = await routeHarness('server/routes/videoTokens.js');
  for (const userId of [1, 2]) {
    const res = await h.request('post /video/token', { userId, body: { room: 'call_9' } });
    assert.equal(res.statusCode, 429);
    assert.equal(res.body.allowanceOwner, userId === 1 ? 'self' : 'caller');
    assert.equal(res.body.resetAt, '2026-11-01T00:00:00.000Z');
  }
});

test('video token retains room authorization before allowance disclosure', async () => {
  const h = await routeHarness('server/routes/videoTokens.js');
  h.prisma.call.findFirst = async () => null;
  const res = await h.request('post /video/token', { userId: 3, body: { room: 'call_9' } });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.limit, undefined);
});

test('available allowance still reaches normal answer claim and participant join', async () => {
  const h = await routeHarness('server/routes/calls.js', {
    getUsageAvailability: async () => ({ ...availability, used: 0, remaining: 1800 }),
    claimCallActive: async () => ({ won: true, call: {
      id: 9, callerId: 1, calleeId: 2, mode: 'VIDEO', status: 'ACTIVE',
      startedAt: new Date('2026-10-19T15:00:00Z'),
    } }),
  });
  const res = await h.request('post /answer', { body: { callId: 9 } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.status, 'ACTIVE');
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].data.status, 'JOINED');
});

test('available allowance does not change lost-answer arbitration', async () => {
  const h = await routeHarness('server/routes/calls.js', {
    getUsageAvailability: async () => ({ ...availability, used: 0, remaining: 1800 }),
    claimCallActive: async () => ({ won: false, call: { status: 'ACTIVE' } }),
  });
  const res = await h.request('post /answer', { body: { callId: 9 } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'CALL_ANSWERED_ELSEWHERE');
  assert.equal(h.writes.length, 0);
});

test('entitlements route returns reset alongside original plan and usage response', async () => {
  const h = await routeHarness('server/routes/premium.js');
  const res = await h.request('get /entitlements');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.plan, 'FREE');
  assert.equal(res.body.monthKey, '2026-10');
  assert.equal(res.body.resetAt, '2026-11-01T00:00:00.000Z');
  assert.equal(res.body.entitlements.hostedParticipantMinutes, 30);
  assert.ok(res.body.usage);
});

test('all current tier limits stay unchanged', () => {
  assert.equal(PLAN_ENTITLEMENTS.FREE.hostedParticipantMinutes, 30);
  assert.equal(PLAN_ENTITLEMENTS.PLUS.hostedParticipantMinutes, 500);
  assert.equal(PLAN_ENTITLEMENTS.PREMIUM.hostedParticipantMinutes, 1000);
});
