// Only deliberately shared message.readBy entries can identify a group reader.
// readAt, current preferences and room membership are not evidence of a read.
export function groupReceiptReaders(message) {
  if (!message || message.deletedForAll || message.deletedAt) return [];
  const senderId = Number(message.sender?.id ?? message.senderId ?? message.userId);
  const readers = new Map();
  for (const reader of Array.isArray(message.readBy) ? message.readBy : []) {
    const id = Number(reader?.id);
    if (!Number.isSafeInteger(id) || id <= 0 || id === senderId || readers.has(id)) continue;
    const username = typeof reader.username === 'string' ? reader.username.trim() : '';
    readers.set(id, { id, name: username || `User ${id}` });
  }
  return [...readers.values()];
}
