// Helpers for compound cursors used by message pagination.
// Cursor format: "<createdAt ISO>_<id>", e.g. "2026-02-15T18:22:13.123Z_12345"

export function parseCompoundCursor(cursorStr) {
  if (!cursorStr || typeof cursorStr !== 'string') return { createdAt: null, id: null };
  const idx = cursorStr.lastIndexOf('_');
  if (idx === -1) return { createdAt: null, id: null };
  const ts = cursorStr.slice(0, idx);
  const idPart = cursorStr.slice(idx + 1);
  // Validate timestamp
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return { createdAt: null, id: null };
  return { createdAt: d.toISOString(), id: idPart };
}

export function makeCompoundCursor(item) {
  if (!item) return null;
  // item.createdAt should be ISO string or Date, item.id number/string
  const iso = item.createdAt ? new Date(item.createdAt).toISOString() : new Date().toISOString();
  return `${iso}_${String(item.id)}`;
}