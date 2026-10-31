/**
 * The SMS gallery uses the current authorized thread response, not an
 * incomplete IndexedDB placeholder or public media URLs.
 * Each entry retains its original index for GET /sms/media/:id/:idx.
 */
export function buildSmsGalleryItems(messages) {
  const items = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.id == null) continue;
    const refs = Array.isArray(message.mediaUrls)
      ? message.mediaUrls
      : message.mediaUrls && typeof message.mediaUrls === 'object'
        ? Object.values(message.mediaUrls)
        : [];

    refs.forEach((item, mediaIndex) => {
      const ref = typeof item === 'string' ? item : item?.url;
      if (typeof ref !== 'string' || !ref.trim()) return;
      items.push({
        id: `${message.id}:${mediaIndex}`,
        messageId: message.id,
        mediaIndex,
        item,
        createdAt: message.createdAt || message.sentAt || message.created_at || '',
      });
    });
  }
  return items.sort((a, b) =>
    new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );
}
