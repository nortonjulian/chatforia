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
import { useTranslation } from 'react-i18next';

export default function ChatroomsSidebar({
  onStartNewChat,
  onSelect,
  hideEmpty = false,
  activeRoomId = null,
  onCountChange,
  listOnly = false,        // suppress header/ads/CTA when embedded in Sidebar
  filterQuery = '',        // client-side filter text
  __testInitialRooms,
  __testInitialError,
  __testSkipLoad = false,
}) {
  const { t } = useTranslation();
  const [rooms, setRooms] = useState(__testInitialRooms ?? []);
  const [loading, setLoading] = useState(__testSkipLoad ? false : true);
  const [err, setErr] = useState(__testInitialError ?? '');
  const isPremium = useIsPremium();

  const load = useCallback(async () => {
    if (__testSkipLoad) return;
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
          t('sidebar.errorLoading')
      );
    } finally {
      setLoading(false);
    }
  }, [t, __testSkipLoad]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const handler = () => load();
    window.addEventListener('sidebar:reload-rooms', handler);
    return () => window.removeEventListener('sidebar:reload-rooms', handler);
  }, [load]);

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

  if (loading) {
    return (
      <Stack p="sm" gap="sm">
        {!listOnly && (
          <Text fw={600} aria-label="Conversations header">
            {t('sidebar.conversations', 'Conversations')}
          </Text>
        )}
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} height={46} radius="md" />
        ))}
      </Stack>
    );
  }

  if (err) {
    return (
      <Stack p="sm" gap="sm">
        {!listOnly && (
          <Text fw={600} aria-label="Conversations header">
            {t('sidebar.conversations', 'Conversations')}
          </Text>
        )}
        <Alert color="red" variant="light">
          {err || t('sidebar.errorLoading', 'Something went wrong')}
        </Alert>
        {!listOnly && (
          <Button onClick={load}>
            {t('common.retry', 'Retry')}
          </Button>
        )}
      </Stack>
    );
  }

  if (!visibleRooms.length) {
    if (hideEmpty) return null;
    return (
      <Stack p="sm" gap="sm">
        {!listOnly && (
          <Text fw={600} aria-label="Conversations header">
            {t('sidebar.conversations', 'Conversations')}
          </Text>
        )}
        <Text c="dimmed" size="sm">
          {t('sidebar.empty', 'No conversations yet.')}
        </Text>
        {!listOnly && (
          <Button onClick={onStartNewChat}>
            {t('sidebar.startChat', 'Start a new chat')}
          </Button>
        )}
      </Stack>
    );
  }

  return (
    <Stack p="sm" gap="xs">
      {!listOnly && (
        <Text fw={600} aria-label="Conversations header">
          {t('sidebar.conversations', 'Conversations')}
        </Text>
      )}

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
