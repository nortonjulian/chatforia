// Deadlines are authoritative per message, independent of today's preference.
export function isMessageExpired(message, now = Date.now()) {
  if (message?.expiresAt == null || message.expiresAt === '') return false;
  const deadline = new Date(message.expiresAt).getTime();
  return Number.isFinite(deadline) && deadline <= now;
}

export function expiryEventMessageId(payload, roomId, now = Date.now()) {
  const source = payload?.item ?? payload?.message ?? payload;
  const incomingRoom = Number(source?.chatRoomId ?? source?.roomId);
  const id = Number(source?.id ?? source?.messageId);
  if (incomingRoom !== Number(roomId) || !Number.isSafeInteger(id) || id <= 0 ||
      !isMessageExpired(source, now)) return null;
  return id;
}
