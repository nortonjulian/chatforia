// Keep the latest SMS direction in the conversation preview so clients do not
// request incoming-only translation for an outgoing message.
export function smsConversationLast(lastMessage, previewText, media) {
  if (!lastMessage?.createdAt) return null;
  return {
    text: previewText,
    messageId: lastMessage.id,
    at: lastMessage.createdAt.toISOString(),
    direction: lastMessage.direction,
    senderName: null,
    ...media,
  };
}
