import { isMessageExpired } from '../utils/messageExpiry';
import { voiceNotePreview } from '../utils/voiceNotePreview';
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Stack,
  Skeleton,
  Text,
  Button,
  Group,
  Alert,
  Badge,
  Divider,
  ActionIcon,
  Menu as MantineMenu,
  Box,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { MoreVertical, Archive, Undo2, Trash2 } from 'lucide-react';

import AdSlot from '@/ads/AdSlot';
import HouseAdSlot from '@/ads/HouseAdSlot';
import { PLACEMENTS } from '@/ads/placements';
import useIsPaidPlan from '@/hooks/useIsPaidPlan';
import { useTranslation } from 'react-i18next';
import axiosClient from '@/api/axiosClient';
import loadEncryptionClient from '@/utils/loadEncryptionClient';

// ✅ Socket for live preview updates
import { useSocket } from '@/context/SocketContext';
import { useUser } from '@/context/UserContext';

const CACHE_KEY = 'chatforia:conversations:v1';


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
function parseThreadTime(value) {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function getThreadSortTime(thread) {
  return Math.max(
    parseThreadTime(thread?.last?.at),
    parseThreadTime(thread?.updatedAt)
  );
}

function sortThreadsNewestFirst(list) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const diff = getThreadSortTime(b) - getThreadSortTime(a);
    if (diff !== 0) return diff;

    const aId = Number(a?.id) || 0;
    const bId = Number(b?.id) || 0;
    if (aId !== bId) return bId - aId;

    return String(a?.kind || '').localeCompare(String(b?.kind || ''));
  });
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
  currentUser,
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
  const isPaidPlan = useIsPaidPlan();
  const userContext = useUser();
  const needsKeyUnlock = userContext?.needsKeyUnlock ?? false;

  /** @type {[Thread[], Function]} */
  const [items, setItems] = useState(__testInitialRooms ?? []);
  const [loading, setLoading] = useState(__testSkipLoad ? false : true);
  const [err, setErr] = useState(__testInitialError ?? '');
  const [decryptedPreviews, setDecryptedPreviews] = useState({});

  const { socket } = useSocket() ?? {};

  // ✅ Avoid stale closures in socket handlers
  const itemsRef = useRef(items);
  const loadRequestRef = useRef(0);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    let cancelled = false;

    async function decryptConversationPreviews() {
      const userId = Number(currentUser?.id);

      if (!userId) {
        if (!cancelled) setDecryptedPreviews({});
        return;
      }

      const encryptedThreads = (Array.isArray(items) ? items : []).filter((c) => {
        if (String(c?.kind) !== 'chat' || !c?.last?.messageId) return false;

        return Boolean(
          c.last?.encryptedPayloadForMe?.contentCiphertext ||
          c.last?.contentCiphertext
        );
      });

      if (!encryptedThreads.length) {
        if (!cancelled) setDecryptedPreviews({});
        return;
      }

      try {
        const mod = await loadEncryptionClient();

        let privateKey = null;

        if (
          typeof mod.getUnlockedPrivateKeyForPublicKey === 'function' &&
          currentUser?.publicKey
        ) {
          privateKey = await mod.getUnlockedPrivateKeyForPublicKey(
            currentUser.publicKey
          );
        }

        if (!privateKey && typeof mod.getUnlockedPrivateKey === 'function') {
          privateKey = await mod.getUnlockedPrivateKey();
        }

        if (!privateKey || typeof mod.decryptFetchedMessages !== 'function') {
          if (!cancelled) setDecryptedPreviews({});
          return;
        }

        const rows = encryptedThreads.map((c) => ({
          ...c.last,
          id: c.last.messageId,
        }));

        const decrypted = await mod.decryptFetchedMessages(
          rows,
          privateKey,
          null,
          userId
        );

        const next = {};

        encryptedThreads.forEach((thread, index) => {
          const text = String(
            decrypted?.[index]?.decryptedContent || ''
          ).trim();

          if (
            !text ||
            text === '[Encrypted – key unavailable]' ||
            text === '[Encrypted – could not decrypt]'
          ) {
            return;
          }

          next[
            `${thread.kind}:${thread.id}:${thread.last.messageId}`
          ] = text;
        });

        if (!cancelled) {
          setDecryptedPreviews(next);
        }
      } catch (err) {
        console.warn(
          '[ChatroomsSidebar] failed to decrypt conversation previews',
          err
        );

        if (!cancelled) {
          setDecryptedPreviews({});
        }
      }
    }

    decryptConversationPreviews();

    return () => {
      cancelled = true;
    };
  }, [
    items,
    currentUser?.id,
    currentUser?.publicKey,
    needsKeyUnlock,
  ]);

  const load = useCallback(async () => {
    if (__testSkipLoad) return;

    const requestId = ++loadRequestRef.current;
    let usedCache = false;

    try {
      setErr('');

      const cached = !itemsRef.current.length ? localStorage.getItem(CACHE_KEY) : null;
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) {
            setItems(parsed);
            setLoading(false);
            usedCache = true;
          }
        } catch {}
      }

      const res = await axiosClient.get('/conversations');
      if (requestId !== loadRequestRef.current) return;
      const data = res?.data;

      const list = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.conversations)
          ? data.conversations
          : Array.isArray(data)
            ? data
            : [];

      const sorted = sortThreadsNewestFirst(list);
      setItems(sorted);
      localStorage.setItem(CACHE_KEY, JSON.stringify(sorted));
    } catch (e) {
      if (requestId !== loadRequestRef.current) return;
      if (!usedCache) {
        setErr(
          e?.response?.data?.error ||
          e?.response?.data?.message ||
          e?.message ||
          t('sidebar.errorLoading', 'Something went wrong')
        );
      } else {
        console.warn('[ChatroomsSidebar] refresh failed, using cached conversations', e);
      }
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
}, [t, __testSkipLoad]);

  useEffect(() => {
    load();
    return () => { loadRequestRef.current += 1; };
  }, [load]);

    useEffect(() => {
    if (!socket) return;

    const roomIds = (Array.isArray(items) ? items : [])
      .filter((c) => String(c.kind) === 'chat')
      .map((c) => String(c.id))
      .filter(Boolean);

    if (!roomIds.length) return;

    const join = () => socket.emit('join:rooms', roomIds);
    if (socket.connected) join();
    socket.on('connect', join);
    return () => socket.off('connect', join);
  }, [socket, items]);

  // Reconcile a preview at its own deadline even when its thread is closed.
  const [previewExpiryTick, updateExpiryClock] = useState(0);
  useEffect(() => {
    const deadlines = items.filter((item) => item.kind === 'chat')
      .map((item) => new Date(item.last?.expiresAt ?? NaN).getTime())
      .filter((deadline) => Number.isFinite(deadline) && deadline > Date.now());
    if (!deadlines.length) return;
    const timer = setTimeout(() => {
      updateExpiryClock((value) => value + 1);
      load();
    }, Math.min(2_147_483_647, Math.max(1, Math.min(...deadlines) - Date.now())));
    return () => clearTimeout(timer);
  }, [items, load, previewExpiryTick]);

  useEffect(() => {
    const handler = () => load();
    window.addEventListener('sidebar:reload-rooms', handler);
    return () => window.removeEventListener('sidebar:reload-rooms', handler);
  }, [load]);

  useEffect(() => {
    onCountChange?.(Array.isArray(items) ? items.length : 0);
  }, [items, onCountChange]);

  useEffect(() => {
    try {
      if (Array.isArray(items)) {
        localStorage.setItem(CACHE_KEY, JSON.stringify(items));
      }
    } catch {}
  }, [items]);

  const q = filterQuery.trim().toLowerCase();

  const visible = useMemo(() => {
    const base = sortThreadsNewestFirst(Array.isArray(items) ? items : []);
    if (!q) return base;

    return base.filter((c) => {
      const title = (c.title || c.displayName || '').toLowerCase();
      const previewKey = c?.last?.messageId
        ? `${c.kind}:${c.id}:${c.last.messageId}`
        : null;
      const snippet = isMessageExpired(c.last) ? '' : String(
        voiceNotePreview(
          (previewKey && decryptedPreviews[previewKey]) || formatLastPreview(c.last, t), t
        )
      ).toLowerCase();
      const phone = (c.phone || '').toLowerCase();
      return title.includes(q) || snippet.includes(q) || phone.includes(q);
    });
  }, [items, q, t, decryptedPreviews, previewExpiryTick]);

  const showTransportBadges =
    items.some((c) => c.kind === 'sms') &&
    items.some((c) => c.kind === 'chat');

  const activeBg = useMemo(
    () => 'color-mix(in oklab, var(--mantine-color-blue-2) 22%, transparent)',
    []
  );

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

  const deleteConversation = useCallback(
  async (c) => {
    const kind = c.kind;
    const id = c.id;

    const prevItems = itemsRef.current || [];

    // optimistic remove
    setItems((prev) =>
      (Array.isArray(prev) ? prev : []).filter(
        (x) => !(String(x.kind) === String(kind) && String(x.id) === String(id))
      )
    );

    try {
      await axiosClient.delete(
        `/conversations/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`
      );

      notifications.show({
        title: t('sidebar.deletedTitle', 'Conversation deleted'),
        message: t('sidebar.deletedMsg', 'The conversation was removed from your list.'),
        color: 'red',
      });
    } catch (e) {
      console.error('Delete conversation failed', e);

      // rollback
      setItems(prevItems);

      notifications.show({
        title: t('sidebar.deleteFailedTitle', 'Could not delete conversation'),
        message: t('sidebar.deleteFailedMsg', 'Please try again.'),
        color: 'red',
      });
    }
  },
  [t]
);

  /* ---------------- authoritative live conversation state ---------------- */

  useEffect(() => {
    if (__testSkipLoad || !socket) return;
    let timer;
    // Upserts also carry edits, receipts and duplicate delivery aliases.
    // Recount on the server instead of treating every event as a new message.
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => load(), 120);
    };
    const events = [
      'message:upsert', 'message:new', 'receive:message',
      'message:edited', 'message:deleted', 'message_read', 'message:read',
      'message:expired', 'message_expired',
      'connect',
    ];
    events.forEach((event) => socket.on(event, refresh));
    // The transport may have connected before this component subscribed.
    if (socket.connected) refresh();
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(timer);
      events.forEach((event) => socket.off(event, refresh));
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [socket, load, __testSkipLoad]);

  /* ---------------- UI states ---------------- */

  if (loading) {
    return (
      <Stack p="sm" gap="sm">
        {!listOnly && (
          <Text fw={600} aria-label="Chats header">
            {t('sidebar.chats', 'Chats')}
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
          <Text fw={600} aria-label="Chats header">
            {t('sidebar.chats', 'Chats')}
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

        {!isPaidPlan && (
          <>
            <AdSlot
              placement={PLACEMENTS.SIDEBAR_PRIMARY}
              fallback={<HouseAdSlot placement={PLACEMENTS.SIDEBAR_PRIMARY} />}
            />
            <Divider my={6} />
          </>
        )}

        <Text c="dimmed" size="sm">
          {q ? t('sidebar.noResults', 'No matches.') : t('sidebar.empty', 'No chats yet.')}
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

      {visible.map((c, idx) => {
        // ✅ "SMS #123" guard so we don’t show junk titles if we have a better fallback
        const rawTitle = String(c.title || '').trim();
        const looksLikeAutoSmsTitle =
          String(c.kind) === 'sms' && /^sms\s*#\s*\d+$/i.test(rawTitle);

        function getBetterTitle(c) {
          const display = String(c.displayName || '').trim();
          const raw = String(c.title || '').trim();

          return (
            display ||
            raw ||
            (c.kind === 'sms'
              ? c.phone || t('sms.thread', 'SMS')
              : t('chat.unknownThread', 'Unknown chat'))
          );
        }

        const title = getBetterTitle(c);
        const unread = Number(c.unreadCount || 0);

        const isActive =
          String(c.id) === String(activeId) &&
          (activeKind ? String(c.kind) === String(activeKind) : true);

        const previewKey = c?.last?.messageId
          ? `${c.kind}:${c.id}:${c.last.messageId}`
          : null;
        const lastPreview = isMessageExpired(c.last) ? '' : voiceNotePreview(
          (previewKey && decryptedPreviews[previewKey]) || formatLastPreview(c.last, t), t
        );

        return (
          <div key={`${c.kind}:${c.id}`} className="sidebar-row">
            <Box
              onClick={() => {
                console.log('[ChatroomsSidebar] clicked conversation row:', c);
                onSelect?.(c);
              }}
              style={{
                width: '100%',
                padding: '18px 14px',
                minHeight: 82,
                borderRadius: 12,
                borderBottom: '1px solid var(--mantine-color-gray-2)',
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
                    <Group gap={6} wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                      <Text fw={500} lineClamp={1} style={{ minWidth: 0 }}>
                        {title}
                      </Text>
                      {showTransportBadges && (
                      <Badge
                        size="xs"
                        variant="light"
                        radius="sm"
                        data-transport={c.kind}
                        style={{ flexShrink: 0 }}
                      >
                        {c.kind === 'sms'
                          ? t('conversation.transport.sms', 'SMS')
                          : t('conversation.transport.chatforia', 'Chatforia')}
                      </Badge>
                      )}
                    </Group>

                    <Group gap={8} wrap="nowrap" style={{ flexShrink: 0 }}>
                      {!!unread && (
                        <Badge
                          size="sm"
                          variant="light"
                          data-testid="badge"
                          style={{ flexShrink: 0, minWidth: 'max-content' }}
                          styles={{ label: { overflow: 'visible', textOverflow: 'clip' } }}
                        >
                          {unread}
                        </Badge>
                      )}

                      {Number(c?.last?.mediaCount || 0) > 1 && (
                        <Badge size="sm" variant="light">
                          {t('messages.mediaCount', '{{count}}', { count: c.last.mediaCount })}
                        </Badge>
                      )}

                      <MantineMenu position="bottom-end" withinPortal shadow="md" radius="md">
                        <MantineMenu.Target>
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
                        </MantineMenu.Target>

                        <MantineMenu.Dropdown
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          <MantineMenu.Divider />

                          <MantineMenu.Item
                            color="red"
                            leftSection={<Trash2 size={16} />}
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteConversation(c);
                            }}
                          >
                            {t('sidebar.deleteConversation', 'Delete conversation')}
                          </MantineMenu.Item>
                        </MantineMenu.Dropdown>
                      </MantineMenu>
                    </Group>
                  </Group>

                  {!!lastPreview && (
                    <Text size="sm" c="dimmed" mt={4} lineClamp={1}>
                      {lastPreview}
                    </Text>
                  )}
                </Box>
              </Group>
            </Box>

            {!isPaidPlan && idx === 2 && (
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
