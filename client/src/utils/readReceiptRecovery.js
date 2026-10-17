// Recover only public receipt metadata through the existing message-history API.
// Never replace decrypted text, translation/original caches, edits or attachments.
export function mergeRecoveredReadReceipts(messages, rows, roomId) {
  const recovered = new Map(rows.map((row) => [String(row.id), row]));
  let changed = false;
  const next = messages.map((message) => {
    const row = recovered.get(String(message.id));
    if (!row || message.deletedForAll || message.deletedAt ||
        row.deletedForAll || row.deletedAt ||
        (message.chatRoomId != null && String(message.chatRoomId) !== String(roomId)) ||
        (row.chatRoomId != null && String(row.chatRoomId) !== String(roomId))) return message;
    const readers = [...(Array.isArray(message.readBy) ? message.readBy : [])];
    const known = new Set(readers.map((reader) => String(reader.id)));
    for (const reader of Array.isArray(row.readBy) ? row.readBy : []) {
      const id = Number(reader?.id);
      const senderId = Number(message.senderId ?? message.sender?.id);
      if (!Number.isSafeInteger(id) || id <= 0 || id === senderId || known.has(String(id))) continue;
      readers.push(reader);
      known.add(String(id));
    }
    if (readers.length === (message.readBy?.length ?? 0)) return message;
    changed = true;
    return { ...message, readBy: readers };
  });
  return changed ? next : messages;
}

function historyRows(data) {
  if (Array.isArray(data)) return data;
  return data?.items ?? data?.messages ?? data?.rows ?? [];
}

export async function recoverLoadedReadReceipts({
  messages, roomId, userId, fetchLatest, fetchOlder, isActive,
}) {
  const wanted = new Set(messages.filter((message) =>
    Number(message.id) > 0 && !message.deletedForAll && !message.deletedAt &&
    Number(message.senderId ?? message.sender?.id) === Number(userId) &&
    (message.chatRoomId == null || String(message.chatRoomId) === String(roomId))
  ).map((message) => String(message.id)));
  if (!wanted.size || !isActive()) return [];
  const oldestWanted = Math.min(...[...wanted].map(Number));
  const receipts = [];
  let data = await fetchLatest(roomId, 100);
  let previousCursor = Infinity;
  while (isActive()) {
    const rows = historyRows(data);
    if (!Array.isArray(rows) || !rows.length) break;
    for (const row of rows) {
      if (!wanted.has(String(row.id))) continue;
      wanted.delete(String(row.id));
      // Retain metadata only; no plaintext or ciphertext enters the merge.
      receipts.push({ id: row.id, chatRoomId: row.chatRoomId,
        deletedForAll: row.deletedForAll, deletedAt: row.deletedAt, readBy: row.readBy });
    }
    const cursor = Number(data?.nextCursorId);
    if (!wanted.size || !Number.isSafeInteger(cursor) || cursor <= 0 ||
        cursor <= oldestWanted || cursor >= previousCursor) break;
    previousCursor = cursor;
    data = await fetchOlder(roomId, cursor, 100);
  }
  return isActive() ? receipts : [];
}
