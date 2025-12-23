import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
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
  ActionIcon,
  Menu,
  Box,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { MoreVertical, Archive, Undo2 } from 'lucide-react';

import AdSlot from '@/ads/AdSlot';
import HouseAdSlot from '@/ads/HouseAdSlot';
import { PLACEMENTS } from '@/ads/placements';
import useIsPremium from '@/hooks/useIsPremium';
import { useTranslation } from 'react-i18next';
import axiosClient from '@/api/axiosClient';

// ✅ Socket for live preview updates
import socket from '@/lib/socket';

/**
 * Thread shape (JS + JSDoc for editor hints)
 * @typedef {'chat'|'sms'} ThreadKind
 * @typedef {'image'|'video'|'audio'|'file'} MediaKind
 * @typedef {Object} ThreadLast
 * @property {string=} text
 * @property {(string|number)=} messageId
 * @property {string=} at
 * @property {boolean=} hasMedia
 * @property {number=} mediaCount
 * @property {MediaKind[]=} mediaKinds
 * @property {(string|null)=} thumbUrl
 *
 * @typedef {Object} Thread
 * @property {ThreadKind} kind
 * @property {string|number} id
 * @property {string=} title
 * @property {string=} displayName
 * @property {(string|null)=} updatedAt
 * @property {boolean=} isGroup
 * @property {number=} unreadCount
 * @property {ThreadLast=} last
 * @property {(string|null)=} avatarUrl
 * @property {(string|null)=} phone
 */

/* ---------------- payload helpers ---------------- */

function getChatRoomIdFromPayload(payload) {
  return (
    payload?.chatRoomId ??
    payload?.chatroomId ??
    payload?.roomId ??
    payload?.chatRoom?.id ??
    payload?.chatroom?.id ??
    payload?.message?.chatRoomId ??
    payload?.message?.chatroomId ??
    payload?.message?.roomId ??
    null
  );
}

function getMessageIdFromPayload(payload) {
  return payload?.messageId ?? payload?.id ?? payload?.message?.id ?? null;
}

function getTextFromPayload(payload) {
  return (
    payload?.rawContent ??
    payload?.content ??
    payload?.text ??
    payload?.message?.rawContent ??
    payload?.message?.content ??
    payload?.message?.text ??
    ''
  );
}

function isDeleteForAll(payload) {
  return (
    Boolean(payload?.deletedForAll) ||
    payload?.mode === 'all' ||
    payload?.scope === 'all' ||
    payload?.deleteForAll === true
  );
}

/**
 * Try to infer media info from a socket payload (for MMS + attachments).
 * Works if payload contains any of:
 * - media: [{ kind, url, thumbUrl }]
 * - attachments: [{ mimeType, url, thumbUrl }]
 * - message.media / message.attachments
 */
function getMediaFromPayload(payload) {
  const list =
    payload?.media ||
    payload?.attachments ||
    payload?.message?.media ||
    payload?.message?.attachments ||
    [];

  if (!Array.isArray(list) || list.length === 0) {
    return {
      hasMedia: false,
      mediaCount: 0,
      mediaKinds: [],
      thumbUrl: null,
    };
  }

  const kinds = [];
  let thumbUrl = null;

  for (const item of list) {
    const k =
      item?.kind ||
      (typeof item?.mimeType === 'string'
        ? item.mimeType.startsWith('image/')
          ? 'image'
          : item.mimeType.startsWith('video/')
            ? 'video'
            : item.mimeType.startsWith('audio/')
              ? 'audio'
              : 'file'
        : null);

    if (k && !kinds.includes(k)) kinds.push(k);

    if (!thumbUrl) {
      thumbUrl = item?.thumbUrl || item?.thumbnailUrl || item?.url || null;
    }
  }

  return {
    hasMedia: true,
    mediaCount: list.length,
    mediaKinds: kinds,
    thumbUrl,
  };
}

function formatLastPreview(last, t) {
  if (!last) return '';

  const text = String(last.text || '').trim();
  const hasMedia =
    Boolean(last.hasMedia) ||
    (Array.isArray(last.mediaKinds) && last.mediaKinds.length);

  if (text) return text;

  if (!hasMedia) return '';

  // MMS / attachments with empty body: show a friendly placeholder
  const kinds = Array.isArray(last.mediaKinds) ? last.mediaKinds : [];
  if (kinds.includes('image')) return t('messages.mediaPhoto', '📷 Photo');
  if (kinds.includes('video')) return t('messages.mediaVideo', '🎥 Video');
  if (kinds.includes('audio')) return t('messages.mediaAudio', '🎙️ Audio');
  return t('messages.mediaFile', '📎 Attachment');
}

