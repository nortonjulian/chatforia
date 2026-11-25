import { useEffect, useRef, useState } from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import { Box, Loader, Text } from '@mantine/core';
import axiosClient from '@/api/axiosClient';
import ChatView from '@/components/ChatView.jsx';
import posthog from '@/utils/analytics';

export default function ChatThreadRoute() {
  const { id } = useParams();
  const { currentUser, nativeThreadCache } = useOutletContext();
  const scope = nativeThreadCache?.scope ?? null;
  const accessBlockedRef = useRef(false);

  const cachedRoom = nativeThreadCache?.getRoom(id) ?? null;
  const [roomState, setRoomState] = useState(() => ({
    id, scope, room: cachedRoom, loading: !cachedRoom,
  }));
  const activeState = roomState.id === id && roomState.scope === scope
    ? roomState
    : { id, scope, room: cachedRoom, loading: !cachedRoom };
  const chatroom = activeState.room;
  const loading = activeState.loading;

  useEffect(() => {
    let alive = true;
    let validated = false;
    let latestRequest = 0;
    accessBlockedRef.current = false;
    const cached = nativeThreadCache?.getRoom(id) ?? null;
    setRoomState({ id, scope, room: cached, loading: !cached });

    const remaining = cached ? nativeThreadCache.remainingRoomMs(id) : 0;
    const expiry = cached ? setTimeout(() => {
      if (!alive || validated) return;
      nativeThreadCache.delete(id);
      setRoomState({ id, scope, room: null, loading: false });
    }, remaining) : null;

    const loadRoom = async (refresh = false) => {
      const request = ++latestRequest;
      try {
        console.log('[ChatThreadRoute] route param id =', id);

        const roomId = Number(id);
        if (!Number.isFinite(roomId)) {
          console.error('[ChatThreadRoute] non-numeric chat id:', id);
          if (alive) setRoomState({ id, scope, room: null, loading: false });
          return;
        }

        const { data } = await axiosClient.get(`/chatrooms/${roomId}`);

        if (!alive || request !== latestRequest || accessBlockedRef.current) return;
        if (Number(data?.id) !== roomId || !data?.participants?.some(
          (participant) => Number(participant.userId ?? participant.user?.id) === Number(currentUser?.id)
        )) throw new Error('Room membership could not be verified');
        validated = true;
        nativeThreadCache?.putRoom(roomId, data);
        setRoomState({ id, scope, room: data, loading: false });

        if (!refresh) posthog.capture('chat_thread_opened', { roomId });

      } catch (e) {
        console.error('[ChatThreadRoute] load failed', {
          id,
          status: e?.response?.status,
          data: e?.response?.data,
          message: e?.message,
        });

        if (!alive || request !== latestRequest) return;
        nativeThreadCache?.delete(id);
        setRoomState({ id, scope, room: null, loading: false });
      }
    };

    loadRoom();
    const onRoomUpdated = (event) => {
      if (Number(event?.detail?.roomId) === Number(id)) {
        nativeThreadCache?.delete(id);
        setRoomState({ id, scope, room: null, loading: true });
        loadRoom(true);
      }
    };
    const onOnline = () => {
      if (alive && !accessBlockedRef.current) loadRoom(true);
    };
    window.addEventListener('chatroom:updated', onRoomUpdated);
    window.addEventListener('online', onOnline);

    return () => {
      alive = false;
      if (expiry) clearTimeout(expiry);
      window.removeEventListener('chatroom:updated', onRoomUpdated);
      window.removeEventListener('online', onOnline);
    };
  }, [id, currentUser?.id, nativeThreadCache]);

  if (loading) {
    return (
      <Box p="md">
        <Loader />
      </Box>
    );
  }

  if (!chatroom) {
    return (
      <Box p="md">
        <Text c="dimmed">Conversation unavailable.</Text>
      </Box>
    );
  }


  return (
    <Box
      style={{
        flex: 1,
        minHeight: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <ChatView
        key={chatroom?.id}
        chatroom={chatroom}
        currentUserId={currentUser?.id}
        currentUser={currentUser}
        nativeThreadCache={nativeThreadCache}
        onAccessError={() => {
          accessBlockedRef.current = true;
          nativeThreadCache?.delete(id);
          setRoomState({ id, scope, room: null, loading: false });
        }}
      />
    </Box>
  );
}
