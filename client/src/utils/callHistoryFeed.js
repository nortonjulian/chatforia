// Always render authenticated history responses, never rows supplied by socket events.
export const CALL_HISTORY_EVENTS = [
  'call:history-changed', 'call:incoming', 'video:incoming', 'call:answer',
  'call:ended', 'video:ended', 'call:participant-joined', 'call:participant-left',
  'call:participant-declined', 'voicemail:new', 'voicemail:updated', 'connect',
];

export function subscribeCallHistory({ socket, refresh, env = globalThis.window }) {
  const onVisible = () => { if (!env.document?.hidden) refresh(); };
  CALL_HISTORY_EVENTS.forEach(event => socket?.on(event, refresh));
  ['online', 'focus', 'chatforia:call-history-changed'].forEach(event => env?.addEventListener(event, refresh));
  env?.document?.addEventListener('visibilitychange', onVisible);
  return () => {
    CALL_HISTORY_EVENTS.forEach(event => socket?.off(event, refresh));
    ['online', 'focus', 'chatforia:call-history-changed'].forEach(event => env?.removeEventListener(event, refresh));
    env?.document?.removeEventListener('visibilitychange', onVisible);
  };
}

export function createCallHistoryFeed({ fetchPage, pageSize = 25, onChange,
  schedule = setTimeout, cancel = clearTimeout }) {
  let disposed = false, version = 0, pages = 1, timer = null;
  const removed = new Set();
  let state = { items: [], nextCursor: null, loading: true, loadingMore: false, error: '' };
  const publish = patch => { if (!disposed) { state = { ...state, ...patch }; onChange(state); } };
  const normalize = rows => {
    const unique = new Map();
    rows.forEach(row => { if (row?.id != null && !removed.has(String(row.id))) unique.set(String(row.id), row); });
    return [...unique.values()].sort((a, b) => {
      // Match server pagination order; status updates must not move an old call above a newer one.
      const stamp = row => Date.parse(row.createdAt || row.startedAt || row.endedAt) || 0;
      return stamp(b) - stamp(a) || Number(b.id) - Number(a.id);
    });
  };
  async function reload(ticket) {
    if (disposed || ticket !== version) return;
    publish({ error: '' });
    try {
      let items = [], cursor = null;
      const seenCursors = new Set();
      for (let page = 0; page < pages; page++) {
        const data = await fetchPage({ limit: pageSize, ...(cursor != null ? { cursor } : {}) });
        if (disposed || ticket !== version) return;
        items.push(...(Array.isArray(data?.items) ? data.items : []));
        cursor = data?.nextCursor ?? null;
        if (cursor == null) break;
        if (seenCursors.has(String(cursor))) { cursor = null; break; }
        seenCursors.add(String(cursor));
      }
      publish({ items: normalize(items), nextCursor: cursor, loading: false, loadingMore: false, error: '' });
    } catch (error) {
      if (disposed || ticket !== version) return;
      publish({ loading: false, loadingMore: false,
        error: error?.response?.data?.error || error?.message || 'Could not load recent calls.' });
    }
  }
  function refresh() {
    if (disposed) return;
    const ticket = ++version; // Invalidate an old response before the coalescing delay.
    if (timer != null) cancel(timer);
    timer = schedule(() => { timer = null; void reload(ticket); }, 80);
  }
  async function loadMore() {
    if (disposed || state.loading || state.loadingMore || state.nextCursor == null) return;
    if (timer != null) { cancel(timer); timer = null; }
    pages++;
    publish({ loadingMore: true });
    await reload(++version);
  }
  function remove(ids) {
    if (disposed) return;
    ids.forEach(id => removed.add(String(id)));
    // A response already in flight must not restore a confirmed local deletion.
    publish({ items: normalize(state.items) });
    refresh();
  }
  void reload(++version);
  return { refresh, loadMore, remove, snapshot: () => state, dispose() {
    disposed = true; version++;
    if (timer != null) cancel(timer);
  } };
}
