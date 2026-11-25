import { useEffect, useMemo } from 'react';

export const NATIVE_THREAD_CACHE_MAX_ROOMS = 12;
export const NATIVE_THREAD_CACHE_MAX_MESSAGES = 50;
export const NATIVE_THREAD_CACHE_MAX_AGE_MS = 60_000;

const confirmed = (message) => Number.isInteger(Number(message?.id)) && Number(message.id) > 0 && !message.optimistic && !message.failed && !message.deletedForMe;
const copyMessages = (messages) => (messages || []).filter(confirmed).slice(-NATIVE_THREAD_CACHE_MAX_MESSAGES).map((message) => ({ ...message }));

export function reconcileLatestMessages(latest, previous = []) {
  const oldById = new Map(previous.map((message) => [String(message.id), message]));
  return latest.filter((message) => !message.deletedForMe).map((message) => {
    const old = oldById.get(String(message.id));
    if (!old || message.deletedForAll || message.deletedForMe ||
        message.revision == null || old.revision !== message.revision ||
        old.editedAt !== message.editedAt ||
        JSON.stringify(old.contentCiphertext ?? null) !== JSON.stringify(message.contentCiphertext ?? null) ||
        JSON.stringify(old.encryptedPayloadForMe ?? null) !== JSON.stringify(message.encryptedPayloadForMe ?? null) ||
        old.encryptedKeyForMe !== message.encryptedKeyForMe) return message;
    return old.decryptedContent ? { ...message, decryptedContent: old.decryptedContent } : message;
  });
}

export function createNativeThreadSessionCache(scope, now = () => Date.now()) {
  const entries = new Map();
  let refreshSequence = 0;
  const validRoomId = (roomId) => Number.isInteger(Number(roomId)) && Number(roomId) > 0;
  const entryFor = (roomId) => entries.get(String(roomId));
  const fresh = (at) => Number.isFinite(at) && now() - at < NATIVE_THREAD_CACHE_MAX_AGE_MS;
  const touch = (roomId, entry) => {
    const key = String(roomId);
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > NATIVE_THREAD_CACHE_MAX_ROOMS) entries.delete(entries.keys().next().value);
  };

  return {
    scope,
    getRoom(roomId) {
      if (!validRoomId(roomId)) return null;
      const entry = entryFor(roomId);
      return entry && fresh(entry.roomAt) ? { ...entry.room } : null;
    },
    getMessages(roomId) {
      if (!validRoomId(roomId)) return null;
      const entry = entryFor(roomId);
      return entry && fresh(entry.roomAt) && fresh(entry.messagesAt)
        ? copyMessages(entry.messages)
        : null;
    },
    remainingRoomMs(roomId) {
      const at = entryFor(roomId)?.roomAt;
      return fresh(at) ? Math.max(0, NATIVE_THREAD_CACHE_MAX_AGE_MS - (now() - at)) : 0;
    },
    remainingMessagesMs(roomId) {
      const at = entryFor(roomId)?.messagesAt;
      return fresh(at) ? Math.max(0, NATIVE_THREAD_CACHE_MAX_AGE_MS - (now() - at)) : 0;
    },
    putRoom(roomId, room) {
      if (!validRoomId(roomId) || Number(room?.id) !== Number(roomId)) return;
      touch(roomId, { ...entryFor(roomId), room: { ...room }, roomAt: now() });
    },
    beginMessageRefresh(roomId) {
      const entry = entryFor(roomId);
      if (!entry?.room) return null;
      const token = ++refreshSequence;
      touch(roomId, { ...entry, messageRequest: token });
      return token;
    },
    isCurrentMessageRefresh(roomId, token) {
      return token != null && entryFor(roomId)?.messageRequest === token;
    },
    putMessages(roomId, messages, token = null) {
      if (!validRoomId(roomId) || !entryFor(roomId)?.room) return;
      if (token != null && entryFor(roomId).messageRequest !== token) return;
      touch(roomId, { ...entryFor(roomId), messages: copyMessages(messages), messagesAt: now() });
    },
    updateMessages(roomId, messages) {
      const entry = entryFor(roomId);
      if (!entry || !fresh(entry.messagesAt)) return;
      touch(roomId, { ...entry, messages: copyMessages(messages) });
    },
    delete(roomId) { entries.delete(String(roomId)); },
    clear() { entries.clear(); },
    size() { return entries.size; },
  };
}

export function nativeThreadCacheScope(user, keyMeta, needsKeyUnlock) {
  if (needsKeyUnlock || !user?.id || !user?.publicKey ||
      !keyMeta?.publicKey || user.publicKey !== keyMeta.publicKey) return null;
  return JSON.stringify([
    user.id, user.publicKey, keyMeta.publicKey,
    keyMeta.version ?? null, keyMeta.createdAt ?? null, Boolean(keyMeta.hasEncrypted),
  ]);
}

export function useNativeThreadSessionCache(user, keyMeta, needsKeyUnlock) {
  const scope = nativeThreadCacheScope(user, keyMeta, needsKeyUnlock);
  const cache = useMemo(() => scope ? createNativeThreadSessionCache(scope) : null, [scope]);
  useEffect(() => () => cache?.clear(), [cache]);
  return cache;
}
