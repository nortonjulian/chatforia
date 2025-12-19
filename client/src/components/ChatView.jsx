// client/src/components/ChatView.jsx
import { useEffect, useRef, useState, useMemo } from 'react';
import clsx from 'clsx';
import {
  Box,
  Group,
  Avatar,
  Paper,
  Text,
  Button,
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
  IconCalendarPlus,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import MessageInput from './MessageInput';
import ReactionBar from './ReactionBar.jsx';
import EventSuggestionBar from './EventSuggestionBar.jsx';
import TranslatedText from './chat/TranslatedText.jsx';
import socket from '../lib/socket';
import { isOutgoingMessage, isSystemMessage } from '../utils/messageDirection.js';
import { decryptFetchedMessages, getUnlockedPrivateKey } from '../utils/encryptionClient';
import axiosClient from '../api/axiosClient';

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
const CONTENT_MAX = 900;

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

  // ✅ Smart Replies toggle
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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowNewMessage(false);
  };

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
        setTimeout(scrollToBottom, 0);
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

        if (atBottom) scrollToBottom();
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
    if (messages.length === 0) return [];
    const positions = [4];
    for (let i = 12; i < messages.length; i += 35) positions.push(i);
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
        <Box mx="auto" maw={CONTENT_MAX}>
          <Title order={4} mb="xs">Select a chatroom</Title>
          <Text c="dimmed" mb="md">Pick a chat on the left to get started.</Text>
        </Box>
      </Box>
    );
  }

  const privacyActive = Boolean(currentUser?.privacyBlurEnabled);
  const holdToReveal = Boolean(currentUser?.privacyHoldToReveal);

  // Feed a specific message's text into the calendar bar
  const handleAddToCalendarFromMessage = (msg) => {
    const text =
      msg?.decryptedContent ||
      msg?.translatedForMe ||
      msg?.rawContent ||
      msg?.content ||
      '';
    if (text) setForcedCalendarText(text);
  };

  // Thread-top ad should be shown ONCE, deterministically
  const showThreadTop =
    !isPremium && canShow(PLACEMENTS.THREAD_TOP, String(chatroom.id));

  useEffect(() => {
    if (showThreadTop) markShown(PLACEMENTS.THREAD_TOP, String(chatroom.id));
  }, [showThreadTop, markShown, chatroom?.id]);

  return (
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
      {/* Header (row 1) */}
      <Box mx="auto" maw={CONTENT_MAX} w="100%">
        <Group mb="sm" justify="space-between">
          <Title order={4}>{chatroom?.name || 'Chat'}</Title>
          <Group gap="xs">
            {isRandomRoom && (
              <Badge variant="light" radius="sm" leftSection={<IconDice5 size={14} />}>
                Random
              </Badge>
            )}
            {chatroom?.participants?.length > 2 && (
              <Badge variant="light" radius="sm">Group</Badge>
            )}
            <Tooltip label="About">
              <ActionIcon variant="subtle" onClick={() => setAboutOpen(true)} aria-label="About">
                <IconInfoCircle size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Search">
              <ActionIcon variant="subtle" onClick={() => setSearchOpen(true)} aria-label="Search messages">
                <IconSearch size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Media">
              <ActionIcon variant="subtle" onClick={() => setGalleryOpen(true)} aria-label="Open media gallery">
                <IconPhoto size={18} />
              </ActionIcon>
            </Tooltip>
            {isOwnerOrAdmin && (
              <Tooltip label="Invite people">
                <ActionIcon variant="subtle" onClick={() => setInviteOpen(true)} aria-label="Invite people">
                  <IconUserPlus size={18} />
                </ActionIcon>
              </Tooltip>
            )}
            {isOwnerOrAdmin && (
              <Tooltip label="Room settings">
                <ActionIcon variant="subtle" onClick={() => setSettingsOpen(true)} aria-label="Room settings">
                  <IconSettings size={18} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        </Group>
      </Box>

      {/* Messages scroller (row 2) */}
      <ScrollArea
        className="chat-scroll-region"
        style={{ minHeight: 0 }}
        viewportRef={scrollViewportRef}
        type="auto"
      >
        <Box mx="auto" maw={CONTENT_MAX} w="100%">
          {/* ✅ Top-of-thread promo (show ONCE; respect caps) */}
          {!isPremium && showThreadTop && (
            <div style={{ padding: '8px 12px' }}>
              <CardAdWrap>
                <HouseAdSlot placement="thread_top" variant="card" />
              </CardAdWrap>
            </div>
          )}

          <Stack gap="xs" p="xs">
            {loading && messages.length === 0 && (
              <>
                {Array.from({ length: 8 }).map((_, i) => (
                  <Group key={i} justify={i % 2 ? 'flex-end' : 'flex-start'} align="flex-end">
                    <Skeleton height={18} width={i % 2 ? 220 : 280} radius="lg" />
                  </Group>
                ))}
              </>
            )}

            {!loading && messages.length === 0 && (
              <Text c="dimmed" ta="center" py="md">Say hello 👋</Text>
            )}

            {messages.map((msg, i) => {
              const isSystem = isSystemMessage?.(msg) ?? false;
              const isMine = !isSystem && isOutgoingMessage(msg, currentUserId);


              // ✅ fix: your code was using `isCurrentUser` but never defined it
              const isCurrentUser = isMine;

              const expMs = msg.expiresAt ? new Date(msg.expiresAt).getTime() - now : null;
              const fading = msg.expiresAt && expMs <= 5000;

              // ✅ fix: Mantine Paper doesn't accept bg/c/ta props like that.
              // Use styles instead.
              const bubbleStyle = {
                maxWidth: 360,
                opacity: fading ? 0.5 : 1,
                background: isCurrentUser ? 'var(--mantine-color-blue-filled)' : 'var(--mantine-color-gray-2)',
                color: isCurrentUser ? 'white' : 'var(--mantine-color-text)',
              };

              const ts = dayjs(msg.createdAt || msg.sentAt || msg.created_at)
                .format('MMM D,  YYYY • h:mm A');

              const nonAudioCaptions = (msg.attachments || [])
                .filter((a) => a?.caption && a.kind !== 'AUDIO')
                .map((a) => a.caption);

              const original =
                msg.decryptedContent ??
                msg.content ??
                '';

              const translated =
                msg.decryptedTranslatedContent ??
                msg.translatedContent ??
                msg.translatedMessage ??
                null;

              return (
                <div key={msg.id}>
                  <Group
                     justify={isSystem ? 'center' : isMine ? 'flex-end' : 'flex-start'}
                    align="flex-end"
                    wrap="nowrap"
                    onPointerDown={(e) => {
                      const target = e.target;
                      const timeout = setTimeout(() => {
                        if (isCurrentUser && (msg.readBy?.length || 0) === 0) handleEditMessage(msg);
                      }, 600);
                      target.onpointerup = () => clearTimeout(timeout);
                      target.onpointerleave = () => clearTimeout(timeout);
                    }}
                  >
                    {!isCurrentUser && (
                      <Avatar
                        src={msg.sender?.avatarUrl || '/default-avatar.png'}
                        alt={msg.sender?.username || 'avatar'}
                        radius="xl"
                        size={32}
                      />
                    )}

                    <Tooltip label={ts} withinPortal>
                      <Paper
                        className="message-bubble"
                        px="md"
                        py="xs"
                        radius="lg"
                        withBorder={false}
                        style={bubbleStyle}
                        aria-label={`Message sent ${ts}`}
                      >
                        {!isCurrentUser && (
                          <Text size="xs" fw={600} c="dark.6" mb={4} className="sender-name">
                            {msg.sender?.username}
                          </Text>
                        )}

                        <TranslatedText
                          originalText={original}
                          translatedText={translated}
                          showBothDefault={!!currentUser?.showOriginalAndTranslation}
                          condensed
                          onCopy={() => {
                            if (currentUser?.notifyOnCopy && socket && msg?.id) {
                              socket.emit('message_copied', { messageId: msg.id });
                            }
                          }}
                        />

                        {Array.isArray(msg.attachments) &&
                          msg.attachments.some((a) => a.kind === 'IMAGE') && (
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(2, 1fr)',
                                gap: 6,
                                marginTop: 6,
                              }}
                            >
                              {msg.attachments
                                .filter((a) => a.kind === 'IMAGE')
                                .map((a) => (
                                  <img
                                    key={a.id || a.url}
                                    src={a.url}
                                    alt={a.caption || 'image'}
                                    style={{
                                      width: 160,
                                      height: 160,
                                      objectFit: 'cover',
                                      borderRadius: 8,
                                      cursor: 'pointer',
                                    }}
                                    onClick={() => {}}
                                  />
                                ))}
                            </div>
                          )}

                        {msg.attachments
                          ?.filter((a) => a.kind === 'VIDEO')
                          .map((a) => (
                            <video
                              key={a.id || a.url}
                              controls
                              preload="metadata"
                              style={{ width: 260, marginTop: 6 }}
                              src={a.url}
                            />
                          ))}

                        {/* 🔊 Centralized audio rendering (attachments + legacy audioUrl) */}
                        <AudioMessage msg={msg} currentUser={currentUser} />

                        {/* 🌊 waveform under each audio attachment */}
                        {msg.attachments
                          ?.filter((a) => a.kind === 'AUDIO')
                          .map((a) => (
                            <div key={a.id || a.url} style={{ marginTop: 4 }}>
                              <WaveformBar src={a.url} durationSec={a.durationSec ?? undefined} />
                            </div>
                          ))}

                        {nonAudioCaptions.length > 0 && (
                          <Text size="xs" mt={4}>
                            {nonAudioCaptions.join(' • ')}
                          </Text>
                        )}

                        <ReactionBar message={msg} currentUserId={currentUserId} />

                        <Group justify="flex-end" mt={4} gap="xs">
                          <Tooltip label="Add to calendar…" withArrow>
                            <ActionIcon
                              size="sm"
                              variant="subtle"
                              aria-label="Add to calendar"
                              onClick={() => handleAddToCalendarFromMessage(msg)}
                            >
                              <IconCalendarPlus size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>

                        {msg.expiresAt && (
                          <Text size="xs" mt={4} fs="italic" c="red.6" ta="right">
                            Disappears in: {getTimeLeftString(msg.expiresAt)}
                          </Text>
                        )}

                        {msg.isAutoReply && (
                          <Group justify="flex-end" mt={4}>
                            <Badge size="xs" variant="light" color="grape">
                              Auto-reply
                            </Badge>
                          </Group>
                        )}

                        {renderReadBy(msg)}
                      </Paper>
                    </Tooltip>

                    {msg.failed && (
                      <Tooltip label="Retry send">
                        <ActionIcon
                          variant="subtle"
                          aria-label="Retry sending message"
                          onClick={() => {
                            handleRetry(msg);
                          }}
                        >
                          <IconRotateClockwise size={18} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </Group>

                  {!isPremium && inlineAdPositions.includes(i) && (
                    <CardAdWrap>
                      <AdSlot
                        placement={PLACEMENTS.THREAD_INLINE_1}
                        capKey={String(chatroom.id)}
                        lazy={false}
                        fallback={
                          <HouseAdSlot placement="thread_inline_1" variant="card" />
                        }
                      />
                    </CardAdWrap>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </Stack>
        </Box>
      </ScrollArea>

      {/* Typing + new messages helper (row 2.5) */}
      <Box mx="auto" maw={CONTENT_MAX} w="100%">
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

      {/* Footer ad just ABOVE the composer (row 3) */}
      {!isPremium && (
        <Box className="chat-footer-ad" mx="auto" maw={CONTENT_MAX} w="100%" mt="xs">
          <CardAdWrap>
            <HouseAdSlot placement="chat_footer" variant="card" />
          </CardAdWrap>
        </Box>
      )}

      {/* Composer at the very bottom (row 4) */}
      {chatroom && (
        <Box className="chat-footer" mt="sm" mx="auto" maw={CONTENT_MAX} w="100%">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
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
              Enable Smart Replies (sends last message to server for AI)
            </label>

            <SmartReplyBar
              suggestions={suggestions}
              onPick={(t) => sendSmartReply(t)}
              compact
            />
          </div>

          <MessageInput
            chatroomId={chatroom.id}
            currentUser={currentUser}
            roomParticipants={chatroom?.participants || []}
            getLastInboundText={() => {
              const lastInbound = messages
                .slice()
                .reverse()
                .find((m) => m.sender?.id !== currentUserId);
              return lastInbound?.decryptedContent || lastInbound?.content || '';
            }}
            onMessageSent={(msg) => {
              setMessages((prev) => [...prev, msg]);
              addMessages(chatroom.id, [msg]).catch(() => {});
              scrollToBottom();
            }}
          />
        </Box>
      )}

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
    </Box>
  );
}
