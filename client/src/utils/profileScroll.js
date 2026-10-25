// Prefer the Drawer's own scrolling container even while its opening
// transition temporarily reports no overflow.
export function getProfileScrollParent(element) {
  let parent = element?.parentElement;
  while (parent) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return parent;
    parent = parent.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

export function scrollToProfileAnchor(element) {
  if (!element) return false;
  const parent = getProfileScrollParent(element);
  if (!parent) return false;

  const anchorRect = element.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();
  const top = Math.max(
    0,
    (parent.scrollTop || 0) + anchorRect.top - parentRect.top - 12
  );

  // Use an immediate jump for a navigation shortcut. Smooth scrolling can
  // conflict with the drawer enter transition and follow-up layout updates.
  if (typeof parent.scrollTo === 'function') {
    parent.scrollTo({ top, behavior: 'auto' });
  } else {
    parent.scrollTop = top;
  }
  return true;
}
