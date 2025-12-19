import { useEffect, useState } from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import { Box, Loader, Text } from '@mantine/core';
import axiosClient from '@/api/axiosClient';
import ChatView from '@/components/ChatView.jsx';

export default function ChatThreadRoute() {
  const { id } = useParams();
  const { currentUser } = useOutletContext(); // from AuthedLayout <Outlet context={{...}} />

  const [chatroom, setChatroom] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);

        // You need to match whatever endpoint you already use to fetch a room.
        // Common options:
        // - GET /chatrooms/:id
        // - GET /rooms/:id
        // - GET /chatrooms/:id?userId=...
        const { data } = await axiosClient.get(`/chatrooms/${id}`);

        if (!alive) return;
        setChatroom(data);
      } catch (e) {
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
    <ChatView
      chatroom={chatroom}
      currentUserId={currentUser?.id}
      currentUser={currentUser}
    />
  );
}
