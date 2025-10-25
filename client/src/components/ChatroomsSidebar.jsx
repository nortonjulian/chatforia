import { useEffect, useState, useCallback } from 'react';
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
import axiosClient from '@/api/axiosClient';

import AdSlot from '@/ads/AdSlot';
import { PLACEMENTS } from '@/ads/placements';
import useIsPremium from '@/hooks/useIsPremium';

export default function ChatroomsSidebar({
  onStartNewChat,
  onSelect,
  hideEmpty = false,
  activeRoomId = null,
  onCountChange,
  listOnly = false,        // suppress header/ads/CTA when embedded in Sidebar
  filterQuery = '',        // client-side filter text
}) {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const isPremium = useIsPremium();

  const load = useCallback(async () => {
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
  }, []);

  // initial load
  useEffect(() => {
    load();
  }, [load]);

  // let Sidebar trigger reload via CustomEvent
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('sidebar:reload-rooms', handler);
    return () => window.removeEventListener('sidebar:reload-rooms', handler);
  }, [load]);

  // bubble up count
  useEffect(() => {
    onCountChange?.(Array.isArray(rooms) ? rooms.length : 0);
  }, [rooms, onCountChange]);

  const q = filterQuery.trim().toLowerCase();
  const visibleRooms = q
    ? rooms.filter((r) => {
        const title = (r.title || r.name || r.displayName || '').toLowerCase();
        const snippet = (r.lastMessage?.content || '').toLowerCase();
        return title.includes(q) || snippet.includes(q);
      })
    : rooms;

  // -------- loading --------
  if (loading) {
    return (
      <Stack p="sm" gap="sm">
        {!listOnly && (
          <Text fw={600} aria-label="Conversations header">
            Conversations
          </Text>
        )}
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} height={46} radius="md" />
        ))}
      </Stack>
    );
  }

  // -------- error --------
  if (err) {
    return (
      <Stack p="sm" gap="sm">
        {!listOnly && (
          <Text fw={600} aria-label="Conversations header">
            Conversations
          </Text>
        )}
        <Alert color="red" variant="light">
          {err}
        </Alert>
        {!listOnly && (
          <Button onClick={load}>
            Retry
          </Button>
        )}
      </Stack>
    );
  }

  // -------- empty list --------
  if (!visibleRooms.length) {
    if (hideEmpty) return null;
    return (
      <Stack p="sm" gap="sm">
        {!listOnly && (
          <Text fw={600} aria-label="Conversations header">
            Conversations
          </Text>
        )}
        <Text c="dimmed" size="sm">
          No conversations yet.
        </Text>
        {!listOnly && (
          <Button onClick={onStartNewChat}>
            Start a chat
          </Button>
        )}
      </Stack>
    );
  }

  // -------- populated --------
  return (
    <Stack p="sm" gap="xs">
      {!listOnly && (
        <Text fw={600} aria-label="Conversations header">
          Conversations
        </Text>
      )}

      {/* Top ad strip (only free users, only when showing list, not in Sidebar's listOnly mode) */}
      {!listOnly && !isPremium && (
        <>
          <AdSlot placement={PLACEMENTS.SIDEBAR_PRIMARY} />
          <Divider my={6} />
        </>
      )}

      {visibleRooms.map((r, idx) => {
        const title = r.title || r.name || r.displayName || `Room #${r.id}`;
        const unread = r.unreadCount || r._count?.unread || 0;
        const isActive = String(r.id) === String(activeRoomId);

        return (
          <div key={r.id}>
            <UnstyledButton
              onClick={() => onSelect?.(r)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 12,
                background: isActive
                  ? 'var(--mantine-color-gray-1)'
                  : 'transparent',
                textAlign: 'left',
              }}
              title={title}
            >
              <Group justify="space-between" wrap="nowrap">
                <Text fw={500}>{title}</Text>
                {!!unread && (
                  <Badge size="sm" variant="light" data-testid="badge">
                    {unread}
                  </Badge>
                )}
              </Group>

              {r.lastMessage?.content && (
                <Text size="sm" c="dimmed" mt={4}>
                  {r.lastMessage.content}
                </Text>
              )}
            </UnstyledButton>

            {/* secondary ad after the 3rd item (idx === 2), only if free and not listOnly */}
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
