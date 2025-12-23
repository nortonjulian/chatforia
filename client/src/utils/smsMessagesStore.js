const DB_NAME = 'chatforia_sms_db';
const DB_VERSION = 1;

const STORE_MESSAGES = 'sms_messages';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
        const store = db.createObjectStore(STORE_MESSAGES, { keyPath: 'key' });
        store.createIndex('threadId', 'threadId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode = 'readonly') {
  return db.transaction([STORE_MESSAGES], mode).objectStore(STORE_MESSAGES);
}

function normalizeSmsMessage(threadId, m) {
  const createdAt = m.createdAt || m.sentAt || m.created_at || new Date().toISOString();
  return {
    key: `${threadId}:${m.id}`,
    threadId: String(threadId),
    id: m.id,
    direction: m.direction,
    body: String(m.body || ''),
    createdAt,
    // media fields (best effort)
    mediaUrls: Array.isArray(m.mediaUrls) ? m.mediaUrls : [],
    attachmentsInline: Array.isArray(m.attachmentsInline) ? m.attachmentsInline : [],
  };
}

export async function addSmsMessages(threadId, messages) {
  if (!threadId) return;
  const db = await openDb();
  const store = tx(db, 'readwrite');

  await Promise.all(
    (messages || []).map(
      (m) =>
        new Promise((resolve, reject) => {
          const row = normalizeSmsMessage(String(threadId), m);
          const req = store.put(row);
          req.onsuccess = () => resolve(true);
          req.onerror = () => reject(req.error);
        })
    )
  );

  db.close();
}

export async function searchSmsMessages(threadId, query, limit = 50) {
  const q = String(query || '').trim().toLowerCase();
  if (!threadId || !q) return [];

  const db = await openDb();
  const store = tx(db, 'readonly');
  const index = store.index('threadId');

  const results = [];

  await new Promise((resolve, reject) => {
    const req = index.openCursor(IDBKeyRange.only(String(threadId)));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve();

      const row = cursor.value;
      if ((row.body || '').toLowerCase().includes(q)) {
        results.push(row);
      }

      if (results.length >= limit) return resolve();
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });

  db.close();

  // sort newest first
  results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return results;
}

// For the gallery modal: return items already cached for this thread.
// NOTE: this returns cached data only (fast). Since SmsLayout caches on loadThread(), it stays fresh.
export function getSmsMediaItems(threadId) {
  // This function returns a promise-like list in the modal via useMemo,
  // so we expose a sync fallback as empty and let the modal handle "loading" if you want.
  // To keep it simple, we provide a sync "best effort" as empty and you can switch to async later.
  // If you want async now, I can change SmsLayout to await it before opening gallery.
  // For now: keep as empty; modal will still show "No media yet" unless you switch to async.

  // ✅ If you want it async now, use getSmsMediaItemsAsync below.
  return [];
}

export async function getSmsMediaItemsAsync(threadId, limit = 250) {
  if (!threadId) return [];

  const db = await openDb();
  const store = tx(db, 'readonly');
  const index = store.index('threadId');

  const rows = [];

  await new Promise((resolve, reject) => {
    const req = index.openCursor(IDBKeyRange.only(String(threadId)));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve();
      rows.push(cursor.value);
      if (rows.length >= limit) return resolve();
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });

  db.close();

  const items = [];
  for (const r of rows) {
    // 1) direct mediaUrls
    if (Array.isArray(r.mediaUrls) && r.mediaUrls.length) {
      for (const url of r.mediaUrls) {
        items.push({
          id: `${r.id}:${url}`,
          url,
          mimeType: guessMimeFromUrl(url),
          createdAt: r.createdAt,
          messageId: r.id,
        });
      }
    }

    // 2) attachmentsInline (if you store them on sms messages)
    if (Array.isArray(r.attachmentsInline) && r.attachmentsInline.length) {
      for (const a of r.attachmentsInline) {
        if (!a?.url) continue;
        items.push({
          id: `${r.id}:${a.url}`,
          url: a.url,
          mimeType: a.mimeType || guessMimeFromUrl(a.url),
          createdAt: r.createdAt,
          messageId: r.id,
        });
      }
    }
  }

  // newest first
  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return items;
}

function guessMimeFromUrl(url) {
  const u = String(url || '').toLowerCase();
  if (u.match(/\.(png|jpg|jpeg|gif|webp)$/)) return 'image/*';
  if (u.match(/\.(mp4|mov|webm)$/)) return 'video/*';
  if (u.match(/\.(mp3|wav|m4a|aac|ogg)$/)) return 'audio/*';
  return 'application/octet-stream';
}
