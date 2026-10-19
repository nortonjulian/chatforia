// Notification effects only: never writes messages, receipts, badges or audio state.
export function attachVisualAlerts({ socket, userId, getEnabled, show, hide,
  getFlashEnabled = () => false, startCallFlash = () => () => {},
  getVibrationEnabled = () => false, vibrateMessage = () => {},
  getLabels = () => ({ message: 'New message', call: 'Incoming call', body: 'Return to Chatforia to view it.' }),
  document: doc = globalThis.document, window: win = globalThis.window,
  now = Date.now, setInterval: startTimer = globalThis.setInterval, clearInterval: stopTimer = globalThis.clearInterval,
}) {
  const startedAt = now();
  const seen = new Set();
  const banners = new Set();
  const listeners = [];
  let timer = null;
  let baseTitle = null;
  let alertTitle = null;
  let blinkingKey = null;
  let disposed = false;
  let flashKey = null;
  let cancelFlash = null;

  function stopFlash() {
    cancelFlash?.();
    cancelFlash = null;
    flashKey = null;
  }

  const isForeground = () => doc.visibilityState !== 'hidden' && doc.hasFocus();
  function stopBlink() {
    if (timer !== null) stopTimer(timer);
    timer = null;
    // Preserve a newer route title if navigation changed it during blinking.
    if (alertTitle !== null && doc.title === alertTitle) doc.title = baseTitle;
    alertTitle = null;
    blinkingKey = null;
  }
  function clear() {
    stopBlink();
    for (const id of banners) hide(id);
    banners.clear();
  }
  function claim(key) {
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > 2048) seen.delete(seen.values().next().value);
    return true;
  }
  function alert(kind, key) {
    if (disposed || !claim(key) || !getEnabled()) return;
    const labels = getLabels();
    const title = labels[kind];
    const id = `a11y-${key}`;
    banners.add(id);
    if (banners.size > 32) banners.delete(banners.values().next().value);
    show({ id, title, message: labels.body });
    if (isForeground()) return;
    stopBlink();
    baseTitle = doc.title;
    alertTitle = `❖ ${title} — Chatforia`;
    blinkingKey = key;
    doc.title = alertTitle;
    timer = startTimer(() => {
      if (!getEnabled() || isForeground()) { stopBlink(); return; }
      if (doc.title !== alertTitle && doc.title !== baseTitle) baseTitle = doc.title;
      doc.title = doc.title === alertTitle ? baseTitle : alertTitle;
    }, 900);
  }
  function message(payload) {
    const row = payload?.item ?? payload?.message ?? payload?.shaped ?? payload;
    const id = Number(row?.id);
    const senderId = Number(row?.sender?.id ?? row?.senderId ?? row?.userId);
    const createdAt = Date.parse(row?.createdAt);
    // Upserts also represent edits/receipts. Never treat historical hydration,
    // own messages, tombstones, expired rows or invalid metadata as new arrivals.
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(senderId) || senderId <= 0 ||
        senderId === Number(userId) || !Number.isFinite(createdAt) || createdAt < startedAt ||
        row.editedAt || row.deletedForAll || row.deletedAt ||
        (row.expiresAt && Date.parse(row.expiresAt) <= now()) ||
        (Array.isArray(row.readBy) && row.readBy.some((reader) => Number(reader?.id) === Number(userId)))) return;
    alert('message', `message-${id}`);
    // Independent of banners/title blinking. Claim while OFF too, so an alias
    // delivered after enabling cannot replay an already received message.
    if (!disposed && claim(`vibrate-message-${id}`) && getVibrationEnabled()) {
      try { vibrateMessage(); } catch { /* Device refusal cannot break delivery. */ }
    }
  }
  function call(payload) {
    const id = payload?.callId;
    const callerId = Number(payload?.callerId ?? payload?.fromUser?.id);
    if (id == null || !String(id).trim() || callerId === Number(userId)) return;
    alert('call', `call-${id}`);
    // Independent preference: disabling title/banner alerts must not disable
    // call flashing. Claim aliases even while OFF so they cannot replay later.
    if (!disposed && claim(`flash-call-${id}`) && getFlashEnabled()) {
      stopFlash();
      flashKey = `call-${id}`;
      cancelFlash = startCallFlash();
    }
  }
  function endCall(payload) {
    if (payload?.callId == null) return;
    const key = `call-${payload.callId}`;
    if (flashKey === key) stopFlash();
    if (blinkingKey === key) stopBlink();
    const id = `a11y-${key}`;
    if (banners.delete(id)) hide(id);
  }
  function onFocus() { if (isForeground()) stopBlink(); }
  function on(event, handler) { socket.on(event, handler); listeners.push([event, handler]); }
  for (const event of ['message:upsert', 'message:new', 'receive:message']) on(event, message);
  for (const event of ['call:incoming', 'video:incoming', 'call:participant-invite']) on(event, call);
  for (const event of ['call:ended', 'video:ended', 'call:answer']) on(event, endCall);
  win.addEventListener('focus', onFocus);
  doc.addEventListener('visibilitychange', onFocus);

  return {
    syncPreference() {
      if (!getEnabled()) clear();
      if (!getFlashEnabled()) stopFlash();
    },
    dispose() {
      disposed = true;
      listeners.forEach(([event, handler]) => socket.off(event, handler));
      win.removeEventListener('focus', onFocus);
      doc.removeEventListener('visibilitychange', onFocus);
      clear();
      stopFlash();
    },
  };
}
