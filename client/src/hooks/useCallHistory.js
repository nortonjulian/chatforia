import { useCallback, useEffect, useRef, useState } from 'react';
import { getCallHistoryPage } from '@/api/calls';
import { useSocketRaw } from '@/context/SocketContext';
import { useCall } from '@/context/CallContext';
import { createCallHistoryFeed, subscribeCallHistory } from '@/utils/callHistoryFeed';

export function useCallHistory(userId, pageSize = 25) {
  const socket = useSocketRaw();
  const call = useCall();
  const feed = useRef(null);
  const lifecycleKey = [call?.active?.callId, call?.pending, call?.status].join(':');
  const previousLifecycle = useRef(lifecycleKey);
  const empty = { items: [], nextCursor: null, loading: Boolean(userId), loadingMore: false, error: '' };
  const [snapshot, setSnapshot] = useState({ userId, ...empty });

  useEffect(() => {
    setSnapshot({ userId, ...empty });
    if (!userId) return undefined;
    const controller = createCallHistoryFeed({ pageSize, fetchPage: getCallHistoryPage,
      onChange: value => setSnapshot({ userId, ...value }) });
    feed.current = controller;
    return () => { controller.dispose(); if (feed.current === controller) feed.current = null; };
  }, [userId, pageSize]);

  const refresh = useCallback(() => feed.current?.refresh(), []);
  useEffect(() => subscribeCallHistory({ socket, refresh }), [socket, refresh, userId]);
  // Originating browser receives no incoming invitation. Its local lifecycle
  // still refreshes history even when the server socket is briefly unavailable.
  useEffect(() => {
    if (previousLifecycle.current !== lifecycleKey) refresh();
    previousLifecycle.current = lifecycleKey;
  }, [lifecycleKey, refresh]);

  return { ...(snapshot.userId === userId ? snapshot : empty), refresh,
    loadMore: () => feed.current?.loadMore(), remove: ids => feed.current?.remove(ids) };
}