/* ---------------- component ---------------- */

export default function ChatroomsSidebar({
  onStartNewChat,
  onSelect,
  hideEmpty = false,
  activeId = null,
  activeKind = null,
  onCountChange,
  listOnly = false,
  filterQuery = '',
  __testInitialRooms,
  __testInitialError,
  __testSkipLoad = false,
}) {
  const { t } = useTranslation();
  const isPremium = useIsPremium();

  /** @type {[Thread[], Function]} */
  const [items, setItems] = useState(__testInitialRooms ?? []);
  const [loading, setLoading] = useState(__testSkipLoad ? false : true);
  const [err, setErr] = useState(__testInitialError ?? '');

  // ✅ Avoid stale closures in socket handlers
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const load = useCallback(async () => {
    if (__testSkipLoad) return;
    try {
      setLoading(true);
      setErr('');

      // Expected server shape (recommended):
      // { items: Thread[] } OR { conversations: Thread[] }
      const res = await axiosClient.get('/conversations');
      const data = res?.data;

      const list = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.conversations)
          ? data.conversations
          : Array.isArray(data)
            ? data
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
      const title = (c.title || c.displayName || '').toLowerCase();
      const snippet = formatLastPreview(c.last, t).toLowerCase();
      const phone = (c.phone || '').toLowerCase();
      return title.includes(q) || snippet.includes(q) || phone.includes(q);
    });
  }, [items, q, t]);

  const activeBg = useMemo(
    () => 'color-mix(in oklab, var(--mantine-color-blue-2) 22%, transparent)',
    []
  );

  // ✅ patch a single conversation in-place
  const patchConversation = useCallback((kind, id, patchFn) => {
    setItems((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      const idx = list.findIndex(
        (c) => String(c.kind) === String(kind) && String(c.id) === String(id)
      );
      if (idx === -1) return prev;

      const next = list.slice();
      next[idx] = patchFn(next[idx]);
      return next;
    });
  }, []);

  // ✅ move convo to top (UI ordering)
  const bumpToTop = useCallback((kind, id) => {
    setItems((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      const idx = list.findIndex(
        (c) => String(c.kind) === String(kind) && String(c.id) === String(id)
      );
      if (idx <= 0) return prev;

      const next = list.slice();
      const [row] = next.splice(idx, 1);
      next.unshift(row);
      return next;
    });
  }, []);

  /* ---------------- archive (thread delete UX) ---------------- */

  const archiveConversation = useCallback(
    async (c, archived) => {
      const kind = c.kind;
      const id = c.id;

      // Optimistic behavior:
      // - archiving: remove from list immediately
      // - unarchiving: reload (server sorts)
      if (archived) {
        setItems((prev) =>
          (Array.isArray(prev) ? prev : []).filter(
            (x) => !(String(x.kind) === String(kind) && String(x.id) === String(id))
          )
        );
      }

      try {
        await axiosClient.patch(
          `/conversations/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/archive`,
          { archived }
        );

        if (!archived) load();
      } catch (e) {
        console.error('Archive failed', e);
        load();

        notifications.show({
          title: t('sidebar.archiveFailedTitle', 'Could not archive'),
          message: t('sidebar.archiveFailedMsg', 'Please try again.'),
          color: 'red',
        });
      }
    },
    [load, t]
  );

  const archiveWithUndo = useCallback(
    (c) => {
      const notifId = `archived:${c.kind}:${c.id}:${Date.now()}`;

      // Fire-and-forget so UX feels instant
      archiveConversation(c, true);

      notifications.show({
        id: notifId,
        title: t('sidebar.archivedTitle', 'Conversation archived'),
        autoClose: 4500,
        withCloseButton: true,
        icon: <Archive size={16} />,
        message: (
          <Group justify="space-between" gap="sm" wrap="nowrap">
            <Text size="sm" c="dimmed" lineClamp={2}>
              {t('sidebar.archivedMsg', 'You can undo this action.')}
            </Text>
            <Button
              variant="light"
              size="xs"
              leftSection={<Undo2 size={14} />}
              onClick={() => {
                notifications.hide(notifId);
                archiveConversation(c, false);
              }}
            >
              {t('common.undo', 'Undo')}
            </Button>
          </Group>
        ),
      });
    },
    [archiveConversation, t]
  );

  /* ---------------- live updates: message preview ---------------- */

  useEffect(() => {
    if (__testSkipLoad) return;

    // 1) New messages update preview + unread + ordering
    const onReceiveMessage = (payload) => {
      const roomId = getChatRoomIdFromPayload(payload);
      if (!roomId) return;

      // Only app-chat conversations in this pipeline
      const kind = 'chat';

      const text = getTextFromPayload(payload) || '';
      const messageId = getMessageIdFromPayload(payload);
      const media = getMediaFromPayload(payload);

      const safeText =
        text ||
        (media?.hasMedia
          ? media.mediaKinds?.includes('image')
            ? t('messages.mediaPhoto', '📷 Photo')
            : media.mediaKinds?.includes('video')
              ? t('messages.mediaVideo', '🎥 Video')
              : media.mediaKinds?.includes('audio')
                ? t('messages.mediaAudio', '🎙️ Audio')
                : t('messages.mediaFile', '📎 Attachment')
          : '');

      const isActive =
        String(activeKind || 'chat') === 'chat' && String(activeId) === String(roomId);

      const existing = (itemsRef.current || []).some(
        (c) => String(c.kind) === kind && String(c.id) === String(roomId)
      );
      if (!existing) {
        load();
        return;
      }

      patchConversation(kind, roomId, (c) => {
        const unreadCount = Number(c.unreadCount || 0);

        return {
          ...c,
          updatedAt:
            payload?.createdAt || payload?.at || payload?.message?.createdAt || c.updatedAt,
          last: {
            ...(c.last || {}),
            text: safeText,
            messageId: messageId ?? c.last?.messageId,
            at: payload?.createdAt || payload?.at || payload?.message?.createdAt || c.last?.at,
            ...media,
          },
          unreadCount: isActive ? unreadCount : unreadCount + 1,
        };
      });

      bumpToTop(kind, roomId);
    };

    // 2) Edit: update preview only if edited msg is currently shown as last
    const onMessageEdited = (payload) => {
      const roomId = getChatRoomIdFromPayload(payload);
      const messageId = getMessageIdFromPayload(payload);
      const text = getTextFromPayload(payload);
      const media = getMediaFromPayload(payload);

      const safeText =
        text ||
        (media?.hasMedia
          ? media.mediaKinds?.includes('image')
            ? t('messages.mediaPhoto', '📷 Photo')
            : media.mediaKinds?.includes('video')
              ? t('messages.mediaVideo', '🎥 Video')
              : media.mediaKinds?.includes('audio')
                ? t('messages.mediaAudio', '🎙️ Audio')
                : t('messages.mediaFile', '📎 Attachment')
          : '');

      if (!messageId) return;

      if (!roomId) {
        load();
        return;
      }

      patchConversation('chat', roomId, (c) => {
        const lastId = c?.last?.messageId ?? null;
        if (!lastId || String(lastId) !== String(messageId)) return c;

        return {
          ...c,
          last: {
            ...(c.last || {}),
            // ✅ prefer safeText so edited media-only messages still show placeholders
            text: safeText,
            ...media,
          },
        };
      });
    };

    // 3) Delete:
    //    - delete-for-all: preview becomes "Message deleted" (if last)
    //    - delete-for-me: if last, reload so server picks next visible "last"
    const onMessageDeleted = (payload) => {
      const roomId = getChatRoomIdFromPayload(payload);
      const messageId = getMessageIdFromPayload(payload);
      const delAll = isDeleteForAll(payload);

      if (!messageId) return;

      if (!roomId) {
        load();
        return;
      }

      const convo = (itemsRef.current || []).find(
        (c) => String(c.kind) === 'chat' && String(c.id) === String(roomId)
      );
      const lastId = convo?.last?.messageId ?? null;

      if (!lastId || String(lastId) !== String(messageId)) return;

      if (delAll) {
        patchConversation('chat', roomId, (c) => ({
          ...c,
          last: {
            ...(c.last || {}),
            text: t('messages.deletedPreview', 'Message deleted'),
            hasMedia: false,
            mediaCount: 0,
            mediaKinds: [],
            thumbUrl: null,
          },
        }));
      } else {
        load();
      }
    };

    socket.on('receive_message', onReceiveMessage);
    socket.on('message_edited', onMessageEdited);
    socket.on('message_deleted', onMessageDeleted);

    return () => {
      socket.off('receive_message', onReceiveMessage);
      socket.off('message_edited', onMessageEdited);
      socket.off('message_deleted', onMessageDeleted);
    };
  }, [activeId, activeKind, load, patchConversation, bumpToTop, t, __testSkipLoad]);

  /* ---------------- UI states ---------------- */

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
        {!listOnly && <Button onClick={load}>{t('common.retry', 'Retry')}</Button>}
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
          {q ? t('sidebar.noResults', 'No matches.') : t('sidebar.empty', 'No conversations yet.')}
        </Text>

        {!listOnly && (
          <Button onClick={onStartNewChat}>{t('sidebar.startChat', 'Start a new chat')}</Button>
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
        // ✅ "SMS #123" guard so we don’t show junk titles if we have a better fallback
        const rawTitle = String(c.title || '').trim();
        const looksLikeAutoSmsTitle =
          String(c.kind) === 'sms' && /^sms\s*#\s*\d+$/i.test(rawTitle);

        const title =
          // prefer server-provided friendly name if present
          String(c.displayName || '').trim() ||
          // if server sent "SMS #id", ignore it and fall back to phone
          (!looksLikeAutoSmsTitle ? rawTitle : '') ||
          (c.kind === 'sms'
            ? c.phone || t('sms.thread', 'SMS')
            : t('chat.thread', 'Chat'));

        const unread = Number(c.unreadCount || 0);

        const isActive =
          String(c.id) === String(activeId) &&
          (activeKind ? String(c.kind) === String(activeKind) : true);

        const lastPreview = formatLastPreview(c.last, t);

        return (
          <div key={`${c.kind}:${c.id}`} className="sidebar-row">
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
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <Box style={{ minWidth: 0, flex: 1 }}>
                  <Group justify="space-between" wrap="nowrap" align="center">
                    <Text fw={500} lineClamp={1} style={{ minWidth: 0 }}>
                      {title}
                    </Text>

                    <Group gap={8} wrap="nowrap">
                      {!!unread && (
                        <Badge size="sm" variant="light" data-testid="badge">
                          {unread}
                        </Badge>
                      )}

                      {Number(c?.last?.mediaCount || 0) > 1 && (
                        <Badge size="sm" variant="light">
                          {t('messages.mediaCount', '{{count}}', { count: c.last.mediaCount })}
                        </Badge>
                      )}

                      {/* Desktop ⋯ menu */}
                      {!listOnly && (
                        <Menu position="bottom-end" withinPortal shadow="md" radius="md">
                          <Menu.Target>
                            <ActionIcon
                              variant="subtle"
                              aria-label={t('sidebar.more', 'More')}
                              title={t('sidebar.more', 'More')}
                              className="sidebar-row-more"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                              }}
                            >
                              <MoreVertical size={18} />
                            </ActionIcon>
                          </Menu.Target>

                          <Menu.Dropdown
                            onClick={(e) => {
                              e.stopPropagation();
                            }}
                          >
                            <Menu.Item
                              leftSection={<Archive size={16} />}
                              onClick={(e) => {
                                e.stopPropagation();
                                archiveWithUndo(c);
                              }}
                            >
                              {t('sidebar.archive', 'Archive')}
                            </Menu.Item>

                            {/* Optional later:
                            <Menu.Divider />
                            <Menu.Item color="red" leftSection={<Trash2 size={16} />}>
                              Delete thread…
                            </Menu.Item>
                            */}
                          </Menu.Dropdown>
                        </Menu>
                      )}
                    </Group>
                  </Group>

                  {!!lastPreview && (
                    <Text size="sm" c="dimmed" mt={4} lineClamp={1}>
                      {lastPreview}
                    </Text>
                  )}
                </Box>
              </Group>
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

      {/* Scoped CSS: make ⋯ visible on hover + focus (desktop) */}
      <style>{`
        .sidebar-row .sidebar-row-more {
          opacity: 0.25;
          transition: opacity 120ms ease;
        }
        .sidebar-row:hover .sidebar-row-more,
        .sidebar-row:focus-within .sidebar-row-more {
          opacity: 1;
        }
      `}</style>
    </Stack>
  );
}
