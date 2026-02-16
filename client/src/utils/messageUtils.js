// Canonical client-side merging utilities for Sprint 7.
// Deterministic ordering: createdAt DESC, id DESC (tie-breaker).
// Exports pure functions so they are easy to unit test.

export function normalizeMessage(m) {
  if (!m) return null;
  return {
    ...m,
    // Normalize createdAt to ISO string so sorting is deterministic.
    createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : new Date().toISOString(),
    // Ensure id is numeric when possible (but keep original if not)
    id: m.id != null && !Number.isNaN(Number(m.id)) ? Number(m.id) : m.id,
    // Keep clientMessageId as-is (string) if present
    clientMessageId: m.clientMessageId ? String(m.clientMessageId) : null,
  };
}

// Merge incoming page of messages into existing in-memory lists.
// existingMap: Map keyed by id (if available) or `cid:<clientMessageId>` for local-only messages.
// existingOrder: Array of ids (newest -> oldest). If you store order differently, adapt.
// incoming: array of message objects (any order).
// mergeFn: optional custom merge function (existing, incoming) => merged
export function mergePageIntoState(existingByIdMap, existingOrderArr, incoming = [], mergeFn = null) {
  // Copy existing structures (immutability-friendly)
  const byId = new Map(existingByIdMap instanceof Map ? existingByIdMap : new Map());
  const orderSet = new Set(existingOrderArr || []);

  // Normalise incoming set
  const normalized = (incoming || []).map(normalizeMessage).filter(Boolean);

  // Helper to key messages in byId map
  const keyFor = (m) => {
    if (m == null) return null;
    if (m.id != null) return `id:${m.id}`;
    if (m.clientMessageId) return `cid:${m.clientMessageId}`;
    return null;
  };

  // Upsert incoming into byId
  for (const inc of normalized) {
    const key = keyFor(inc);
    if (!key) continue;

    const prev = byId.get(key) || null;
    let merged;
    if (prev) {
      // default merge: shallow merge, server wins for non-empty fields
      if (typeof mergeFn === 'function') {
        merged = mergeFn(prev, inc);
      } else {
        merged = { ...prev, ...inc };

        // preserve local decrypted/translated if incoming blank (same as old logic)
        const isBlank = (v) => v == null || (typeof v === 'string' && v.trim() === '');
        if (isBlank(inc.decryptedContent) && !isBlank(prev.decryptedContent)) {
          merged.decryptedContent = prev.decryptedContent;
        }
        if (isBlank(inc.translatedForMe) && !isBlank(prev.translatedForMe)) {
          merged.translatedForMe = prev.translatedForMe;
        }
      }
    } else {
      merged = inc;
    }

    // Put merged value into all relevant keys
    if (merged.id != null) {
      byId.set(`id:${merged.id}`, merged);
    }
    if (merged.clientMessageId) {
      byId.set(`cid:${merged.clientMessageId}`, merged);
    }
  }

  // Build canonical id set (unique message objects)
  // We will dedupe by message.id when present, otherwise by clientMessageId.
  const uniqueObjs = new Map(); // key -> message object where key is canonical id or cid
  for (const [mapKey, msg] of byId.entries()) {
    if (!msg) continue;
    if (msg.id != null && Number.isFinite(Number(msg.id))) {
      uniqueObjs.set(`id:${Number(msg.id)}`, msg);
    } else if (msg.clientMessageId) {
      uniqueObjs.set(`cid:${msg.clientMessageId}`, msg);
    } else {
      // fallback: use the mapKey
      uniqueObjs.set(mapKey, msg);
    }
  }

  // Create merged order array by sorting unique messages
  const mergedArray = Array.from(uniqueObjs.values());
  mergedArray.sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    if (ta !== tb) return tb - ta; // newest first
    const ai = Number.isNaN(Number(a.id)) ? String(a.id) : Number(a.id);
    const bi = Number.isNaN(Number(b.id)) ? String(b.id) : Number(b.id);
    // If id present and numeric, sort desc; otherwise fallback to string compare
    if (!Number.isNaN(ai) && !Number.isNaN(bi)) return bi - ai;
    return String(bi).localeCompare(String(ai));
  });

  // Build final byId map keyed by canonical `id:<id>` or `cid:<cid>`
  const finalById = new Map();
  const finalOrder = [];
  for (const msg of mergedArray) {
    if (msg.id != null && Number.isFinite(Number(msg.id))) {
      finalById.set(`id:${Number(msg.id)}`, msg);
      finalOrder.push(msg.id);
    } else if (msg.clientMessageId) {
      finalById.set(`cid:${msg.clientMessageId}`, msg);
      finalOrder.push(msg.clientMessageId);
    } else {
      // last resort (shouldn't happen)
      const fallbackKey = `unk:${Math.random().toString(36).slice(2, 9)}`;
      finalById.set(fallbackKey, msg);
      finalOrder.push(fallbackKey);
    }
  }

  return { byId: finalById, order: finalOrder, list: mergedArray };
}

// Upsert a single live message (socket): returns new byId/order/list
export function upsertSingle(existingByIdMap, existingOrderArr, incoming, mergeFn = null) {
  return mergePageIntoState(existingByIdMap, existingOrderArr, [incoming], mergeFn);
}