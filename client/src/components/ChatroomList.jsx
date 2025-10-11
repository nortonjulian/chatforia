import { useEffect, useRef, useState } from 'react';
import { ScrollArea, Stack, NavLink, Badge, Text, Box } from '@mantine/core';
import ChatListSkeleton from '@/components/skeletons/ChatListSkeleton';
import EmptyState from '@/components/empty/EmptyState';
import socket from '../lib/socket';

// 🔒 Premium check
import useIsPremium from '@/hooks/useIsPremium';

// 🧱 Ads
import AdSlot from '../ads/AdSlot';
import HouseAdSlot from '../ads/HouseAdSlot';
import { PLACEMENTS } from '@/ads/placements';
import { CardAdWrap } from '@/ads/AdWrappers';

export default function ChatroomList({ onSelect, currentUser, selectedRoom, openNewChatModal }) {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const viewportRef = useRef(null);

  const isPremium = useIsPremium();

  async function loadMore(initial = false) {
    if (loading || !currentUser?.id) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('limit', initial ? '50' : '30');
      if (cursor) qs.set('cursor', String(cursor));

      const res = await fetch(
        `${import.meta.env.VITE_API_BASE}/chatrooms?${qs.toString()}`,
        {
          credentials: 'include',
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        }
      );
      if (!res.ok) throw new Error('Failed to fetch chatrooms');
      const data = await res.json(); // { items, nextCursor }
      setItems((prev) => (initial ? data.items : [...prev, ...data.items]));
      setCursor(data.nextCursor);
    } catch {
      /* no-op */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setItems([]);
    setCursor(null);
    (async () => {
      setLoading(true);
      await loadMore(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 120;
      if (nearBottom && cursor && !loading) loadMore(false);
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [cursor, loading]);

  const handleSelect = (room) => {
    if (!room) return;
    if (selectedRoom?.id) socket.emit('leave_room', selectedRoom.id);
    socket.emit('join_room', room.id);
    onSelect?.(room);
  };

  if (loading && items.length === 0) {
    return <ChatListSkeleton />;
  }

  // Empty state (no rooms)
  if (!loading && items.length === 0) {
    return (
      <Box>
        <EmptyState
          title="No conversations yet"
          subtitle="Start a chat to get rolling."
          cta="+ New Chat"
          onCta={() => openNewChatModal?.(true)}
          isPremium={isPremium}
        />

        {!isPremium && (
          <Box mt="sm" style={{ display: 'flex', justifyContent: 'center' }}>
            <CardAdWrap>
              <HouseAdSlot placement="empty_state_promo" variant="card" />
            </CardAdWrap>
          </Box>
        )}
      </Box>
    );
  }

  // Normal render
  return (
    <Box>
      {/* Optional: a slim banner above the list */}
      {!isPremium && (
        <Box mb="xs">
          <AdSlot placement={PLACEMENTS.CONTACTS_TOP_BANNER} capKey="chatlist" />
        </Box>
      )}

      <ScrollArea.Autosize
        mah="calc(100vh - 160px)"
        type="auto"
        viewportRef={viewportRef}
      >
        <Stack gap="xs" p={0}>
          {items.map((room, idx) => {
            const isSelected = selectedRoom?.id === room.id;
            const roomName = room.name || `Room #${room.id}`;
            const isGroup = (room.participants?.length || 0) > 2;

            return (
              <Box key={room.id}>
                <NavLink
                  label={roomName}
                  active={isSelected}
                  onClick={() => handleSelect(room)}
                  rightSection={
                    isGroup ? (
                      <Badge size="xs" variant="light" radius="sm">
                        Group
                      </Badge>
                    ) : null
                  }
                  variant="light"
                  radius="md"
                  aria-label={`Open chat ${roomName}`}
                />

                {/* Native ad tile after the 3rd chat (idx === 2) */}
                {!isPremium && idx === 3 && (
                  <Box my="xs">
                    <AdSlot
                      placement={PLACEMENTS.INBOX_NATIVE_1}
                      capKey="inbox"
                    />
                  </Box>
                )}
              </Box>
            );
          })}

          {loading && items.length > 0 && (
            <Text ta="center" c="dimmed" py="xs">
              Loading…
            </Text>
          )}
          {!cursor && items.length > 0 && !loading && (
            <Text ta="center" c="dimmed" py="xs">
              No more chats
            </Text>
          )}
        </Stack>
      </ScrollArea.Autosize>
    </Box>
  );
}
