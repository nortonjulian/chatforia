export function anonymousParticipants(room) {
  const random = room?.randomChatRoom;
  if (!random || random.unlockedAt) return room?.participants || [];
  const aliases = random.aliasByUser && typeof random.aliasByUser === 'object'
    ? random.aliasByUser : {};
  return (room.participants || []).map((participant) => {
    const userId = Number(participant.userId ?? participant.user?.id);
    const alias = aliases[String(userId)] || 'Random Chat';
    return {
      ...participant,
      user: participant.user ? {
        id: userId,
        username: alias,
        displayName: alias,
        avatarUrl: null,
        publicKey: participant.user.publicKey ?? null,
        preferredLanguage: participant.user.preferredLanguage ?? null,
        autoTranslate: participant.user.autoTranslate ?? null,
      } : undefined,
    };
  });
}

export function anonymousMessage(message, random) {
  if (!random || random.unlockedAt || !message) return message;
  const aliases = random.aliasByUser && typeof random.aliasByUser === 'object'
    ? random.aliasByUser : {};
  const senderId = Number(message.senderId ?? message.sender?.id);
  const alias = aliases[String(senderId)] || 'Random Chat';
  return {
    ...message,
    sender: message.sender ? {
      id: senderId,
      username: alias,
      publicKey: message.sender.publicKey ?? null,
    } : message.sender,
    readBy: (message.readBy || []).map((user) => ({
      id: user.id,
      username: aliases[String(user.id)] || 'Random Chat',
    })),
  };
}
