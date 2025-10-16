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
import { IconMessagePlus } from '@tabler/icons-react';
import axiosClient from '../api/axiosClient';

import AdSlot from '@/ads/AdSlot';
import { PLACEMENTS } from '@/ads/placements';
import useIsPremium from '@/hooks/useIsPremium';

export default function ChatroomsSidebar({
  onStartNewChat,
  onSelect,
  hideEmpty = false,
  activeRoomId = null,
  onCountChange, // ⬅️ NEW: let parent (Sidebar) know how many rooms there are
}) {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const isPremium = useIsPremium();

  useEffect(() => {
    let mounted = true;
    const ctrl = new AbortController();

    (async () => {
      try {
        setLoading(true);
        setErr('');
        const res = await axiosClient.get('/rooms', { signal: ctrl.signal });
        if (!mounted) return;
        const data = res?.data;
        const list = Array.isArray(data) ? data : (data?.rooms || []);
        setRooms(list);
      } catch (e) {
        if (!mounted) return;
        if (e.name !== 'CanceledError') {
          setErr(
            e?.response?.data?.error ||
              e?.response?.data?.message ||
              e?.message ||
              'Failed to load chats'
          );
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
      ctrl.abort();
    };
  }, []);

  // 🔔 Report room count to parent whenever it changes
  useEffect(() => {
    onCountChange?.(Array.isArray(rooms) ? rooms.length : 0);
  }, [rooms, onCountChange]);

  /* ---------- Loading ---------- */
  if (loading) {
    return (
      <Stack p="sm" gap="sm">
        <Text fw={600}>Chatrooms</Text>
        {/* No ads in loading to keep the UI calm */}
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
        <Text fw={600}>Chatrooms</Text>
        {/* No ads in error state */}
        <Alert color="red" variant="light">{err}</Alert>
        <Button onClick={() => window.location.reload()}>Retry</Button>
      </Stack>
    );
  }

  /* ---------- Empty list ---------- */
  if (!rooms.length) {
    if (hideEmpty) return null;
    return (
      <Stack p="sm" gap="sm">
        <Text fw={600}>Chatrooms</Text>

        <Text c="dimmed" size="sm">No conversations yet.</Text>
        <Button leftSection={<IconMessagePlus size={16} />} onClick={onStartNewChat}>
          New chat
        </Button>

        {/* ⛔️ Removed the “New Chat” house promo/ad to avoid duplicate CTA.
            Sidebar will show the Go Premium card in empty state instead. */}
      </Stack>
    );
  }

  /* ---------- Populated list ---------- */
  return (
    <Stack p="sm" gap="xs">
      <Text fw={600}>Chatrooms</Text>

      {/* Keep a single sidebar ad only once there are chats */}
      {!isPremium && (
        <>
          <AdSlot placement={PLACEMENTS.SIDEBAR_PRIMARY} />
          <Divider my={6} />
        </>
      )}

      {rooms.map((r, idx) => {
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

            {/* Secondary sidebar ad after a few items (free only) */}
            {!isPremium && idx === 2 && (
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
