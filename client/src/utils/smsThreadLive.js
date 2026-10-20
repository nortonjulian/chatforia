// One loader per signed-in account/thread. Never merge an arbitrary socket body
// into history: refetch the account-authorized thread and reject stale responses.
export function createSmsThreadLoader({ fetchThread, onThread, onError = () => {}, cache = async () => {}, onRefresh = () => {} }) {
  let disposed = false, wanted = 0, queued = false, running = null;
  async function drain() {
    while (queued && !disposed) {
      queued = false;
      const version = wanted;
      try {
        const thread = await fetchThread();
        if (disposed || version !== wanted) continue;
        onThread(thread);
        onRefresh();
        // A cache failure must not erase successfully fetched history.
        try { await cache(thread); } catch { /* best-effort search cache */ }
      } catch (error) {
        if (!disposed && version === wanted) onError(error);
      }
    }
  }
  return {
    refresh() {
      if (disposed) return Promise.resolve();
      wanted += 1; queued = true;
      if (!running) {
        running = drain().finally(() => { running = null; });
      }
      return running;
    },
    dispose() { disposed = true; wanted += 1; queued = false; },
  };
}

export function subscribeSmsThread({ socket, threadId, refresh, windowTarget = window, documentTarget = document, schedule = setTimeout, cancel = clearTimeout }) {
  let timer, disposed = false;
  const positiveID = value => /^\d+$/.test(String(value ?? '')) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? String(Number(value)) : null;
  const activeID = positiveID(threadId);
  const queue = () => {
    if (disposed) return;
    cancel(timer);
    timer = schedule(() => { timer = undefined; if (!disposed) void refresh(); }, 60);
  };
  const message = payload => {
    const id = positiveID(payload?.threadId ?? payload?.message?.threadId ?? payload?.thread?.id);
    if (activeID && id === activeID) queue();
  };
  const visible = () => { if (documentTarget.visibilityState === 'visible') queue(); };
  const events = ['sms:message:new', 'sms_message_new', 'sms:message:updated', 'sms:message:deleted'];
  events.forEach(event => socket?.on(event, message));
  socket?.on('connect', queue);
  windowTarget.addEventListener('online', queue);
  windowTarget.addEventListener('focus', queue);
  documentTarget.addEventListener('visibilitychange', visible);
  return () => {
    disposed = true; cancel(timer);
    events.forEach(event => socket?.off(event, message));
    socket?.off('connect', queue);
    windowTarget.removeEventListener('online', queue);
    windowTarget.removeEventListener('focus', queue);
    documentTarget.removeEventListener('visibilitychange', visible);
  };
}
