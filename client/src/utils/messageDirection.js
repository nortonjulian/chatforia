export function isOutgoingMessage(msg, currentUserId) {
  if (!msg || !currentUserId) return false;

  if (msg.mine === true) return true;

  const dir = String(msg.direction || '').toLowerCase();
  if (dir === 'out' || dir === 'outbound' || dir === 'sent') return true;
  if (dir === 'in' || dir === 'inbound' || dir === 'received') return false;

  const senderId =
    msg.sender?.id ??
    msg.senderId ??
    msg.fromUserId ??
    msg.userId ??
    null;

  return String(senderId) === String(currentUserId);
}

export function isSystemMessage(msg) {
  if (!msg) return false;

  const type = String(msg.type || msg.messageType || '').toUpperCase();
  if (type === 'SYSTEM' || type === 'NOTICE' || type === 'EVENT') return true;

  if (!msg.sender && !msg.senderId && msg.system === true) return true;

  return false;
}
