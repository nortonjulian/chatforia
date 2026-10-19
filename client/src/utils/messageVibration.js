export function supportsMessageVibration(nav = globalThis.navigator) {
  return typeof nav?.vibrate === 'function';
}

// Browser vibration is best-effort and needs a visible page plus prior user
// interaction. Never request notification permission or affect message delivery.
export function vibrateIncomingMessage({
  navigator: nav = globalThis.navigator,
  document: doc = globalThis.document,
} = {}) {
  if (!supportsMessageVibration(nav) || doc?.visibilityState !== 'visible' ||
      nav.userActivation?.hasBeenActive === false) return false;
  try {
    return nav.vibrate(150) === true;
  } catch {
    return false;
  }
}
