import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const route = await read('server/routes/a11y.js');
const begin = route.indexOf("router.patch('/users/me/a11y'");
const chunk = route.slice(begin, route.indexOf('// Current STT quota', begin));
const handlerCode = chunk.slice(chunk.indexOf('async (req, res) =>'), chunk.lastIndexOf('});') + 1);
const serializerCode = (await read('server/utils/serializeUser.js'))
  .replace(/^import .*;\n/gm, '').replace('export function serializeUser', 'function serializeUser');
const serialize = vm.runInNewContext(`${serializerCode}; serializeUser`, {
  hasPremiumAccess: () => false, canForwardVoicemailEmail: () => false,
});
const auth = await read('server/routes/auth.js');
const authStart = auth.indexOf('    const userPayload = {', auth.indexOf("  '/me',"));
const authPayloadCode = auth.slice(authStart, auth.indexOf('    let subscriber', authStart));
assert.ok(authStart >= 0 && authPayloadCode.includes('a11yVisualAlerts'));
const clone = (value) => JSON.parse(JSON.stringify(value));
function session(user) {
  return clone(vm.runInNewContext(`${authPayloadCode}; userPayload`, {
    safeUser: user, paid: false, canForwardVoicemailEmail: () => false,
  }));
}
function backend() {
  const saved = { id: 68, plan: 'FREE', a11yVibrate: false, a11yVisualAlerts: true,
    a11yUiFont: 'xl', a11yVoiceNoteSTT: true, a11yCaptionFont: 'sm', a11yCaptionBg: 'transparent' };
  const writes = [];
  let fail = false;
  const handler = vm.runInNewContext(`(${handlerCode})`, {
    console: { error() {} }, hasPremiumAccess: () => false,
    prisma: { user: {
      async findUnique() { return { ...saved }; },
      async update(args) {
        writes.push(clone(args));
        if (fail) throw new Error('Controlled database failure');
        Object.assign(saved, args.data);
        return Object.fromEntries(Object.keys(args.select).map((key) => [key, saved[key]]));
      },
    } },
  });
  return {
    saved, writes, fail() { fail = true; },
    async patch(body) {
      const response = { statusCode: 200, body: null,
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = clone(value); return this; } };
      await handler({ user: { id: 68 }, body }, response);
      return response;
    },
  };
}

for (const enabled of [true, false]) {
  test(`Vibrate ${enabled} saves, is acknowledged, and survives both account response formats`, async () => {
    const qa = backend();
    qa.saved.a11yVibrate = !enabled;
    const response = await qa.patch({ a11yVibrate: enabled, id: 99, userId: 99 });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.user.a11yVibrate, enabled);
    assert.deepEqual(qa.writes[0].where, { id: 68 });
    assert.deepEqual(qa.writes[0].data, { a11yVibrate: enabled });
    assert.equal(serialize(qa.saved).a11yVibrate, enabled);
    assert.equal(session(qa.saved).a11yVibrate, enabled);
    for (const field of ['a11yVisualAlerts', 'a11yUiFont', 'a11yVoiceNoteSTT', 'a11yCaptionFont', 'a11yCaptionBg']) {
      assert.equal(response.body.user[field], qa.saved[field]);
    }
    assert.equal(qa.saved.a11yVisualAlerts, true);
    assert.equal(qa.saved.a11yUiFont, 'xl');
  });
}
for (const invalid of ['false', 'true', 0, 1, null, {}, []]) {
  test(`malformed Vibrate ${JSON.stringify(invalid)} is rejected atomically`, async () => {
    const qa = backend();
    assert.equal((await qa.patch({ a11yVibrate: invalid, a11yVisualAlerts: false })).statusCode, 400);
    assert.equal(qa.writes.length, 0);
    assert.equal(qa.saved.a11yVisualAlerts, true);
  });
}
test('saving another setting leaves an enabled vibration preference intact', async () => {
  const qa = backend(); qa.saved.a11yVibrate = true;
  await qa.patch({ a11yVisualAlerts: false });
  assert.deepEqual(qa.writes[0].data, { a11yVisualAlerts: false });
  assert.equal(session(qa.saved).a11yVibrate, true);
  await qa.patch({ a11yUiFont: 'md' });
  assert.deepEqual(qa.writes[1].data, { a11yUiFont: 'md' });
  assert.equal(serialize(qa.saved).a11yVibrate, true);
});
test('failed write cannot report success or change either preference', async () => {
  const qa = backend(); qa.fail();
  assert.equal((await qa.patch({ a11yVibrate: true })).statusCode, 500);
  assert.equal(qa.saved.a11yVibrate, false);
  assert.equal(qa.saved.a11yVisualAlerts, true);
});
test('combined request cannot bypass Premium live-caption restriction', async () => {
  const qa = backend();
  assert.equal((await qa.patch({ a11yVibrate: true, a11yLiveCaptions: true })).statusCode, 402);
  assert.equal(qa.writes.length, 0);
});
test('missing vibration preference defaults to false in both account formats', () => {
  assert.equal(serialize({ id: 68 }).a11yVibrate, false);
  assert.equal(session({ id: 68 }).a11yVibrate, false);
});
test('schema already contains the vibration field', async () => {
  assert.match(await read('server/prisma/schema.prisma'), /a11yVibrate\s+Boolean\s+@default\(false\)/);
});
