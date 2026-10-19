// Only video-call termination intent is retained. Never store media or transcripts.
export function createVideoCallEndQueue({ accountId, send, storage, env = globalThis,
  isCurrentAccount = () => true, onPending = () => {}, onSettled = () => {}, onFailure = () => {} }) {
  const key = `chatforia:pendingVideoEnds:${accountId}`;
  const entries = new Map();
  let disposed = false, timer;
  const now = () => env.Date.now();
  const online = () => env.navigator?.onLine !== false;
  function persist() {
    try {
      if (entries.size) storage?.setItem(key, JSON.stringify([...entries.values()].map(({ callId, reason }) => ({ callId, reason }))));
      else storage?.removeItem(key);
    } catch { /* An unavailable store must not prevent in-memory recovery. */ }
  }
  try {
    const saved = JSON.parse(storage?.getItem(key) || '[]');
    if (Array.isArray(saved)) for (const item of saved) {
      if (Number.isSafeInteger(item?.callId) && item.callId > 0 && typeof item.reason === 'string') {
        entries.set(item.callId, { callId: item.callId, reason: item.reason.slice(0, 100), attempts: 0, due: 0 });
      }
    }
  } catch { /* Ignore invalid local storage, without sending its contents. */ }
  function schedule() {
    env.clearTimeout(timer);
    if (disposed || !isCurrentAccount() || !online()) return;
    const waiting = [...entries.values()].filter(item => !item.inFlight);
    if (waiting.length) timer = env.setTimeout(() => flush(), Math.max(0, Math.min(...waiting.map(item => item.due)) - now()));
  }
  function pending(item) {
    if (!item.notified) { item.notified = true; onPending(item.callId); }
  }
  async function attempt(item) {
    item.inFlight = true;
    item.controller = new env.AbortController();
    let timeout;
    try {
      const response = await Promise.race([
        send({ callId: item.callId, reason: item.reason }, item.controller.signal),
        new Promise((_, reject) => { timeout = env.setTimeout(() => {
          item.controller.abort(); reject(new Error('Video hangup timed out'));
        }, 8000); }),
      ]);
      const data = await response.json();
      if (disposed || !isCurrentAccount()) return;
      if (response.ok && data?.ok === true && !data.ignored) {
        entries.delete(item.callId); persist(); onSettled(item.callId); return;
      }
      // These cannot be repaired by retrying as this account/device. In
      // particular, never try to override another installation's authority.
      if (data?.ignored || [400, 403, 404, 410].includes(response.status)) {
        entries.delete(item.callId); persist(); onFailure(item.callId); return;
      }
      throw new Error('Video hangup was not acknowledged');
    } catch {
      if (disposed || !isCurrentAccount()) return;
      item.attempts += 1;
      item.due = now() + Math.min(30000, 1000 * 2 ** Math.min(item.attempts - 1, 5));
      pending(item);
    } finally {
      env.clearTimeout(timeout);
      item.inFlight = false;
      schedule();
    }
  }
  function flush(force = false) {
    if (disposed || !isCurrentAccount()) return;
    if (!online()) { entries.forEach(pending); return; }
    for (const item of entries.values()) {
      if (!item.inFlight && (force || item.due <= now())) void attempt(item);
    }
    schedule();
  }
  function enqueue(callId, reason = 'ended') {
    const id = Number(callId);
    if (disposed || !isCurrentAccount() || !Number.isSafeInteger(id) || id <= 0) return;
    if (!entries.has(id)) entries.set(id, { callId: id, reason: String(reason || 'ended').slice(0, 100), attempts: 0, due: 0 });
    persist(); // Save before releasing local call state or starting network work.
    flush(true);
  }
  const resume = () => flush(true);
  env.addEventListener?.('online', resume);
  env.addEventListener?.('focus', resume);
  // Defer restored requests until the caller has installed its queue reference.
  timer = env.setTimeout(resume, 0);
  return {
    enqueue, retry: resume,
    dispose() {
      disposed = true;
      env.clearTimeout(timer);
      env.removeEventListener?.('online', resume);
      env.removeEventListener?.('focus', resume);
      entries.forEach(item => item.controller?.abort());
    },
  };
}
