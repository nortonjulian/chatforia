import { useEffect, useState, useCallback, useMemo } from 'react';
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

import AdSlot from '@/ads/AdSlot';
import HouseAdSlot from '@/ads/HouseAdSlot';
import { PLACEMENTS } from '@/ads/placements';
import useIsPremium from '@/hooks/useIsPremium';
import { useTranslation } from 'react-i18next';
import axiosClient from '@/api/axiosClient';

export default function ChatroomsSidebar({
  onStartNewChat,
  onSelect,
  hideEmpty = false,
  activeId = null,          // active conversation id
  activeKind = null,        // 'chat' | 'sms'
  onCountChange,
  listOnly = false,
  filterQuery = '',
  __testInitialRooms,       // legacy name, still accepted
  __testInitialError,
  __testSkipLoad = false,
}) {
  const { t } = useTranslation();
  const isPremium = useIsPremium();

  const [items, setItems] = useState(__testInitialRooms ?? []);
  const [loading, setLoading] = useState(__testSkipLoad ? false : true);
  const [err, setErr] = useState(__testInitialError ?? '');

  const load = useCallback(async () => {
    if (__testSkipLoad) return;
    try {
      setLoading(true);
      setErr('');

      // ✅ Unified endpoint
      const res = await axiosClient.get('/conversations');
      const data = res?.data;

      // Accept either shape:
      // { conversations: [...] } OR { items: [...] }
      const list = Array.isArray(data?.conversations)
        ? data.conversations
        : Array.isArray(data?.items)
          ? data.items
          : [];

      setItems(list);
    } catch (e) {
      setErr(
        e?.response?.data?.error ||
          e?.response?.data?.message ||
          e?.message ||
          t('sidebar.errorLoading', 'Something went wrong')
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
    onCountChange?.(Array.isArray(items) ? items.length : 0);
  }, [items, onCountChange]);

  const q = filterQuery.trim().toLowerCase();

  const visible = useMemo(() => {
    const base = Array.isArray(items) ? items : [];
    if (!q) return base;

    return base.filter((c) => {
      const title = (c.title || '').toLowerCase();
      const snippet = (c.last?.text || '').toLowerCase();
      const phone = (c.phone || c.contactPhone || c.to || '').toLowerCase();
      return title.includes(q) || snippet.includes(q) || phone.includes(q);
    });
  }, [items, q]);

  const activeBg = useMemo(
    () => 'color-mix(in oklab, var(--mantine-color-blue-2) 22%, transparent)',
    []
  );

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
          {err}
        </Alert>
        {!listOnly && (
          <Button onClick={load}>{t('common.retry', 'Retry')}</Button>
        )}
      </Stack>
    );
  }

  if (!visible.length) {
    if (hideEmpty) return null;

    return (
      <Stack p="sm" gap="sm">
        {!listOnly && (
          <Text fw={600} aria-label="Conversations header">
            {t('sidebar.conversations', 'Conversations')}
          </Text>
        )}

        {!listOnly && !isPremium && (
          <>
            <AdSlot
              placement={PLACEMENTS.SIDEBAR_PRIMARY}
              fallback={<HouseAdSlot placement={PLACEMENTS.SIDEBAR_PRIMARY} />}
            />
            <Divider my={6} />
          </>
        )}

        <Text c="dimmed" size="sm">
          {q
            ? t('sidebar.noResults', 'No matches.')
            : t('sidebar.empty', 'No conversations yet.')}
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
          <AdSlot
            placement={PLACEMENTS.SIDEBAR_PRIMARY}
            fallback={<HouseAdSlot placement={PLACEMENTS.SIDEBAR_PRIMARY} />}
          />
          <Divider my={6} />
        </>
      )}

      {visible.map((c, idx) => {
        const title =
          c.title ||
          (c.kind === 'sms'
            ? (c.contactName ||
              c.contactPhone ||
              c.phone ||
              t('sms.thread', 'SMS'))
            : t('chat.thread', 'Chat'));

        const unread = Number(c.unreadCount || 0);

        const isActive =
          String(c.id) === String(activeId) &&
          (activeKind ? String(c.kind) === String(activeKind) : true);

        return (
          <div key={`${c.kind}:${c.id}`}>
            <UnstyledButton
              onClick={() => onSelect?.(c)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 12,
                background: isActive ? activeBg : 'transparent',
                textAlign: 'left',
                outline: 'none',
              }}
              title={title}
              aria-current={isActive ? 'true' : undefined}
              data-active={isActive ? 'true' : undefined}
            >
              <Group justify="space-between" wrap="nowrap">
                <Text fw={500} lineClamp={1}>
                  {title}
                </Text>

                {!!unread && (
                  <Badge size="sm" variant="light" data-testid="badge">
                    {unread}
                  </Badge>
                )}
              </Group>

              {!!c.last?.text && (
                <Text size="sm" c="dimmed" mt={4} lineClamp={1}>
                  {c.last.text}
                </Text>
              )}
            </UnstyledButton>

            {!listOnly && !isPremium && idx === 2 && (
              <>
                <Divider my={6} />
                <AdSlot
                  placement={PLACEMENTS.SIDEBAR_SECONDARY}
                  fallback={<HouseAdSlot placement={PLACEMENTS.SIDEBAR_SECONDARY} />}
                />
                <Divider my={6} />
              </>
            )}
          </div>
        );
      })}
    </Stack>
  );
}
