const DB_NAME = 'chatforia';
const STORE = 'room_msgs';

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

const isBlank = (v) =>
  v == null || (typeof v === "string" && v.trim().length === 0);

function mergeMessage(existing, incoming) {
  // server fields win
  const merged = { ...existing, ...incoming };

  // never clobber local decrypted/translated with blank
  if (isBlank(incoming.decryptedContent) && !isBlank(existing.decryptedContent)) {
    merged.decryptedContent = existing.decryptedContent;
  }
  if (isBlank(incoming.translatedForMe) && !isBlank(existing.translatedForMe)) {
    merged.translatedForMe = existing.translatedForMe;
  }

  return merged;
}

export async function addMessages(roomId, msgs) {
  const os = await _getConn('readwrite');
  const key = String(roomId);

  const existing = await getRoomMessages(roomId);

  const map = new Map();
  for (const m of existing || []) {
    if (!m) continue;
    if (m.id != null) map.set(`id:${m.id}`, m);
    if (m.clientMessageId) map.set(`cid:${m.clientMessageId}`, m);
  }

  for (const incoming of msgs || []) {
    if (!incoming) continue;

    const byId = incoming.id != null ? map.get(`id:${incoming.id}`) : null;
    const byCid = incoming.clientMessageId ? map.get(`cid:${incoming.clientMessageId}`) : null;

    const prev = byId || byCid;
    const merged = prev ? mergeMessage(prev, incoming) : incoming;

    if (incoming.id != null) map.set(`id:${incoming.id}`, merged);
    if (incoming.clientMessageId) map.set(`cid:${incoming.clientMessageId}`, merged);
  }

  const unique = Array.from(new Set(map.values()));
  unique.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return new Promise((resolve, reject) => {
    const req = os.put({ key, messages: unique });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getRoomMessages(roomId) {
  const os = await _getConn('readonly');
  const key = String(roomId);
  return new Promise((resolve) => {
    const req = os.get(key);
    req.onsuccess = () => resolve(req.result?.messages || []);
    req.onerror = () => resolve([]); // fail-soft
  });
}

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
 * Return normalized media entries from a room for gallery views.
 * Each item: { id?, kind: 'IMAGE'|'VIDEO'|'AUDIO', url, mimeType?, caption?, width?, height?, durationSec?, messageId? }
 * Sources:
 *  - Modern: message.attachments[]
 *  - Legacy:  message.imageUrl, message.audioUrl (+ audioDurationSec)
 */
export async function getMediaInRoom(roomId) {
  const all = await getRoomMessages(roomId);
  const out = [];

  const MEDIA_KINDS = new Set(['IMAGE', 'VIDEO', 'AUDIO']);

  for (const m of all) {
    const messageId = m.id;

    // 1) Modern attachments
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

    // 2) Legacy fallbacks (keep so older rows still display in gallery)
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

  // Return newest first (MediaGalleryModal expects reverse chronological)
  return out.sort((a, b) => (b.messageId ?? 0) - (a.messageId ?? 0));
}
