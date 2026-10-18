import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const helper = await read('client/src/utils/interfaceFont.js');
const { applyInterfaceFont } = await import(`data:text/javascript;base64,${Buffer.from(helper).toString('base64')}`);
const page = await read('client/src/pages/SettingsAccessibility.jsx');
const saveCode = page.slice(page.indexOf('  async function savePref('), page.indexOf('  // If we truly'));
const projectCode = page.slice(page.indexOf('function projectPrefs('), page.indexOf('function readableAxiosError('));
const clone = (value) => JSON.parse(JSON.stringify(value));
const makeRoot = () => ({ style: {}, attrs: {}, setAttribute(key, value) { this.attrs[key] = value; } });

function harness(initial = { id: 68, a11yUiFont: 'md', a11yCaptionFont: 'sm', publicKey: 'keep-key' }) {
  const dom = makeRoot();
  const state = { user: clone(initial), prefs: clone(initial), errors: {}, calls: [], saving: false };
  const update = (key) => (value) => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  const context = {
    currentUser: state.user, currentUserRef: { current: state.user },
    savingRef: { current: false }, mountedRef: { current: true },
    setFieldErrors: update('errors'), setPrefs: update('prefs'), setUser: () => {},
    setSaving: update('saving'),
    setCurrentUser(updateUser) {
      state.user = updateUser(state.user);
      context.currentUser = state.user;
      context.currentUserRef.current = state.user;
      applyInterfaceFont(state.user.a11yUiFont, dom);
    },
    applyInterfaceFont: (value) => applyInterfaceFont(value, dom),
    readableAxiosError: (error) => error.message, t: (_key, fallback) => fallback,
    A11Y_PATH: '/users/me/a11y',
    axiosClient: { async patch(path, body) {
      state.calls.push({ path, body: clone(body) });
      return context.respond(body);
    } },
    respond: async (body) => ({ data: { user: { id: initial.id, ...body } } }),
  };
  vm.createContext(context);
  vm.runInContext(projectCode, context);
  const save = vm.runInContext(`(${saveCode.trim()})`, context);
  return { state, context, dom, save };
}

