const validId = (value) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

// Only rows actually intersecting the foreground SMS viewport may be
// acknowledged. The server rechecks ownership and incoming direction.
export function visibleIncomingSmsIds(viewport, messages, documentTarget = document) {
  if (
    !viewport || documentTarget.visibilityState !== 'visible' ||
    !documentTarget.hasFocus()
  ) return [];

  const incoming = new Set(
    (messages || [])
      .filter((message) => String(message?.direction).toLowerCase() === 'in')
      .map((message) => validId(message.id))
      .filter(Boolean)
  );
  if (!incoming.size) return [];

  const bounds = viewport.getBoundingClientRect();
  const visible = [];
  for (const row of viewport.querySelectorAll('[data-sms-msg-id]')) {
    const id = validId(row.getAttribute('data-sms-msg-id'));
    if (!id || !incoming.has(id)) continue;
    const rect = row.getBoundingClientRect();
    if (
      rect.bottom > bounds.top && rect.top < bounds.bottom &&
      rect.right > bounds.left && rect.left < bounds.right
    ) visible.push(id);
  }
  return [...new Set(visible)];
}
