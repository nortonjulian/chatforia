import { useEffect, useState } from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import { Box, Loader, Text } from '@mantine/core';
import axiosClient from '@/api/axiosClient';
import ChatView from '@/components/ChatView.jsx';
import { useUser } from '@/context/UserContext';
import EncryptionRecoveryCard from '@/components/security/EncryptionRecoveryCard.jsx';
import posthog from '@/utils/analytics';

export default function ChatThreadRoute() {
  const { id } = useParams();
  const { currentUser } = useOutletContext();
  const { needsKeyUnlock, keyUnlockMode } = useUser();

  const [chatroom, setChatroom] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);

        console.log('[ChatThreadRoute] route param id =', id);

        const roomId = Number(id);
        if (!Number.isFinite(roomId)) {
          console.error('[ChatThreadRoute] non-numeric chat id:', id);
          if (alive) setChatroom(null);
          return;
        }

        const { data } = await axiosClient.get(`/chatrooms/${roomId}`);

        if (!alive) return;
        setChatroom(data ?? null);

        posthog.capture('chat_thread_opened', {
          roomId,
        });

      } catch (e) {
        console.error('[ChatThreadRoute] load failed', {
          id,
          status: e?.response?.status,
          data: e?.response?.data,
          message: e?.message,
        });

        if (!alive) return;
        setChatroom(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [id]);

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
        <Text c="dimmed">Chat not found.</Text>
      </Box>
    );
  }

  if (needsKeyUnlock) {
    return (
      <Box p="md" style={{ flex: 1, overflowY: 'auto' }}>
        <EncryptionRecoveryCard
          blocked
          title={
            keyUnlockMode === 'locked'
              ? 'Unlock secure messages'
              : 'Restore secure messages'
          }
          description={
            keyUnlockMode === 'locked'
              ? 'Enter your Secure Messages Passcode to view and send secure messages on this browser.'
              : 'This browser needs your secure message key before it can show secure messages.'
          }
        />
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
      />
    </Box>
  );
}