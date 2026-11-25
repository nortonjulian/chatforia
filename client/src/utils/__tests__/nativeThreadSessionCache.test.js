import { renderHook } from '@testing-library/react';
import {
  createNativeThreadSessionCache,
  NATIVE_THREAD_CACHE_MAX_AGE_MS,
  NATIVE_THREAD_CACHE_MAX_ROOMS,
  reconcileLatestMessages,
  useNativeThreadSessionCache,
} from '../nativeThreadSessionCache';

const room = (id) => ({ id, name: `Room ${id}`, participants: [{ userId: 1 }] });
const message = (id, extra = {}) => ({
  id, revision: 1, createdAt: `2026-11-22T00:00:${String(id).padStart(2, '0')}.000Z`,
  contentCiphertext: `cipher-${id}`, encryptedKeyForMe: `key-${id}`,
  ...extra,
});

test('bounded cache expires room and messages, including while offline', () => {
  let now = 0;
  const cache = createNativeThreadSessionCache('user:key', () => now);
  for (let id = 1; id <= NATIVE_THREAD_CACHE_MAX_ROOMS + 1; id++) {
    cache.putRoom(id, room(id));
    cache.putMessages(id, [message(id)]);
  }
  expect(cache.size()).toBe(NATIVE_THREAD_CACHE_MAX_ROOMS);
  expect(cache.getRoom(1)).toBeNull();
  expect(cache.getMessages(2)).toHaveLength(1);
  now = NATIVE_THREAD_CACHE_MAX_AGE_MS;
  expect(cache.getRoom(2)).toBeNull();
  expect(cache.getMessages(2)).toBeNull();
});

test('realtime updates stay room-local and cannot extend validation lifetime', () => {
  let now = 0;
  const cache = createNativeThreadSessionCache('user:key', () => now);
  cache.putRoom(1, room(1));
  cache.putRoom(2, room(2));
  cache.putMessages(1, [message(1)]);
  cache.putMessages(2, [message(2)]);
  now = 20_000;
  cache.updateMessages(1, [message(1), message(3)]);
  expect(cache.getMessages(1).map((item) => item.id)).toEqual([1, 3]);
  expect(cache.getMessages(2).map((item) => item.id)).toEqual([2]);
  now = NATIVE_THREAD_CACHE_MAX_AGE_MS;
  expect(cache.getMessages(1)).toBeNull();
});

test('only confirmed server messages enter the snapshot', () => {
  const cache = createNativeThreadSessionCache('user:key');
  cache.putRoom(1, room(1));
  cache.putMessages(1, [message(1), { clientMessageId: 'pending', optimistic: true }, message(2, { failed: true })]);
  expect(cache.getMessages(1).map((item) => item.id)).toEqual([1]);
});

test('a late message response cannot replace a newer refresh or a removed room', () => {
  const cache = createNativeThreadSessionCache('user:key');
  cache.putRoom(1, room(1));
  const oldRequest = cache.beginMessageRefresh(1);
  const newRequest = cache.beginMessageRefresh(1);
  cache.putMessages(1, [message(2)], newRequest);
  cache.putMessages(1, [message(1)], oldRequest);
  expect(cache.getMessages(1).map((item) => item.id)).toEqual([2]);
  cache.delete(1);
  cache.putRoom(1, room(1));
  cache.putMessages(1, [message(1)], oldRequest);
  expect(cache.getMessages(1)).toBeNull();
});

test('authoritative refresh removes deletions and preserves plaintext only for identical ciphertext and revision', () => {
  const previous = [
    message(1, { decryptedContent: 'old text', translatedForMe: 'old translation', attachments: [{ id: 1 }] }),
    message(2, { decryptedContent: 'deleted text' }),
    message(3, { decryptedContent: 'edited text' }),
  ];
  const latest = [
    message(1, { translatedForMe: 'new translation', attachments: [{ id: 2 }] }),
    message(2, { deletedForMe: true }),
    message(3, { revision: 2, contentCiphertext: 'new cipher' }),
    message(4, { deletedForAll: true, decryptedContent: null }),
  ];
  const result = reconcileLatestMessages(latest, previous);
  expect(result.map((item) => item.id)).toEqual([1, 3, 4]);
  expect(result[0]).toMatchObject({ decryptedContent: 'old text', translatedForMe: 'new translation', attachments: [{ id: 2 }] });
  expect(result[1].decryptedContent).toBeUndefined();
  expect(result[2].decryptedContent).toBeNull();
});

test('logout, account change, key change, and key lock discard the prior cache', () => {
  const user1 = { id: 1, publicKey: 'key-a' };
  const { result, rerender } = renderHook(
    ({ user, keyMeta, locked }) => useNativeThreadSessionCache(user, keyMeta, locked),
    { initialProps: { user: user1, keyMeta: { publicKey: 'key-a' }, locked: false } }
  );
  const first = result.current;
  first.putRoom(1, room(1));
  rerender({ user: user1, keyMeta: { publicKey: 'key-b' }, locked: false });
  expect(result.current).toBeNull();
  expect(first.size()).toBe(0);

  rerender({ user: { id: 2, publicKey: 'key-b' }, keyMeta: { publicKey: 'key-b' }, locked: false });
  const second = result.current;
  second.putRoom(1, room(1));
  rerender({ user: { id: 2, publicKey: 'key-b' }, keyMeta: { publicKey: 'key-b' }, locked: true });
  expect(second.size()).toBe(0);
  expect(result.current).toBeNull();

  rerender({ user: user1, keyMeta: { publicKey: 'key-a' }, locked: false });
  const third = result.current;
  third.putRoom(1, room(1));
  rerender({ user: user1, keyMeta: { publicKey: 'key-a', version: 'new-bundle' }, locked: false });
  expect(third.size()).toBe(0);
  const fourth = result.current;
  fourth.putRoom(1, room(1));
  rerender({ user: null, keyMeta: null, locked: false });
  expect(fourth.size()).toBe(0);
  expect(result.current).toBeNull();
});
