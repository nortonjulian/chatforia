/**
 * Determines whether a message should be treated as a system / announcement message.
 * These are still rendered as bubbles, but centered and neutral.
 */
export function isSystemMessage(message) {
  if (!message) return false;

  return (
    message.type === 'system' ||
    message.kind === 'system' ||
    message.isSystem === true ||
    message.system === true
  );
}
