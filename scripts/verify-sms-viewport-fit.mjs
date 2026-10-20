import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../client/src/pages/SmsLayout.jsx', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../client/src/AppRoutes.jsx', import.meta.url), 'utf8');
const scrollBody = source.split('const scrollToBottom = useCallback(() => {')[1].split('  }, []);')[0];
const resizeBody = source.split('// Attachments and composer previews can resize')[1]
  .split('useLayoutEffect(() => {')[1].split('  }, [thread?.id, loadedScope]);')[0];
function harness({ available = true, mounted = true } = {}) {
  const content = {};
  const viewport = { scrollTop: 0, scrollHeight: 1200, clientHeight: 300, firstElementChild: content };
  let pending, disconnected = false, observerCallback;
  const observed = [];
  const context = {
    scrollViewportRef: { current: mounted ? viewport : null },
    followBottomRef: { current: true },
    requestAnimationFrame(callback) { pending = callback; return 1; },
    cancelAnimationFrame() { pending = null; },
    ResizeObserver: available ? class {
      constructor(callback) { observerCallback = callback; }
      observe(node) { observed.push(node); }
      disconnect() { disconnected = true; }
    } : undefined,
  };
  return {
    viewport, context, content, observed,
    scroll: () => vm.runInNewContext(`(() => {${scrollBody}})()`, context),
    resize: () => vm.runInNewContext(`(() => {${resizeBody}})()`, context),
    flush: () => pending?.(),
    notify: () => observerCallback?.(),
    get disconnected() { return disconnected; },
  };
}

test('actual initial scroll callback reaches the bottom after layout', () => {
  const h = harness(); h.scroll(); assert.equal(h.viewport.scrollTop, 0);
  h.flush(); assert.equal(h.viewport.scrollTop, 1200);
});
test('unmount cancels queued initial scrolling', () => {
  const h = harness(); const cleanup = h.scroll(); cleanup(); h.flush();
  assert.equal(h.viewport.scrollTop, 0);
});
test('a missing viewport cannot throw or scroll another surface', () => {
  const h = harness({ mounted: false }); h.scroll(); assert.doesNotThrow(h.flush);
  assert.equal(h.resize(), undefined);
});
test('actual observer tracks viewport and late media dimensions', () => {
  const h = harness(); h.resize();
  assert.deepEqual(h.observed, [h.viewport, h.content]);
  h.viewport.scrollHeight = 1800; h.notify();
  assert.equal(h.viewport.scrollTop, 1800);
});
test('composer resize follows the bottom without a fixed delay', () => {
  const h = harness(); h.resize(); h.viewport.clientHeight = 150; h.notify();
  assert.equal(h.viewport.scrollTop, h.viewport.scrollHeight);
  assert.ok(!scrollBody.includes('setTimeout'));
});
test('reading earlier messages prevents observer scroll jumps', () => {
  const h = harness(); h.resize(); h.context.followBottomRef.current = false;
  h.viewport.scrollTop = 200; h.viewport.scrollHeight = 2400; h.notify();
  assert.equal(h.viewport.scrollTop, 200);
});
test('changing thread releases its resize observer', () => {
  const h = harness(); const cleanup = h.resize(); cleanup(); assert.ok(h.disconnected);
});
test('browsers without ResizeObserver retain normal initial scroll', () => {
  const h = harness({ available: false }); assert.equal(h.resize(), undefined);
  h.scroll(); h.flush(); assert.equal(h.viewport.scrollTop, 1200);
});
test('route height bound excludes SMS list, compose, and other pages', () => {
  const expression = routes.split('const isSMSThread = Boolean(')[1].split(');')[0];
  for (const [match, expected] of [[null, false], [{params:{threadId:'compose'}}, false], [{params:{threadId:'34'}}, true]]) {
    assert.equal(vm.runInNewContext(`Boolean(${expression})`, {smsThreadMatch: match}), expected);
  }
  assert.ok(routes.includes("height: isSMSThread ? '100dvh' : undefined"));
  assert.ok(routes.includes("overflowY: isSMSThread ? 'hidden' : 'auto'"));
  assert.ok(source.includes("flex: '1 1 0'"));
});
