const DB_NAME = 'chatforia';
const STORE = 'room_msgs';

import { normalizeMessage, mergePageIntoState, upsertSingle } from './messageUtils.js';

let _db;
function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' }); // key: `${roomId}`
      }
    };
    req.onsuccess = () => {
      _db = req.result;
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

async function _getConn(mode = 'readonly') {
  const db = await openDB();
  return db.transaction(STORE, mode).objectStore(STORE);
}

const isBlank = (v) => v == null || (typeof v === 'string' && v.trim().length === 0);

// Internal: read raw persisted entry (returns { messages: [] })
async function _readRaw(roomId) {
  const os = await _getConn('readonly');
  const key = String(roomId);
  return new Promise((resolve) => {
    const req = os.get(key);
    req.onsuccess = () => resolve(req.result || { key, messages: [] });
    req.onerror = () => resolve({ key, messages: [] });
  });
}

// Internal: write raw entry
async function _writeRaw(roomId, payload) {
  const os = await _getConn('readwrite');
  const key = String(roomId);
  return new Promise((resolve, reject) => {
    const req = os.put({ key, messages: payload });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Merge function used to preserve local decrypted/translations when incoming blank
function defaultMerge(existing, incoming) {
  // server fields win, but preserve local decrypted/translated if incoming blank
  const merged = { ...existing, ...incoming };

  if (isBlank(incoming.decryptedContent) && !isBlank(existing.decryptedContent)) {
    merged.decryptedContent = existing.decryptedContent;
  }
  if (isBlank(incoming.translatedForMe) && !isBlank(existing.translatedForMe)) {
    merged.translatedForMe = existing.translatedForMe;
  }

  return merged;
}

/**
 * Merge a page of messages (or array of messages) into the room store.
 * Overlapping pages are tolerated. Ordering is stable: createdAt DESC, id DESC.
 *
 * Example usage:
 *   await addMessages(roomId, page.items);
 */
export async function addMessages(roomId, msgs) {
  const raw = await _readRaw(roomId);
  const existing = raw.messages || [];

  // Build existing maps (keyed by id or cid)
  const existingMap = new Map();
  for (const m of existing) {
    if (!m) continue;
    if (m.id != null) existingMap.set(`id:${m.id}`, m);
    if (m.clientMessageId) existingMap.set(`cid:${m.clientMessageId}`, m);
  }

  // Existing order array (ids/cids) for stable merge; we store ids for ordering
  const existingOrder = (existing || []).map((m) => (m.id != null ? m.id : m.clientMessageId));

  // Use mergePageIntoState to combine
  const { list: mergedList } = mergePageIntoState(existingMap, existingOrder, msgs || [], defaultMerge);

  // Persist mergedList (newest-first)
  await _writeRaw(roomId, mergedList);
}

/**
 * Merge two single messages (preserve local decrypted/translations when incoming blank).
 * Reuse same logic as defaultMerge.
 */
function mergeMessage(existing, incoming) {
  return defaultMerge(existing, incoming);
}

/**
 * Upsert a single message (socket delta) — optimized version.
 *
 * This avoids loading/parsing the room from a separate helper and only touches
 * the raw room entry once (single read + conditional write). It still preserves
 * merging semantics and stable ordering (newest-first by createdAt).
 *
 * Returns: { op: 'insert'|'update'|'noop', item: <message> } or undefined on noop/error.
 */
export async function upsertMessage(roomId, msg) {
  if (!roomId || !msg) return;
  const key = String(roomId);
  const os = await _getConn('readwrite');

  // Read the single room entry (messages array) once
  const current = await new Promise((resolve) => {
    const req = os.get(key);
    req.onsuccess = () => resolve(req.result || { key, messages: [] });
    req.onerror = () => resolve({ key, messages: [] });
  });

  const messages = Array.isArray(current.messages) ? current.messages.slice() : [];

  // Find by id or clientMessageId
  const findIndex = (arr, m) => {
    if (!m) return -1;
    const byId = m.id != null;
    const cid = m.clientMessageId;
    for (let i = 0; i < arr.length; i++) {
      const it = arr[i];
      if (!it) continue;
      if (byId && it.id === m.id) return i;
      if (cid && it.clientMessageId && it.clientMessageId === cid) return i;
    }
    return -1;
  };

  const idx = findIndex(messages, msg);
  if (idx === -1) {
    // Insert path
    const normalized = typeof normalizeMessage === 'function' ? normalizeMessage(msg) : msg;
    messages.push(normalized); // push then sort (newest-first)
    messages.sort((a, b) => {
      // stable ordering: createdAt DESC, id DESC as fallback
      const ta = new Date(a.createdAt).getTime() || 0;
      const tb = new Date(b.createdAt).getTime() || 0;
      if (tb !== ta) return tb - ta;
      const ia = a.id != null ? Number(a.id) : 0;
      const ib = b.id != null ? Number(b.id) : 0;
      return ib - ia;
    });

    // persist
    await new Promise((resolve, reject) => {
      const putReq = os.put({ key, messages });
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    });

    return { op: 'insert', item: normalized };
  } else {
    // Update path — merge and replace in-place
    const existing = messages[idx];
    const merged = mergeMessage(existing, msg);

    // If merged is shallow-equal to existing, skip write (optional optimization)
    const shallowEqual = (a, b) => {
      if (a === b) return true;
      const aKeys = Object.keys(a || {});
      const bKeys = Object.keys(b || {});
      if (aKeys.length !== bKeys.length) return false;
      for (const k of aKeys) {
        if (a[k] !== b[k]) return false;
      }
      return true;
    };

    messages[idx] = merged;

    // Ordering might have changed if createdAt updated — re-sort for safety
    messages.sort((a, b) => {
      const ta = new Date(a.createdAt).getTime() || 0;
      const tb = new Date(b.createdAt).getTime() || 0;
      if (tb !== ta) return tb - ta;
      const ia = a.id != null ? Number(a.id) : 0;
      const ib = b.id != null ? Number(b.id) : 0;
      return ib - ia;
    });

    // Persist only if different (optional)
    if (shallowEqual(existing, merged)) {
      return { op: 'noop', item: merged };
    }

    await new Promise((resolve, reject) => {
      const putReq = os.put({ key, messages });
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    });

    return { op: 'update', item: merged };
  }
}

/**
 * Return the room's messages (newest-first).
 */
export async function getRoomMessages(roomId) {
  const raw = await _readRaw(roomId);
  return raw.messages || [];
}

/**
 * Simple full-text search across rawContent and decrypted/translated text.
 */
export async function searchRoom(roomId, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const all = await getRoomMessages(roomId);
  return all.filter((m) => {
    const t1 = (m.decryptedContent || m.translatedForMe || '').toLowerCase();
    const t2 = (m.rawContent || '').toLowerCase();
    return t1.includes(q) || t2.includes(q);
  });
}

/**
 * Media extraction (unchanged logic, slightly refactored)
 */
export async function getMediaInRoom(roomId) {
  const all = await getRoomMessages(roomId);
  const out = [];

  const MEDIA_KINDS = new Set(['IMAGE', 'VIDEO', 'AUDIO']);

  for (const m of all) {
    const messageId = m.id;

    // Modern attachments
    if (Array.isArray(m.attachments)) {
      for (const a of m.attachments) {
        if (!a || !a.url || !a.kind) continue;
        const kind = String(a.kind).toUpperCase();
        if (!MEDIA_KINDS.has(kind)) continue;

        out.push({
          id: a.id ?? `att-${messageId}-${kind}-${a.url}`,
          kind,
          url: a.url,
          mimeType: a.mimeType || undefined,
          width: a.width ?? undefined,
          height: a.height ?? undefined,
          durationSec: a.durationSec ?? undefined,
          caption: a.caption ?? undefined,
          messageId,
        });
      }
    }

    // Legacy fallbacks
    if (m.imageUrl) {
      out.push({
        id: `legacy-img-${messageId}`,
        kind: 'IMAGE',
        url: m.imageUrl,
        mimeType: undefined,
        caption: undefined,
        width: undefined,
        height: undefined,
        durationSec: undefined,
        messageId,
      });
    }

    if (m.audioUrl) {
      out.push({
        id: `legacy-aud-${messageId}`,
        kind: 'AUDIO',
        url: m.audioUrl,
        mimeType: undefined,
        caption: undefined,
        width: undefined,
        height: undefined,
        durationSec: m.audioDurationSec ?? undefined,
        messageId,
      });
    }
  }

  // Newest first by messageId (works for legacy items too)
  return out.sort((a, b) => (b.messageId ?? 0) - (a.messageId ?? 0));
}