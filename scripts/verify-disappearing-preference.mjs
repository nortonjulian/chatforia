import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const users = await read('server/routes/users.js');
const begin = users.indexOf("router.patch('/me',");
const chunk = users.slice(begin, users.indexOf('/* ---------------------- DELETE /users/me', begin));
assert.ok(begin >= 0 && chunk.includes('prisma.user.update'));
const patchCode = chunk.slice(chunk.indexOf('async (req, res) =>'), chunk.lastIndexOf('});') + 1);
const serializerCode = (await read('server/utils/serializeUser.js'))
  .replace(/^import .*;\n/gm, '').replace('export function serializeUser', 'function serializeUser');
const serializeUser = vm.runInNewContext(`${serializerCode}; serializeUser`, {
  hasPremiumAccess: () => false, canForwardVoicemailEmail: () => false,
});
const auth = await read('server/routes/auth.js');
const authStart = auth.indexOf("router.get(\n  '/me',");
assert.ok(authStart >= 0);
const authCode = auth.slice(authStart, auth.indexOf('\nexport {', authStart));
const clone = (value) => JSON.parse(JSON.stringify(value));
const response = () => ({ statusCode: 200, body: null, headers: {},
  status(code) { this.statusCode = code; return this; },
  set(key, value) { this.headers[key] = value; return this; },
  json(body) { this.body = clone(body); return this; },
});

function backend() {
  const accounts = new Map([[7, { id: 7, plan: 'FREE', autoDeleteSeconds: 0,
    showReadReceipts: true, autoTranslate: true, theme: 'dawn', a11yVibrate: true }],
    [8, { id: 8, plan: 'PREMIUM', autoDeleteSeconds: 60 }]]);
  const writes = []; let fail = false, getHandler;
  const prisma = { user: {
    async update(args) {
      writes.push(clone(args));
      if (fail) throw new Error('controlled DB failure');
      const saved = accounts.get(args.where.id);
      Object.assign(saved, args.data);
      return Object.fromEntries(Object.keys(args.select).map((key) => [key, saved[key]]));
    },
    async findUnique({ where }) { return accounts.get(where.id) ?? null; },
  }, subscriber: { async findFirst() { return null; } } };
  const context = { prisma, serializeUser, console: { error() {}, warn() {} },
    hasPremiumAccess: () => false, canForwardVoicemailEmail: () => false,
    sanitizeEntitledSettings: (user) => ({ ...user }),
    requireAuth() {}, asyncHandler: (handler) => handler,
    router: { get(_path, _auth, handler) { getHandler = handler; } },
  };
  const patch = vm.runInNewContext(`(${patchCode})`, context);
  vm.runInNewContext(authCode, context);
  return { accounts, writes, fail() { fail = true; },
    async patch(body, userId = 7) {
      const res = response(); await patch({ body, user: userId ? { id: userId } : null }, res); return res;
    },
    async session(userId = 7) {
      const res = response(); await getHandler({ user: { id: userId } }, res); return res;
    },
  };
}

for (const seconds of [0, 1, 10, 60, 86400, 604800, 2592000]) {
  test(`${seconds} seconds saves and survives fresh account reloads for the shared client contract`, async () => {
    const h = backend();
    const res = await h.patch({ autoDeleteSeconds: seconds, id: 8, userId: 8 });
    assert.equal(res.statusCode, 200); assert.equal(res.body.autoDeleteSeconds, seconds);
    assert.deepEqual(h.writes[0].data, { autoDeleteSeconds: seconds });
    assert.deepEqual(h.writes[0].where, { id: 7 });
    for (let i = 0; i < 2; i++) {
      const fresh = await h.session();
      assert.equal(fresh.body.user.autoDeleteSeconds, seconds);
      assert.equal(fresh.headers['Cache-Control'], 'no-store');
    }
    assert.equal(h.accounts.get(8).autoDeleteSeconds, 60);
  });
}
test('OFF saves as numeric zero for native and website responses', async () => {
  const h = backend(); await h.patch({ autoDeleteSeconds: 10 }); await h.patch({ autoDeleteSeconds: 0 });
  assert.equal(h.accounts.get(7).autoDeleteSeconds, 0);
  assert.equal((await h.session()).body.user.autoDeleteSeconds, 0);
});
test('legacy nullable preference is accepted as OFF without returning null', async () => {
  const h = backend(); const res = await h.patch({ autoDeleteSeconds: null });
  assert.equal(res.statusCode, 200); assert.equal(res.body.autoDeleteSeconds, 0);
  assert.equal((await h.session()).body.user.autoDeleteSeconds, 0);
});
for (const value of [-1, 1.5, '10', '0', '', true, false, {}, [], 2147483648, Number.MAX_SAFE_INTEGER]) {
  test(`invalid timer ${JSON.stringify(value)} rejects the entire write`, async () => {
    const h = backend(); const res = await h.patch({ autoDeleteSeconds: value, showReadReceipts: false });
    assert.equal(res.statusCode, 400); assert.equal(res.body.error, 'Invalid autoDeleteSeconds');
    assert.equal(h.writes.length, 0); assert.equal(h.accounts.get(7).showReadReceipts, true);
  });
}
test('saving another setting leaves the timer intact and acknowledges it', async () => {
  const h = backend(); await h.patch({ autoDeleteSeconds: 10 });
  const res = await h.patch({ showReadReceipts: false });
  assert.deepEqual(h.writes[1].data, { showReadReceipts: false });
  assert.equal(res.body.autoDeleteSeconds, 10);
  assert.equal((await h.session()).body.user.autoDeleteSeconds, 10);
  assert.equal(h.accounts.get(7).a11yVibrate, true);
});
test('combined settings save acknowledges the timer without changing other saved values', async () => {
  const h = backend(); const res = await h.patch({ autoDeleteSeconds: 10, autoTranslate: false, showReadReceipts: false });
  assert.equal(res.body.autoDeleteSeconds, 10);
  assert.equal(res.body.autoTranslate, false); assert.equal(res.body.showReadReceipts, false);
});
test('failed database write cannot report success or alter preference', async () => {
  const h = backend(); h.fail(); const res = await h.patch({ autoDeleteSeconds: 10 });
  assert.equal(res.statusCode, 500); assert.equal(h.accounts.get(7).autoDeleteSeconds, 0);
});
test('missing authentication cannot update any account', async () => {
  const h = backend(); assert.equal((await h.patch({ autoDeleteSeconds: 10 }, null)).statusCode, 403);
  assert.equal(h.writes.length, 0);
});
test('null or absent stored preference reloads as OFF in both response shapes', async () => {
  const h = backend();
  for (const value of [null, undefined]) {
    h.accounts.get(7).autoDeleteSeconds = value;
    assert.equal((await h.session()).body.user.autoDeleteSeconds, 0);
    assert.equal(serializeUser(h.accounts.get(7)).autoDeleteSeconds, 0);
  }
});
test('schema already contains the nullable integer; no migration needed', async () => {
  assert.match(await read('server/prisma/schema.prisma'), /autoDeleteSeconds\s+Int\?/);
});
