import { useEffect, useState } from 'react';
import {
  Stack,
  Skeleton,
  Text,
  Button,
  Group,
  Alert,
  Badge,
  UnstyledButton,
  Divider,
} from '@mantine/core';
import axiosClient from '../api/axiosClient';

import AdSlot from '@/ads/AdSlot';
import { PLACEMENTS } from '@/ads/placements';
import useIsPremium from '@/hooks/useIsPremium';

export default function ChatroomsSidebar({
  onStartNewChat,
  onSelect,
  hideEmpty = false,
  activeRoomId = null,
  onCountChange,
  listOnly = false,        // NEW: suppress header/ads/empty CTA
  filterQuery = '',        // NEW: filter client-side by title/snippet
}) {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const isPremium = useIsPremium();

  // expose reload via a window event so Sidebar can trigger it
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('sidebar:reload-rooms', handler);
    return () => window.removeEventListener('sidebar:reload-rooms', handler);
  }, []);

  async function load() {
    try {
      setLoading(true);
      setErr('');
      const res = await axiosClient.get('/rooms');
      const data = res?.data;
      const list = Array.isArray(data) ? data : (data?.rooms || []);
      setRooms(list);
    } catch (e) {
      setErr(
        e?.response?.data?.error ||
          e?.response?.data?.message ||
          e?.message ||
          'Failed to load chats'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    onCountChange?.(Array.isArray(rooms) ? rooms.length : 0);
  }, [rooms, onCountChange]);

  const q = filterQuery.trim().toLowerCase();
  const visible = q
    ? rooms.filter((r) => {
        const title = (r.title || r.name || r.displayName || '').toLowerCase();
        const snippet = (r.lastMessage?.content || '').toLowerCase();
        return title.includes(q) || snippet.includes(q);
      })
    : rooms;

  /* ---------- Loading ---------- */
  if (loading) {
    return (
      <Stack p="sm" gap="sm">
        {!listOnly && <Text fw={600}>Conversations</Text>}
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} height={46} radius="md" />
        ))}
      </Stack>
    );
  }

  /* ---------- Error ---------- */
  if (err) {
    return (
      <Stack p="sm" gap="sm">
        {!listOnly && <Text fw={600}>Conversations</Text>}
        <Alert color="red" variant="light">{err}</Alert>
        {!listOnly && <Button onClick={load}>Retry</Button>}
      </Stack>
    );
  }

  /* ---------- Empty list ---------- */
  if (!visible.length) {
    if (hideEmpty) return null;
    return (
      <Stack p="sm" gap="sm">
        {!listOnly && <Text fw={600}>Conversations</Text>}
        {/* With listOnly or hideEmpty, Sidebar handles empty-state UX */}
        <Text c="dimmed" size="sm">No conversations yet.</Text>
        {!listOnly && (
          <Button onClick={onStartNewChat}>Start a chat</Button>
        )}
      </Stack>
    );
  }

  /* ---------- Populated list ---------- */
  return (
    <Stack p="sm" gap="xs">
      {!listOnly && <Text fw={600}>Conversations</Text>}
      {!listOnly && !isPremium && (
        <>
          <AdSlot placement={PLACEMENTS.SIDEBAR_PRIMARY} />
          <Divider my={6} />
        </>
      )}

      {visible.map((r, idx) => {
        const title = r.title || r.name || r.displayName || `Room #${r.id}`;
        const unread = r.unreadCount || r._count?.unread || 0;

        return (
          <div key={r.id}>
            <UnstyledButton
              onClick={() => onSelect?.(r)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 12,
                background:
                  String(r.id) === String(activeRoomId)
                    ? 'var(--mantine-color-gray-1)'
                    : 'transparent',
              }}
              title={title}
            >
              <Group justify="space-between" wrap="nowrap">
                <Text truncate fw={500}>{title}</Text>
                {!!unread && <Badge size="sm" variant="light">{unread}</Badge>}
              </Group>
              {r.lastMessage?.content && (
                <Text size="sm" c="dimmed" lineClamp={1} mt={4}>
                  {r.lastMessage.content}
                </Text>
              )}
            </UnstyledButton>

            {!listOnly && !isPremium && idx === 2 && (
              <>
                <Divider my={6} />
                <AdSlot placement={PLACEMENTS.SIDEBAR_SECONDARY} />
                <Divider my={6} />
              </>
            )}
          </div>
        );
      })}
    </Stack>
  );
}
