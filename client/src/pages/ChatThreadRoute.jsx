import { useEffect, useState } from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import { Box, Loader, Text } from '@mantine/core';
import axiosClient from '@/api/axiosClient';
import ChatView from '@/components/ChatView.jsx';

export default function ChatThreadRoute() {
  const { id } = useParams();
  const { currentUser } = useOutletContext();

  const [chatroom, setChatroom] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);

        console.log('[ChatThreadRoute] route param id =', id);

        const { data } = await axiosClient.get(`/rooms/${id}`);

        console.log('[ChatThreadRoute] loaded via /rooms/:id', data);

        if (!alive) return;

        const room = data?.room ?? data?.chatroom ?? data?.item ?? data ?? null;

        console.log('[ChatThreadRoute] normalized room =', room);

        setChatroom(room);
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
      chatroom={chatroom}
      currentUserId={currentUser?.id}
      currentUser={currentUser}
    />
  </Box>
);
}