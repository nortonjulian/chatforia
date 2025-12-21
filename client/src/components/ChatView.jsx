import { useEffect, useRef, useState, useMemo } from 'react';
import clsx from 'clsx';
import {
  Box,
  Group,
  Avatar,
  Paper,
  Text,
  Button,
  Menu,
  Divider,
  Stack,
  ScrollArea,
  Title,
  Badge,
  ActionIcon,
  Tooltip,
  Skeleton,
} from '@mantine/core';
import {
  IconSettings,
  IconUserPlus,
  IconInfoCircle,
  IconSearch,
  IconPhoto,
  IconRotateClockwise,
  IconDice5,
  IconDotsVertical,
  IconCalendarPlus,
  IconSparkles,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import ReactionBar from './ReactionBar.jsx';
import EventSuggestionBar from './EventSuggestionBar.jsx';
import TranslatedText from './chat/TranslatedText.jsx';
import socket from '../lib/socket';
import { isOutgoingMessage, isSystemMessage } from '../utils/messageDirection.js';
import { decryptFetchedMessages, getUnlockedPrivateKey } from '../utils/encryptionClient';
import ThreadComposer from '@/threads/ThreadComposer.jsx';
import ThreadShell from '../threads/ThreadShell.jsx';
import axiosClient from '../api/axiosClient';
import MessageInput from './MessageInput';

import '@/styles.css';

// ✅ Smart Replies
import SmartReplyBar from './SmartReplyBar.jsx';
import { useSmartReplies } from '../hooks/useSmartReplies.js';

// ✅ Prefs cache (IndexedDB)
import { getPref, setPref, PREF_SMART_REPLIES } from '../utils/prefsStore';

// ✅ Local message cache for search/media
import { addMessages } from '../utils/messagesStore';

// ✅ Modals
import RoomSettingsModal from './RoomSettingsModal.jsx';
import RoomInviteModal from './RoomInviteModal.jsx';
import RoomAboutModal from './RoomAboutModal.jsx';
import RoomSearchDrawer from './RoomSearchDrawer.jsx';
import MediaGalleryModal from './MediaGalleryModal.jsx';

import { playSound } from '../lib/sounds.js';

// 🔒 Premium check
import useIsPremium from '@/hooks/useIsPremium';

// 🧱 Ads (render only for Free users)
import { CardAdWrap } from '@/ads/AdWrappers';
import AdSlot from '@/ads/AdSlot';
import HouseAdSlot from '@/ads/HouseAdSlot';
import { PLACEMENTS } from '@/ads/placements';
import { useAds } from '@/ads/AdProvider';

import { ADS_CONFIG } from '@/ads/config';

// 🔊 Voice notes (audio)
import AudioMessage from '@/messages/AudioMessage.jsx';

// 🌊 Waveform bar for audio attachments
import WaveformBar from '@/components/WaveformBar.jsx';

/* ---------- layout constants ---------- */
/**
 * IMPORTANT:
 * - We no longer constrain ChatView to CONTENT_MAX.
 * - The thread should span the full center panel width (between conversations + ads).
 * - Message bubbles still keep their own maxWidth for readability.
 */
// const CONTENT_MAX = 900;

/* ---------- helpers ---------- */
function getTimeLeftString(expiresAt) {
  const now = Date.now();
  const expires = new Date(expiresAt).getTime();
  const diff = expires - now;
  if (diff <= 0) return 'Expired';
  const seconds = Math.floor(diff / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins > 0 ? `${mins}m ` : ''}${secs}s`;
}

function useNow(interval = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}

/** Dismiss & remember for N days (localStorage) */
function useDismissed(key, days = 14) {
  const storageKey = `dismiss:${key}`;
  const [dismissed, setDismissed] = useState(() => {
    const until = Number(localStorage.getItem(storageKey) || 0);
    return Date.now() < until;
  });
  const dismiss = () => {
    localStorage.setItem(
      storageKey,
      String(Date.now() + days * 24 * 60 * 60 * 1000)
    );
    setDismissed(true);
  };
  return [dismissed, dismiss];
}

/* ---------- component ---------- */
export default function ChatView({ chatroom, currentUserId, currentUser }) {
  const isPremium = useIsPremium();

  const [messages, setMessages] = useState([]); // oldest → newest
  const [typingUser, setTypingUser] = useState('');
  const [showNewMessage, setShowNewMessage] = useState(false);

  // pagination state
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);

  // privacy UI state
  const [reveal, setReveal] = useState(false);

  // ⚙️ Room settings modal
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ➕ Room invite modal
  const [inviteOpen, setInviteOpen] = useState(false);

  // ℹ️ About / 🔎 Search / 🖼️ Gallery
  const [aboutOpen, setAboutOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);

  const [draft, setDraft] = useState('');

  // 📅 Optional: force a specific message's text into the thread-level calendar modal
  const [forcedCalendarText, setForcedCalendarText] = useState(null);

  if (import.meta.env.DEV) {
    console.log('[ChatView] PLACEMENTS', PLACEMENTS);
    console.log('[ChatView] isPremium', isPremium);
  }

  const isOwnerOrAdmin =
    currentUser?.role === 'ADMIN' || currentUser?.id === chatroom?.ownerId;

  // 🎲 Random badge
  const isRandomRoom = Boolean(
    chatroom?.isRandom ||
      chatroom?.origin === 'random' ||
      chatroom?.randomChatRoomId ||
      (Array.isArray(chatroom?.tags) && chatroom.tags.includes('random'))
  );

  // ✅ Smart Replies toggle (single source of truth)
  const [smartEnabled, setSmartEnabled] = useState(
    () => currentUser?.enableSmartReplies ?? false
  );

  useEffect(() => {
    (async () => {
      if (currentUser?.enableSmartReplies !== undefined) {
        const v = !!currentUser.enableSmartReplies;
        setSmartEnabled(v);
        await setPref(PREF_SMART_REPLIES, v);
      } else {
        const cached = await getPref(PREF_SMART_REPLIES, false);
        setSmartEnabled(!!cached);
      }
    })();
  }, [currentUser?.enableSmartReplies]);

  const messagesEndRef = useRef(null);
  const scrollViewportRef = useRef(null);
  const now = useNow();
  const navigate = useNavigate();

  // Ads context (caps / cool-downs)
  const ads = useAds();
  const canShow = ads?.canShow || (() => true);
  const markShown = ads?.markShown || (() => {});

  // Center-panel empty-state promo control
  const [emptyDismissed] = useDismissed('empty_state_promo', 14);
  const shouldShowEmptyPromo =
    !chatroom &&
    !isPremium &&
    !emptyDismissed &&
    canShow(PLACEMENTS.EMPTY_STATE_PROMO, 'app');

  useEffect(() => {
    if (shouldShowEmptyPromo) markShown(PLACEMENTS.EMPTY_STATE_PROMO, 'app');
  }, [shouldShowEmptyPromo, markShown]);

  const handleEditMessage = async (msg) => {
    const newText = prompt('Edit:', msg.rawContent || msg.content);
    if (!newText || newText === msg.rawContent) return;

    try {
      const { data: updated } = await axiosClient.patch(
        `/messages/${msg.id}/edit`,
        { newContent: newText }
      );
      setMessages((prev) =>
        prev.map((m) =>
          m.id === updated.id
            ? { ...m, rawContent: newText, content: newText }
            : m
        )
      );
    } catch (error) {
      console.error('Message edit failed', error);
    }
  };

  const scrollToBottomNow = (behavior = 'auto') => {
  const v = scrollViewportRef.current;
  if (v) {
    // make the ScrollArea viewport the scroll owner
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        v.scrollTop = v.scrollHeight;
      });
    });
  } else {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }
  setShowNewMessage(false);
};

// keep existing name if you want
const scrollToBottom = () => scrollToBottomNow('smooth');


  // --- Pagination loader (initial + older pages) ---
  async function loadMore(initial = false) {
    if (!chatroom?.id || loading) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', initial ? '50' : '30');
      if (!initial && cursor) params.set('cursor', String(cursor));

      const { data } = await axiosClient.get(
        `/messages/${chatroom.id}?${params.toString()}`
      );

      let priv = null;
      try {
        priv = await getUnlockedPrivateKey();
      } catch {}

      const decrypted = await decryptFetchedMessages(
        data.items || [],
        priv,
        null,
        currentUserId
      );

      // newest → oldest from server; render oldest → newest
      const chronological = decrypted.slice().reverse();

      if (initial) {
        setMessages(chronological);
        setCursor(data.nextCursor ?? null);
        setTimeout(scrollToBottomNow, 0);
      } else {
        const v = scrollViewportRef.current;
        const prevHeight = v ? v.scrollHeight : 0;

        setMessages((prev) => [...chronological, ...prev]);
        setCursor(data.nextCursor ?? null);

        setTimeout(() => {
          if (!v) return;
          const newHeight = v.scrollHeight;
          v.scrollTop = newHeight - prevHeight + v.scrollTop;
        }, 0);
      }

      addMessages(chatroom.id, chronological).catch(() => {});
    } catch (err) {
      console.error('Failed to fetch/decrypt paged messages', err);
    } finally {
      setLoading(false);
    }
  }

  // --- Initial load / room change ---
  useEffect(() => {
    setMessages([]);
    setCursor(null);
    setShowNewMessage(false);
    if (chatroom?.id) {
      loadMore(true);
      socket.emit('join:rooms', [String(chatroom.id)]);
      socket.emit('join_room', chatroom.id); // back-compat
    }
    return () => {
      if (chatroom?.id) socket.emit('leave_room', chatroom.id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatroom?.id]);

  // --- Infinite scroll: load older when near TOP ---
  useEffect(() => {
    const v = scrollViewportRef.current;
    if (!v) return;

    const onScroll = () => {
      const nearTop = v.scrollTop <= 120;
      if (nearTop && cursor && !loading) loadMore(false);
    };

    v.addEventListener('scroll', onScroll);
    return () => v.removeEventListener('scroll', onScroll);
  }, [cursor, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Realtime: receiving new messages ---
  useEffect(() => {
    if (!chatroom || !currentUserId) return;

    const handleReceiveMessage = async (data) => {
      if (data.chatRoomId !== chatroom.id) return;

      try {
        let priv = null;
        try {
          priv = await getUnlockedPrivateKey();
        } catch {}

        const [decrypted] = await decryptFetchedMessages(
          [data],
          priv,
          null,
          currentUserId
        );

        setMessages((prev) => [...prev, decrypted]);
        addMessages(chatroom.id, [decrypted]).catch(() => {});

        const v = scrollViewportRef.current;
        const atBottom = v && v.scrollTop + v.clientHeight >= v.scrollHeight - 10;

        if (atBottom) scrollToBottomNow();
        else setShowNewMessage(true);

        const isMine = decrypted?.sender?.id === currentUserId;
        const tabHidden = document.hidden;
        if (!isMine && (!atBottom || tabHidden)) {
          playSound('/sounds/new-message.mp3', { volume: 0.6 });
        }
      } catch (e) {
        console.error('Failed to decrypt incoming message', e);

        setMessages((prev) => [...prev, data]);
        setShowNewMessage(true);

        const v = scrollViewportRef.current;
        const atBottom = v && v.scrollTop + v.clientHeight >= v.scrollHeight - 10;

        const isMine = data?.senderId === currentUserId;
        const tabHidden = document.hidden;
        if (!isMine && (!atBottom || tabHidden)) {
          playSound('/sounds/new-message.mp3', { volume: 0.6 });
        }
      }
    };

    const handleTyping = ({ username }) => setTypingUser(username);
    const handleStopTyping = () => setTypingUser('');

    socket.on('receive_message', handleReceiveMessage);
    socket.on('user_typing', handleTyping);
    socket.on('user_stopped_typing', handleStopTyping);

    return () => {
      socket.off('receive_message', handleReceiveMessage);
      socket.off('user_typing', handleTyping);
      socket.off('user_stopped_typing', handleStopTyping);
    };
  }, [chatroom, currentUserId]);

  // --- Expired message listener ---
  useEffect(() => {
    if (!chatroom) return;
    const onExpired = ({ id }) => {
      setMessages((prev) => prev.filter((m) => m.id !== id));
    };
    socket.on('message_expired', onExpired);
    return () => socket.off('message_expired', onExpired);
  }, [chatroom?.id]);

  // --- Copy notice listener ---
  useEffect(() => {
    const onCopyNotice = ({ toUserId }) => {
      if (toUserId !== currentUserId) return;
    };
    socket.on('message_copy_notice', onCopyNotice);
    return () => socket.off('message_copy_notice', onCopyNotice);
  }, [currentUserId]);

  // 🔔 Real-time: read receipts
  useEffect(() => {
    const onRead = ({ messageId, reader }) => {
      if (!reader || reader.id === currentUserId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                readBy: Array.isArray(m.readBy)
                  ? m.readBy.some((u) => u.id === reader.id)
                    ? m.readBy
                    : [...m.readBy, reader]
                  : [reader],
              }
            : m
        )
      );
    };
    socket.on('message_read', onRead);
    return () => socket.off('message_read', onRead);
  }, [currentUserId]);

  // ✅ Reactions live updates
  useEffect(() => {
    const onReaction = ({ messageId, emoji, op, user, count }) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const summary = { ...(m.reactionSummary || {}) };
          summary[emoji] =
            typeof count === 'number'
              ? count
              : Math.max(0, (summary[emoji] || 0) + (op === 'added' ? 1 : -1));
          const my = new Set(m.myReactions || []);
          if (user?.id === currentUserId) {
            if (op === 'added') my.add(emoji);
            else my.delete(emoji);
          }
          return {
            ...m,
            reactionSummary: summary,
            myReactions: Array.from(my),
          };
        })
      );
    };
    socket.on('reaction_updated', onReaction);
    return () => socket.off('reaction_updated', onReaction);
  }, [currentUserId]);

  // ✅ Smart Replies
  const { suggestions, clear } = useSmartReplies({
    messages,
    currentUserId,
    enabled: smartEnabled,
    locale: navigator.language || 'en-US',
  });

  const sendSmartReply = (text) => {
    if (!text?.trim() || !chatroom?.id) return;
    socket.emit('send_message', { content: text, chatRoomId: chatroom.id });
    clear();
  };

  // === Premium toolbar actions (handler-level guard) ===
  const runPowerAi = async () => {
    if (!isPremium) return navigate('/upgrade');
    try {
      const { data } = await axiosClient.post('/ai/power-feature', { context: [] });
      console.log('AI power result', data);
    } catch (e) {
      console.error('Power AI failed', e);
    }
  };

  const openSchedulePrompt = async () => {
    if (!isPremium) return navigate('/upgrade');
    const iso = window.prompt('Schedule time (ISO or YYYY-MM-DD HH:mm):');
    if (!iso || !chatroom?.id) return;

    let scheduledAt;
    try {
      scheduledAt = new Date(iso).toISOString();
    } catch {
      console.error('Invalid date input for scheduling');
      return;
    }

    try {
      await axiosClient.post(`/messages/${chatroom.id}/schedule`, {
        content: '(scheduled message)',
        scheduledAt,
      });
    } catch (e) {
      console.error('Schedule failed', e);
    }
  };

  // === Retry failed optimistic message ===
  async function handleRetry(failedMsg) {
    try {
      const payload = {
        chatRoomId: String(chatroom.id),
        content: failedMsg.content || failedMsg.decryptedContent || '',
        expireSeconds: failedMsg.expireSeconds || 0,
        attachmentsInline: failedMsg.attachmentsInline || [],
      };
      const { data: saved } = await axiosClient.post('/messages', payload, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      setMessages((prev) =>
        prev.map((m) => (m.id === failedMsg.id ? { ...saved } : m))
      );
    } catch (e) {
      console.error('Retry send failed', e);
    }
  }

  const renderReadBy = (msg) => {
    if (!currentUser?.showReadReceipts) return null;
    if (msg.sender?.id !== currentUserId) return null;
    const readers = (msg.readBy || []).filter((u) => u.id !== currentUserId);
    if (!readers.length) return null;

    const limit = 3;
    const shown = readers.slice(0, limit).map((u) => u.username).join(', ');
    const extra = readers.length - limit;

    return (
      <Text size="xs" mt={4} c="gray.6" ta="right" fs="italic">
        Read by: {shown}
        {extra > 0 ? ` +${extra}` : ''}
      </Text>
    );
  };

  // Decide where to inject inline ads in the thread (Free users)
  const inlineAdPositions = useMemo(() => {
    if (isPremium) return [];
    const n = messages.length;
    if (n < 8) return [];
    const positions = [];
    positions.push(6);
    for (let i = 36; i < n - 3; i += 30) positions.push(i);
    return positions;
  }, [isPremium, messages.length]);

  /* ---------- empty state (no chat selected) ---------- */
  if (!chatroom) {
    if (import.meta.env.DEV) {
      console.log('[ChatView] empty-state flags', {
        isPremium,
        emptyDismissed,
        canShow: ads?.canShow && ads.canShow('empty_state_promo', 'app'),
        houseKeys: Object.keys(ADS_CONFIG?.house || {}),
      });
    }

    return (
      <Box p="md">
        <Box mx="auto" maw={900}>
          <Title order={4} mb="xs">
            Select a conversation
          </Title>
          <Text c="dimmed" mb="md">
            Pick a chat on the left to get started.
          </Text>
        </Box>
      </Box>
    );
  }

  const privacyActive = Boolean(currentUser?.privacyBlurEnabled);
  const holdToReveal = Boolean(currentUser?.privacyHoldToReveal);

  const handleAddToCalendarFromMessage = (msg) => {
    const text =
      msg?.decryptedContent ||
      msg?.translatedForMe ||
      msg?.rawContent ||
      msg?.content ||
      '';
    if (text) setForcedCalendarText(text);
  };

  const showThreadTop =
    !isPremium && canShow(PLACEMENTS.THREAD_TOP, String(chatroom.id));

  useEffect(() => {
    if (showThreadTop) markShown(PLACEMENTS.THREAD_TOP, String(chatroom.id));
  }, [showThreadTop, markShown, chatroom?.id]);

  return (
    <ThreadShell
      header={
        <Box
          p="md"
          className={clsx(
            'chatgrid',
            privacyActive && !reveal && 'privacy-blur',
            reveal && 'privacy-revealed'
          )}
          onMouseDown={holdToReveal ? () => setReveal(true) : undefined}
          onMouseUp={holdToReveal ? () => setReveal(false) : undefined}
          onMouseLeave={holdToReveal ? () => setReveal(false) : undefined}
          onTouchStart={holdToReveal ? () => setReveal(true) : undefined}
          onTouchEnd={holdToReveal ? () => setReveal(false) : undefined}
        >
          {/* Full width header (no max-width cap) */}
          <Box
            w="100%"
            style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            <Group mb="sm" justify="space-between" wrap="nowrap">
              <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                {/* ✅ remove useless "Chat" label; show name only */}
                <Title
                  order={4}
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '100%',
                  }}
                >
                  {chatroom?.name || ''}
                </Title>

                {isRandomRoom && (
                  <Badge
                    variant="light"
                    radius="sm"
                    leftSection={<IconDice5 size={14} />}
                  >
                    Random
                  </Badge>
                )}
                {chatroom?.participants?.length > 2 && (
                  <Badge variant="light" radius="sm">
                    Group
                  </Badge>
                )}
              </Group>

              {/* ✅ toolbar should live here, always */}
              <Group gap="xs" wrap="nowrap">
                <Tooltip label="Search" withArrow>
                  <ActionIcon
                    variant="subtle"
                    onClick={() => setSearchOpen(true)}
                    aria-label="Search messages"
                  >
                    <IconSearch size={18} />
                  </ActionIcon>
                </Tooltip>

                <Tooltip label="Media" withArrow>
                  <ActionIcon
                    variant="subtle"
                    onClick={() => setGalleryOpen(true)}
                    aria-label="Open media gallery"
                  >
                    <IconPhoto size={18} />
                  </ActionIcon>
                </Tooltip>

                <Menu position="bottom-end" withinPortal shadow="md" radius="md">
                  <Menu.Target>
                    <ActionIcon variant="subtle" aria-label="Thread menu">
                      <IconDotsVertical size={18} />
                    </ActionIcon>
                  </Menu.Target>

                  <Menu.Dropdown>
                    <Menu.Label>Premium</Menu.Label>

                    <Menu.Item
                      leftSection={<IconSparkles size={16} />}
                      onClick={runPowerAi}
                    >
                      AI Power {isPremium ? '' : '(Upgrade)'}
                    </Menu.Item>

                    <Menu.Item
                      leftSection={<IconCalendarPlus size={16} />}
                      onClick={openSchedulePrompt}
                    >
                      Schedule {isPremium ? '' : '(Upgrade)'}
                    </Menu.Item>

                    <Divider my="xs" />

                    <Menu.Label>Thread</Menu.Label>

                    <Menu.Item
                      leftSection={<IconInfoCircle size={16} />}
                      onClick={() => setAboutOpen(true)}
                    >
                      About
                    </Menu.Item>

                    <Menu.Item
                      leftSection={<IconSearch size={16} />}
                      onClick={() => setSearchOpen(true)}
                    >
                      Search
                    </Menu.Item>

                    <Menu.Item
                      leftSection={<IconPhoto size={16} />}
                      onClick={() => setGalleryOpen(true)}
                    >
                      Media
                    </Menu.Item>

                    {isOwnerOrAdmin && (
                      <Menu.Item
                        leftSection={<IconUserPlus size={16} />}
                        onClick={() => setInviteOpen(true)}
                      >
                        Invite people
                      </Menu.Item>
                    )}

                    {isOwnerOrAdmin && (
                      <Menu.Item
                        leftSection={<IconSettings size={16} />}
                        onClick={() => setSettingsOpen(true)}
                      >
                        Room settings
                      </Menu.Item>
                    )}
                  </Menu.Dropdown>
                </Menu>
              </Group>
            </Group>
          </Box>
        </Box>
      }
      composer={
        // ✅ full-width composer (between conversations list and ads)
        <Box w="100%">
          <ThreadComposer
            value={draft}
            onChange={setDraft}
            placeholder="Type a message…"
            topSlot={
              <Group gap="sm" align="center" wrap="wrap">
                {/* ✅ ONE Smart Replies toggle only (no duplicate row) */}
                <label
                  style={{
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={smartEnabled}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setSmartEnabled(v);
                      setPref(PREF_SMART_REPLIES, v);
                    }}
                    aria-label="Enable Smart Replies"
                  />
                  Smart Replies
                </label>

                <SmartReplyBar
                  suggestions={suggestions}
                  onPick={(t) => sendSmartReply(t)}
                  compact
                />
              </Group>
            }
            onSend={async (payload) => {
              // payload can be undefined, or { attachments: [fileMeta] }, or { files: [...] }
              const text = (draft || '').trim();

              // 1) attachments from MicButton (already uploaded -> fileMeta)
              if (payload?.attachments?.length) {
                socket.emit('send_message', {
                  chatRoomId: chatroom.id,
                  content: text || '',             // optional caption if you typed
                  attachmentsInline: payload.attachments.map((f) => ({
                    kind: (f.contentType || '').startsWith('audio/') ? 'AUDIO' : 'FILE',
                    url: f.url,
                    mimeType: f.contentType || 'audio/webm',
                    durationSec: f.durationSec || null,
                    caption: f.caption || null,
                  })),
                });
                setDraft('');
                return;
              }

              // 2) file picker fallback (only happens if onUploadFiles is not provided)
              if (payload?.files?.length) {
                // You likely want to upload via your FileUploader flow instead of raw files.
                // For now: just warn and keep text.
                console.warn('ThreadComposer provided raw files; wire onUploadFiles to handle uploads.');
                return;
              }

              // 3) normal text send
              if (!text) return;
              socket.emit('send_message', {
                content: text,
                chatRoomId: chatroom.id,
              });
              setDraft('');
            }}
          />
        </Box>
      }
    >
      {/* Messages area (full width like composer) */}
      <Box
        w="100%"
        style={{
          height: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Thread top promo */}
        {!isPremium && showThreadTop && (
          <div style={{ padding: '8px 12px', flex: '0 0 auto' }}>
            <CardAdWrap>
              <HouseAdSlot placement="thread_top" variant="card" />
            </CardAdWrap>
          </div>
        )}

        <ScrollArea
          style={{ flex: '1 1 auto', minHeight: 0 }}
          viewportRef={scrollViewportRef}
          type="auto"
        >
          <Box
            style={{
              minHeight: '100%',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* ✅ This spacer pushes messages to the bottom when there aren't many */}
            <Box style={{ flex: '1 1 auto' }} />

            <Stack gap="xs" p="xs">
              {/* ...messages... */}
              <div ref={messagesEndRef} />
            </Stack>
          </Box>
        </ScrollArea>


        {/* Typing + new msg helper + suggestions */}
        <Box style={{ flex: '0 0 auto' }}>
          {typingUser && (
            <Text size="sm" c="dimmed" fs="italic" mt="xs" aria-live="polite">
              {typingUser} is typing...
            </Text>
          )}

          {showNewMessage && (
            <Group justify="center" mt="xs">
              <Button onClick={scrollToBottom} aria-label="Jump to newest">
                New Messages
              </Button>
            </Group>
          )}

          <EventSuggestionBar
            messages={messages}
            currentUser={currentUser}
            chatroom={chatroom}
            forcedText={forcedCalendarText}
            onClearForced={() => setForcedCalendarText(null)}
          />
        </Box>
      </Box>

      {/* Modals & drawers */}
      <RoomSettingsModal
        opened={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        room={chatroom}
      />
      <RoomInviteModal
        opened={inviteOpen}
        onClose={() => setInviteOpen(false)}
        roomId={chatroom.id}
      />
      <RoomAboutModal
        opened={aboutOpen}
        onClose={() => setAboutOpen(false)}
        room={chatroom}
      />
      <RoomSearchDrawer
        opened={searchOpen}
        onClose={() => setSearchOpen(false)}
        roomId={chatroom.id}
      />
      <MediaGalleryModal
        opened={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        roomId={chatroom.id}
      />
    </ThreadShell>
  );
}
