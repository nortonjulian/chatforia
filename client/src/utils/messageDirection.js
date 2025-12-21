const normPhone = (v) => String(v || '').replace(/[^\d+]/g, '');

export function isOutgoingMessage(msg, currentUserId, opts = {}) {
  if (!msg) return false;

  // ✅ explicit override
  if (msg.mine === true) return true;

  // ✅ Twilio-ish + generic direction handling
  const dir = String(msg.direction || '').toLowerCase();
  // outbound, outbound-api, out, sent...
  if (dir.startsWith('out') || dir === 'sent') return true;
  if (dir.startsWith('in') || dir === 'received') return false;

  // ✅ app-to-app sender matching
  if (currentUserId) {
    const senderId =
      msg.sender?.id ??
      msg.senderId ??
      msg.fromUserId ??
      msg.userId ??
      null;

    if (senderId != null) return String(senderId) === String(currentUserId);
  }

  // ✅ SMS fallback: compare phone numbers
  // If message is FROM my number => outgoing
  // If message is TO my number => incoming
  const myNumber = opts.myNumber ? normPhone(opts.myNumber) : '';
  if (myNumber) {
    const from = normPhone(msg.from || msg.fromNumber || msg.fromPhone);
    const to = normPhone(msg.to || msg.toNumber || msg.toPhone);

    if (from && from === myNumber) return true;
    if (to && to === myNumber) return false;
  }

  return false;
}

export function isSystemMessage(msg) {
  if (!msg) return false;

  const type = String(msg.type || msg.messageType || '').toUpperCase();
  if (type === 'SYSTEM' || type === 'NOTICE' || type === 'EVENT') return true;

  if (!msg.sender && !msg.senderId && msg.system === true) return true;

  return false;
}