for (const [size, expected] of Object.entries({ sm: '87.5%', md: '100%', lg: '112.5%', xl: '125%' })) {
  test(`${size} applies a browser-relative root font size`, () => {
    const dom = makeRoot();
    assert.equal(applyInterfaceFont(size, dom), size);
    assert.equal(dom.style.fontSize, expected);
    assert.equal(dom.attrs['data-a11y-ui-font'], size);
  });
}
test('invalid or missing preferences safely use Medium', () => {
  for (const value of [undefined, null, 'enormous', '__proto__']) {
    const dom = makeRoot();
    assert.equal(applyInterfaceFont(value, dom), 'md');
    assert.equal(dom.style.fontSize, '100%');
  }
});
test('actual save handler previews immediately and updates shared state', async () => {
  const qa = harness();
  const pending = qa.save('a11yUiFont', 'xl');
  assert.equal(qa.dom.style.fontSize, '125%');
  await pending;
  assert.equal(qa.state.user.a11yUiFont, 'xl');
  assert.deepEqual(qa.state.calls, [{ path: '/users/me/a11y', body: { a11yUiFont: 'xl' } }]);
  assert.equal(qa.state.user.publicKey, 'keep-key');
  assert.equal(qa.state.user.a11yCaptionFont, 'sm');
});
test('profile state replacement and remount retain the acknowledged size', async () => {
  const qa = harness();
  await qa.save('a11yUiFont', 'xl');
  const profileSaved = { ...qa.state.user, username: 'papi' };
  const remount = harness(clone(profileSaved));
  applyInterfaceFont(remount.state.user.a11yUiFont, remount.dom);
  assert.equal(remount.state.prefs.a11yUiFont, 'xl');
  assert.equal(remount.dom.style.fontSize, '125%');
});
test('failed request rolls back selection and actual font preview', async () => {
  const qa = harness();
  qa.context.respond = async () => { throw new Error('Not allowed'); };
  await qa.save('a11yUiFont', 'xl');
  assert.equal(qa.state.prefs.a11yUiFont, 'md');
  assert.equal(qa.state.user.a11yUiFont, 'md');
  assert.equal(qa.dom.style.fontSize, '100%');
  assert.equal(qa.state.errors.a11yUiFont, 'Not allowed');
});
test('a missing acknowledgement cannot falsely commit a preference', async () => {
  const qa = harness();
  qa.context.respond = async () => ({ data: { user: { id: 68 } } });
  await qa.save('a11yUiFont', 'xl');
  assert.equal(qa.state.user.a11yUiFont, 'md');
  assert.match(qa.state.errors.a11yUiFont, /did not confirm/);
});
test('full server responses cannot overwrite unrelated account fields', async () => {
  const qa = harness();
  qa.context.respond = async () => ({ data: { user: { id: 68, a11yUiFont: 'xl', a11yCaptionFont: 'lg', publicKey: 'stale-key', plan: 'PREMIUM' } } });
  await qa.save('a11yUiFont', 'xl');
  assert.equal(qa.state.user.publicKey, 'keep-key');
  assert.equal(qa.state.user.a11yCaptionFont, 'sm');
  assert.equal(qa.state.user.plan, undefined);
});
test('overlapping input cannot send out-of-order preference writes', async () => {
  const qa = harness();
  let finish;
  qa.context.respond = () => new Promise((resolve) => { finish = resolve; });
  const first = qa.save('a11yUiFont', 'xl');
  await qa.save('a11yUiFont', 'lg');
  assert.equal(qa.state.calls.length, 1);
  finish({ data: { user: { id: 68, a11yUiFont: 'xl' } } });
  await first;
  assert.equal(qa.state.user.a11yUiFont, 'xl');
  assert.equal(qa.state.saving, false);
});
test('late response from previous account cannot alter another account or its font', async () => {
  const qa = harness();
  let finish;
  qa.context.respond = () => new Promise((resolve) => { finish = resolve; });
  const pending = qa.save('a11yUiFont', 'xl');
  qa.state.user = { id: 65, a11yUiFont: 'sm' };
  qa.context.currentUserRef.current = qa.state.user;
  applyInterfaceFont('sm', qa.dom);
  finish({ data: { user: { id: 68, a11yUiFont: 'xl' } } });
  await pending;
  assert.equal(qa.state.user.id, 65);
  assert.equal(qa.dom.style.fontSize, '87.5%');
});
test('existing backend handler saves Extra Large for the authenticated user only', async () => {
  const route = await read('server/routes/a11y.js');
  const begin = route.indexOf("router.patch('/users/me/a11y'");
  const end = route.indexOf('// Current STT quota', begin);
  const chunk = route.slice(begin, end);
  const handlerCode = chunk.slice(chunk.indexOf('async (req, res) =>'), chunk.lastIndexOf('});') + 1);
  let write;
  const handler = vm.runInNewContext(`(${handlerCode})`, {
    prisma: { user: { async update(args) { write = clone(args); return { id: 68, ...args.data }; } } },
    console,
  });
  let result;
  await handler({ user: { id: 68 }, body: { a11yUiFont: 'xl', id: 65 } }, { json: (value) => { result = clone(value); } });
  assert.deepEqual(write.where, { id: 68 });
  assert.deepEqual(write.data, { a11yUiFont: 'xl' });
  assert.equal(result.user.a11yUiFont, 'xl');
});
test('font is restored at session level and fixed body pixels no longer block scaling', async () => {
  const provider = await read('client/src/context/UserContext.jsx');
  assert.match(provider, /applyInterfaceFont\(currentUser\?\.a11yUiFont\)/);
  assert.match(provider, /\[currentUser\?\.id, currentUser\?\.a11yUiFont\]/);
  const css = await read('client/src/styles.css');
  assert.match(css, /html\[data-a11y-ui-font\] body\s*\{\s*font-size:\s*1rem/);
});
