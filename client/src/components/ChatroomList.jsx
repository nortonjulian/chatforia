// client/src/components/ChatroomList.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollArea, Stack, NavLink, Badge, Text, Box, ActionIcon, Menu } from '@mantine/core';
import { IconDotsVertical, IconTrash } from '@tabler/icons-react';
import ChatListSkeleton from '@/components/skeletons/ChatListSkeleton';
import EmptyState from '@/components/empty/EmptyState';
import socket from '../lib/socket';

import useIsPremium from '@/hooks/useIsPremium';

import AdSlot from '../ads/AdSlot';
import HouseAdSlot from '../ads/HouseAdSlot';
import { PLACEMENTS } from '@/ads/placements';
import { CardAdWrap } from '@/ads/AdWrappers';

function normalizeChatroom(room) {
  return {
    id: String(room.id),
    type: 'chat',
    title: room.name || `Room #${room.id}`,
    updatedAt:
      room.updatedAt ||
      room.lastMessageAt ||
      room.lastActivityAt ||
      room.createdAt ||
      null,
    isGroup: (room.participants?.length || 0) > 2,
    raw: room,
  };
}

function normalizeSmsThread(t) {
  const title =
    t.displayName ||
    t.contactName ||
    t.contactPhone ||
    t.phone ||
    `SMS #${t.id}`;

  return {
    id: String(t.id),
    type: 'sms',
    title,
    updatedAt: t.updatedAt || t.lastMessageAt || t.createdAt || null,
    isGroup: false,
    raw: t,
  };
}

export default function ChatroomList({
  onSelect, // receives a "thread" object
  currentUser,
  selectedRoom, // rename later to selectedThread
  openNewChatModal,
}) {
  const [chatrooms, setChatrooms] = useState([]);
  const [smsThreads, setSmsThreads] = useState([]);

  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const viewportRef = useRef(null);

  const isPremium = useIsPremium();

  async function loadChatrooms(initial = false) {
    if (!currentUser?.id) return;
    const qs = new URLSearchParams();
    qs.set('limit', initial ? '50' : '30');
    if (cursor?.id && cursor?.updatedAt && !initial) {
      qs.set('cursorId', String(cursor.id));
      qs.set('cursorUpdatedAt', String(cursor.updatedAt));
    }

    const res = await fetch(
      `${import.meta.env.VITE_API_BASE_URL}/chatrooms?${qs.toString()}`,
      {
        credentials: 'include',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      }
    );
    if (!res.ok) throw new Error('Failed to fetch chatrooms');
    const data = await res.json(); // { items, nextCursor }
    setChatrooms((prev) => (initial ? data.items : [...prev, ...data.items]));
    setCursor(data.nextCursor);
  }

  // SMS threads: fetch once (unless you add pagination)
  async function loadSmsThreads() {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/sms/threads`, {
        credentials: 'include',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      if (!res.ok) throw new Error('Failed to fetch sms threads');
      const data = await res.json(); // assume { items } or array
      const items = Array.isArray(data) ? data : data.items || [];
      setSmsThreads(items);
    } catch {
      setSmsThreads([]);
    }
  }

  useEffect(() => {
    setChatrooms([]);
    setSmsThreads([]);
    setCursor(null);

    (async () => {
      setLoading(true);
      try {
        await Promise.all([loadChatrooms(true), loadSmsThreads()]);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  // infinite scroll continues to paginate chatrooms (sms threads stay loaded once)
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 120;
      if (nearBottom && cursor && !loading) {
        setLoading(true);
        loadChatrooms(false)
          .catch(() => {})
          .finally(() => setLoading(false));
      }
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [cursor, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Unified threads list
  const threads = useMemo(() => {
    const merged = [
      ...chatrooms.map(normalizeChatroom),
      ...smsThreads.map(normalizeSmsThread),
    ];

    merged.sort((a, b) => {
      const da = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const db = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return db - da;
    });

    return merged;
  }, [chatrooms, smsThreads]);

  const handleSelect = (thread) => {
    if (!thread) return;

    // only join socket rooms for app-chat threads
    if (thread.type === 'chat') {
      const room = thread.raw;
      if (selectedRoom?.id) socket.emit('leave_room', selectedRoom.id);
      socket.emit('join_room', room.id);
    }

    onSelect?.(thread);
  };

  // ✅ Soft-delete / hide for now (until server endpoints exist)
  // - chat: remove from list locally (later: call DELETE /chatrooms/:id or leave/archive)
  // - sms: remove from list locally (later: call DELETE /sms/threads/:id)
  const handleDeleteThread = (thread) => {
    if (!thread) return;

    // if deleting selected, clear selection
    const isSelected =
      selectedRoom?.id === thread.raw?.id || selectedRoom?.threadId === thread.id;
    if (isSelected) onSelect?.(null);

    if (thread.type === 'chat') {
      setChatrooms((prev) => prev.filter((r) => String(r.id) !== thread.id));
      return;
    }
    setSmsThreads((prev) => prev.filter((t) => String(t.id) !== thread.id));
  };

  if (loading && threads.length === 0) return <ChatListSkeleton />;

  if (!loading && threads.length === 0) {
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

  return (
    <Box>
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
          {threads.map((thread, idx) => {
            const isSelected =
              selectedRoom?.id === thread.raw?.id ||
              selectedRoom?.threadId === thread.id; // supports either style

            return (
              <Box key={`${thread.type}:${thread.id}`}>
                <NavLink
                  label={thread.title}
                  active={isSelected}
                  onClick={() => handleSelect(thread)}
                  rightSection={
                    <Group gap={6} wrap="nowrap">
                      {thread.type === 'sms' ? (
                        <Badge size="xs" variant="light" radius="sm">
                          SMS
                        </Badge>
                      ) : thread.isGroup ? (
                        <Badge size="xs" variant="light" radius="sm">
                          Group
                        </Badge>
                      ) : null}

                      {/* ✅ per-thread menu (delete for now) */}
                      <Menu withinPortal position="bottom-end" shadow="md" radius="md">
                        <Menu.Target>
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            aria-label="Thread actions"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <IconDotsVertical size={16} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
                          <Menu.Item
                            color="red"
                            leftSection={<IconTrash size={16} />}
                            onClick={() => handleDeleteThread(thread)}
                          >
                            Delete
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </Group>
                  }
                  variant="light"
                  radius="md"
                  aria-label={`Open ${thread.type} thread ${thread.title}`}
                />

                {!isPremium && idx === 3 && (
                  <Box my="xs">
                    <AdSlot placement={PLACEMENTS.INBOX_NATIVE_1} capKey="inbox" />
                  </Box>
                )}
              </Box>
            );
          })}

          {loading && threads.length > 0 && (
            <Text ta="center" c="dimmed" py="xs">
              Loading…
            </Text>
          )}

          {!cursor && threads.length > 0 && !loading && (
            <Text ta="center" c="dimmed" py="xs">
              No more chats
            </Text>
          )}
        </Stack>
      </ScrollArea.Autosize>
    </Box>
  );
}
