// One brief visual pulse per invitation. No audio, permissions or call mutations.
export function flashIncomingCall({ document: doc = globalThis.document,
  window: win = globalThis.window, setTimeout: schedule = globalThis.setTimeout,
  clearTimeout: cancel = globalThis.clearTimeout } = {}) {
  const motion = win?.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (!doc?.body || doc.visibilityState !== 'visible' || motion?.matches) return () => {};
  const overlay = doc.createElement('div');
  overlay.setAttribute('data-a11y-call-flash', '');
  overlay.setAttribute('aria-hidden', 'true');
  Object.assign(overlay.style, { position: 'fixed', inset: '0', background: 'white',
    opacity: '0.85', pointerEvents: 'none', zIndex: '2147483647' });
  let timer = null;
  let removed = false;
  function cleanup() {
    if (removed) return;
    removed = true;
    if (timer !== null) cancel(timer);
    overlay.remove();
    doc.removeEventListener('visibilitychange', visibilityChanged);
    if (motion?.removeEventListener) motion.removeEventListener('change', motionChanged);
    else motion?.removeListener?.(motionChanged);
  }
  function visibilityChanged() { if (doc.visibilityState !== 'visible') cleanup(); }
  function motionChanged() { if (motion.matches) cleanup(); }
  doc.body.appendChild(overlay);
  doc.addEventListener('visibilitychange', visibilityChanged);
  if (motion?.addEventListener) motion.addEventListener('change', motionChanged);
  else motion?.addListener?.(motionChanged);
  timer = schedule(cleanup, 220);
  return cleanup;
}
