import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import clsx from 'clsx';
import {
  Box,
  Group,
  Text,
  Button,
  Stack,
  ScrollArea,
  Title,
  Badge,
  ActionIcon,
  Tooltip,
} from '@mantine/core';
import {
  IconSearch,
  IconPhoto,
  IconDice5,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';

import ThreadComposer from '@/threads/ThreadComposer.jsx';
import ThreadShell from '@/threads/ThreadShell.jsx';
import ThreadActionsMenu from '@/threads/ThreadActionsMenu.jsx';

import socket from '@/lib/socket';
import axiosClient from '@/api/axiosClient';

import { decryptFetchedMessages, getUnlockedPrivateKey } from '@/utils/encryptionClient';

// ✅ Smart Replies
import SmartReplyBar from '@/components/SmartReplyBar.jsx';
import { useSmartReplies } from '@/hooks/useSmartReplies.js';

// ✅ Prefs cache (IndexedDB)
import { getPref, setPref, PREF_SMART_REPLIES } from '@/utils/prefsStore';

// ✅ Local message cache for search/media
import { addMessages } from '@/utils/messagesStore';

// ✅ Modals
import RoomSettingsModal from '@/components/RoomSettingsModal.jsx';
import RoomInviteModal from '@/components/RoomInviteModal.jsx';
import RoomAboutModal from '@/components/RoomAboutModal.jsx';
import RoomSearchDrawer from '@/components/RoomSearchDrawer.jsx';
import MediaGalleryModal from '@/components/MediaGalleryModal.jsx';

import { playSound } from '@/lib/sounds.js';

// 🔒 Premium check
import useIsPremium from '@/hooks/useIsPremium';

// 🧱 Ads (render only for Free users)
import { CardAdWrap } from '@/ads/AdWrappers';
import HouseAdSlot from '@/ads/HouseAdSlot';
import { PLACEMENTS } from '@/ads/placements';
import { useAds } from '@/ads/AdProvider';
import { ADS_CONFIG } from '@/ads/config';

// ✅ Message row UI (menu + tombstone)
import MessageBubble from '@/components/chat/MessageBubble.jsx';

import '@/styles.css';

/* ---------- helpers ---------- */

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
  const navigate = useNavigate();

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

  const [forcedCalendarText, setForcedCalendarText] = useState(null);

  // Ads context (caps / cool-downs)
  const ads = useAds();
  const canShow = ads?.canShow || (() => true);
  const markShown = ads?.markShown || (() => {});

  // “owner/admin” controls
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
  useNow(); // keeps any “time-based” UI responsive if you add countdowns later

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

  /* ---------- message normalization ---------- */

  const normalizeMsg = useCallback(
    (m) => {
      const mine =
        Boolean(m.mine) ||
        m.sender?.id === currentUserId ||
        m.senderId === currentUserId;

      const content =
        m.decryptedContent ||
        m.translatedForMe ||
        m.rawContent ||
        m.content ||
        '';

      return { ...m, mine, content };
    },
    [currentUserId]
  );

  const canEditMessage = useCallback(
    (m) => {
      if ((m.sender?.id || m.senderId) !== currentUserId) return false;
      if (m.deletedForAll) return false;
      return true;
    },
    [currentUserId]
  );

  const canDeleteForEveryone = useCallback(
    (m) => {
      if ((m.sender?.id || m.senderId) !== currentUserId) return false;
      if (m.deletedForAll) return false;
      return true;
    },
    [currentUserId]
  );

  /* ---------- scrolling ---------- */

  const scrollToBottomNow = useCallback(() => {
    const v = scrollViewportRef.current;
    if (v) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          v.scrollTop = v.scrollHeight;
        });
      });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
    setShowNewMessage(false);
  }, []);

  const scrollToBottom = useCallback(() => {
    const v = scrollViewportRef.current;
    if (!v) return messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    requestAnimationFrame(() => {
      v.scrollTop = v.scrollHeight;
    });
    setShowNewMessage(false);
  }, []);

  const handleAddToCalendarFromMessage = (msg) => {
  const text =
    msg?.decryptedContent ||
    msg?.translatedForMe ||
    msg?.rawContent ||
    msg?.content ||
    '';

  if (!text) return;
  setForcedCalendarText(text);
  openSchedulePrompt();
};

  /* ---------- backend ops: edit/delete ---------- */

  const handleEditMessage = useCallback(async (msg) => {
    const current = msg.rawContent ?? msg.content ?? '';
    const newText = prompt('Edit:', current);
    if (!newText || newText === current) return;

    try {
      const { data: updated } = await axiosClient.patch(
        `/messages/${msg.id}/edit`,
        { newContent: newText }
      );

      // Local patch (socket will also patch other devices)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === (updated?.id ?? msg.id)
            ? {
                ...m,
                rawContent: newText,
                content: newText,
                editedAt: updated?.editedAt ?? new Date().toISOString(),
              }
            : m
        )
      );
    } catch (error) {
      console.error('Message edit failed', error);
    }
  }, []);

  const handleDeleteMessage = useCallback(
    async (msg, mode = 'me') => {
      const ok = window.confirm(
        mode === 'all' ? 'Delete for everyone?' : 'Delete this message for you?'
      );
      if (!ok) return;

      // Optimistic UI
      setMessages((prev) => {
        if (mode === 'me') return prev.filter((m) => m.id !== msg.id);
        return prev.map((m) =>
          m.id === msg.id
            ? {
                ...m,
                deletedForAll: true,
                rawContent: '',
                content: '',
                translatedForMe: null,
                attachments: [],
              }
            : m
        );
      });

      try {
        await axiosClient.delete(`/messages/${msg.id}`, {
          params: { mode },
          data: { mode },
        });
      } catch (e) {
        console.error('Delete failed', e);
        loadMore(true);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /* ---------- pagination loader (initial + older pages) ---------- */

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
      } catch {
        // ignore
      }

      const decrypted = await decryptFetchedMessages(
        data.items || [],
        priv,
        null,
        currentUserId
      );

      // server: newest → oldest; UI: oldest → newest
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

  /* ---------- initial load / room change ---------- */

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

  /* ---------- infinite scroll: load older when near TOP ---------- */

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

  /* ---------- realtime: new messages + typing ---------- */

  useEffect(() => {
    if (!chatroom || !currentUserId) return;

    const handleReceiveMessage = async (data) => {
      if (data.chatRoomId !== chatroom.id) return;

      try {
        let priv = null;
        try {
          priv = await getUnlockedPrivateKey();
        } catch {
          // ignore
        }

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

    const handleTyping = ({ username }) => setTypingUser(username || '');
    const handleStopTyping = () => setTypingUser('');

    socket.on('receive_message', handleReceiveMessage);
    socket.on('user_typing', handleTyping);
    socket.on('user_stopped_typing', handleStopTyping);

    return () => {
      socket.off('receive_message', handleReceiveMessage);
      socket.off('user_typing', handleTyping);
      socket.off('user_stopped_typing', handleStopTyping);
    };
  }, [chatroom, currentUserId, scrollToBottomNow]);

    // ✅ Block (safety feature — FREE)
  const handleBlockThread = useCallback(async () => {
    // Find "other user" for 1:1 rooms
    const participants = Array.isArray(chatroom?.participants) ? chatroom.participants : [];
    const other =
      participants.find((p) => Number(p?.id) !== Number(currentUserId)) ||
      participants.find((p) => Number(p?.userId) !== Number(currentUserId));

    const otherId = Number(other?.id ?? other?.userId);

    const name =
      other?.username || other?.displayName || other?.name || 'this user';

    const ok = window.confirm(`Block ${name}? You won't receive messages from them.`);
    if (!ok) return;

    try {
      // ✅ Recommended: implement this endpoint
      // POST /blocks  { targetUserId }
      if (Number.isFinite(otherId)) {
        await axiosClient.post('/blocks', { targetUserId: otherId });
      } else {
        // If it's not a 1:1 room, you can decide what block means later.
        // For now: fail gracefully.
        throw new Error('Could not determine a target user to block.');
      }

      window.alert(`Blocked ${name}.`);
      navigate('/'); // or navigate to your threads list route
    } catch (e) {
      console.error('Block failed', e);
      window.alert('Block failed (backend not wired yet).');
    }
  }, [chatroom?.participants, currentUserId, navigate]);


  /* ---------- realtime: expired messages ---------- */

  useEffect(() => {
    if (!chatroom) return;
    const onExpired = ({ id }) => {
      setMessages((prev) => prev.filter((m) => m.id !== id));
    };
    socket.on('message_expired', onExpired);
    return () => socket.off('message_expired', onExpired);
  }, [chatroom?.id]);

  /* ---------- realtime: message edited/deleted ---------- */

  useEffect(() => {
    const onEdited = (payload) => {
      const messageId = payload?.messageId ?? payload?.id ?? payload?.message?.id;
      const rawContent =
        payload?.rawContent ??
        payload?.content ??
        payload?.message?.rawContent ??
        payload?.message?.content;

      const editedAt =
        payload?.editedAt ?? payload?.message?.editedAt ?? new Date().toISOString();

      if (!messageId) return;

      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, rawContent, content: rawContent, editedAt } : m
        )
      );
    };

    socket.on('message_edited', onEdited);
    return () => socket.off('message_edited', onEdited);
  }, []);

  useEffect(() => {
    const onDeleted = (payload) => {
      const messageId = payload?.messageId ?? payload?.id ?? payload?.message?.id;
      if (!messageId) return;

      const scope = payload?.scope ?? payload?.mode ?? payload?.message?.scope ?? 'me';
      const deletedForAll = scope === 'all';

      if (!deletedForAll) {
        const targetUserId = Number(payload?.userId);
        if (Number.isFinite(targetUserId) && targetUserId !== Number(currentUserId)) return;
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
        return;
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                deletedForAll: true,
                deletedAt: payload?.deletedAt ?? new Date().toISOString(),
                deletedById: payload?.deletedById ?? payload?.deletedById,
                rawContent: '',
                content: '',
                translatedForMe: null,
                attachments: [],
              }
            : m
        )
      );
    };

    socket.on('message_deleted', onDeleted);
    return () => socket.off('message_deleted', onDeleted);
  }, [currentUserId]);

  /* ---------- realtime: read receipts ---------- */

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

  /* ---------- realtime: reactions ---------- */

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

  /* ---------- smart replies ---------- */

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

  /* ---------- premium toolbar actions ---------- */

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
      content: forcedCalendarText || '(scheduled message)',
      scheduledAt,
    });
  } catch (e) {
    console.error('Schedule failed', e);
  } finally {
    // ✅ always reset so the next schedule isn’t accidentally pre-filled
    setForcedCalendarText(null);
  }
};

  /* ---------- ✅ Block (added for parity with SMS) ---------- */

  const handleBlock = useCallback(async () => {
    const participants = Array.isArray(chatroom?.participants) ? chatroom.participants : [];
    const other =
      participants.find((p) => String(p?.id) !== String(currentUserId)) || null;

    const name =
      other?.username || other?.displayName || other?.phone || other?.id || 'this user';

    const ok = window.confirm(`Block ${name}? You won’t receive messages from them.`);
    if (!ok) return;

    try {
      // TODO: wire to real block endpoint
      // await axiosClient.post('/blocks', { targetUserId: other?.id, scope: 'chat' });

      console.log('[block] todo', { chatRoomId: chatroom?.id, targetUserId: other?.id });
    } catch (e) {
      console.error('Block failed', e);
    }
  }, [chatroom?.id, chatroom?.participants, currentUserId]);

  /* ---------- retry failed optimistic message ---------- */

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
      setMessages((prev) => prev.map((m) => (m.id === failedMsg.id ? { ...saved } : m)));
    } catch (e) {
      console.error('Retry send failed', e);
    }
  }

  /* ---------- empty state (no chat selected) ---------- */

  if (!chatroom) {
    const showPromo =
      !isPremium &&
      !emptyDismissed &&
      canShow(PLACEMENTS.EMPTY_STATE_PROMO, 'app') &&
      Object.keys(ADS_CONFIG?.house || {}).length > 0;

    return (
      <Box p="md">
        <Box mx="auto" maw={900}>
          <Title order={4} mb="xs">
            Select a conversation
          </Title>
          <Text c="dimmed" mb="md">
            Pick a chat on the left to get started.
          </Text>

          {!isPremium && showPromo && (
            <CardAdWrap>
              <HouseAdSlot placement="empty_state_promo" variant="card" />
            </CardAdWrap>
          )}
        </Box>
      </Box>
    );
  }

  /* ---------- privacy settings ---------- */

  const privacyActive = Boolean(currentUser?.privacyBlurEnabled);
  const holdToReveal = Boolean(currentUser?.privacyHoldToReveal);

  /* ---------- ads inside thread ---------- */

  const showThreadTop = !isPremium && canShow(PLACEMENTS.THREAD_TOP, String(chatroom.id));

  useEffect(() => {
    if (showThreadTop) markShown(PLACEMENTS.THREAD_TOP, String(chatroom.id));
  }, [showThreadTop, markShown, chatroom?.id]);

  /* ---------- render ---------- */

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
                  <Badge variant="light" radius="sm" leftSection={<IconDice5 size={14} />}>
                    Random
                  </Badge>
                )}
                {chatroom?.participants?.length > 2 && (
                  <Badge variant="light" radius="sm">
                    Group
                  </Badge>
                )}
              </Group>

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

                <ThreadActionsMenu
                  isPremium={isPremium}
                  showPremiumSection
                  showThreadSection
                  isOwnerOrAdmin={isOwnerOrAdmin}
                  onAiPower={runPowerAi}
                  onSchedule={openSchedulePrompt}
                  onAbout={() => setAboutOpen(true)}
                  onSearch={() => setSearchOpen(true)}
                  onMedia={() => setGalleryOpen(true)}
                  onInvitePeople={() => setInviteOpen(true)}
                  onRoomSettings={() => setSettingsOpen(true)}
                  onBlock={handleBlockThread} 
                />
              </Group>
            </Group>
          </Box>
        </Box>
      }
      composer={
        <Box w="100%">
          <ThreadComposer
            value={draft}
            onChange={setDraft}
            placeholder="Type a message…"
            topSlot={
              <Group gap="sm" align="center" wrap="wrap">
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
                  Smart Replies
                </label>

                <SmartReplyBar suggestions={suggestions} onPick={sendSmartReply} compact />
              </Group>
            }
            onSend={async (payload) => {
              const text = (draft || '').trim();

              // 1) attachments already uploaded -> fileMeta
              if (payload?.attachments?.length) {
                socket.emit('send_message', {
                  chatRoomId: chatroom.id,
                  content: text || '',
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

              // 2) raw files fallback (warn)
              if (payload?.files?.length) {
                console.warn(
                  'ThreadComposer provided raw files; wire onUploadFiles to handle uploads.'
                );
                return;
              }

              // 3) normal text send
              if (!text) return;
              socket.emit('send_message', { content: text, chatRoomId: chatroom.id });
              setDraft('');
            }}
          />
        </Box>
      }
    >
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

        <ScrollArea style={{ flex: '1 1 auto', minHeight: 0 }} viewportRef={scrollViewportRef} type="auto">
          <Box style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* spacer pushes messages down */}
            <Box style={{ flex: '1 1 auto' }} />

            <Stack gap="xs" p="xs">
              {messages.map((m, idx) => {
                const msg = normalizeMsg(m);
                return (
                  <MessageBubble
                    key={msg.id ?? `${msg.createdAt}-${idx}`}
                    msg={msg}
                    onRetry={handleRetry}
                    onEdit={(mm) => handleEditMessage(mm)}
                    onDeleteMe={(mm) => handleDeleteMessage(mm, 'me')}
                    onDeleteAll={(mm) => handleDeleteMessage(mm, 'all')}
                    onAddToCalendar={(mm) => handleAddToCalendarFromMessage(mm)}
                    canEdit={canEditMessage(msg)}
                    canDeleteAll={canDeleteForEveryone(msg)}
                  />
                );
              })}

              <div ref={messagesEndRef} />
            </Stack>
          </Box>
        </ScrollArea>

        {/* Typing + new msg helper */}
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
        </Box>
      </Box>

      {/* Modals & drawers */}
      <RoomSettingsModal opened={settingsOpen} onClose={() => setSettingsOpen(false)} room={chatroom} />
      <RoomInviteModal opened={inviteOpen} onClose={() => setInviteOpen(false)} roomId={chatroom.id} />
      <RoomAboutModal opened={aboutOpen} onClose={() => setAboutOpen(false)} room={chatroom} />
      <RoomSearchDrawer opened={searchOpen} onClose={() => setSearchOpen(false)} roomId={chatroom.id} />
      <MediaGalleryModal opened={galleryOpen} onClose={() => setGalleryOpen(false)} roomId={chatroom.id} />
    </ThreadShell>
  );
}
