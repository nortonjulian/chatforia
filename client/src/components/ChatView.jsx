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
  Modal,
  Select,
  Textarea,
  Checkbox,
  Alert,
} from '@mantine/core';
import {
  IconSearch,
  IconPhoto,
  IconDice5,
  IconPhoneCall,
  IconVideo,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { reportMessage } from '@/utils/encryptionClient';

import ThreadComposer from '@/threads/ThreadComposer.jsx';
import ThreadShell from '@/threads/ThreadShell.jsx';
import ThreadActionsMenu from '@/threads/ThreadActionsMenu.jsx';

import socket from '@/lib/socket';
import axiosClient from '@/api/axiosClient';

// dynamic: keep heavy crypto out of the initial bundle
import loadEncryptionClient from '@/utils/loadEncryptionClient';

// ✅ Smart Replies
import SmartReplyBar from '@/components/SmartReplyBar.jsx';
import { useSmartReplies } from '@/hooks/useSmartReplies.js';

// ✅ Prefs cache (IndexedDB)
import { getPref, setPref, PREF_SMART_REPLIES } from '@/utils/prefsStore';

// ✅ Local message cache for search/media
import { fetchLatestMessages, fetchOlderMessages, fetchMessageDeltas } from '@/lib/api';
import { addMessages, upsertMessage } from '@/utils/messagesStore';

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

/** Merge factories: keep messages unique and chronologically ordered (oldest → newest) */
function mergeIncomingMessageFactory(setMessages) {
  return (incoming) => {
    if (!incoming) return;
    setMessages((prev) => {
      // replace if exists, otherwise append keeping order by createdAt (or id fallback)
      const map = new Map(prev.map((m) => [String(m.id), m]));
      map.set(String(incoming.id ?? Symbol()), {
        ...map.get(String(incoming.id)),
        ...incoming,
      });

      // produce array and sort by createdAt ascending, then id
      const arr = Array.from(map.values()).sort((a, b) => {
        const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (ta !== tb) return ta - tb;
        return (Number(a.id) || 0) - (Number(b.id) || 0);
      });
      return arr;
    });
  };
}

function mergeIncomingBatchFactory(setMessages) {
  return (rows = []) => {
    if (!Array.isArray(rows) || rows.length === 0) return;
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [String(m.id), m]));
      for (const r of rows) {
        if (!r) continue;
        map.set(String(r.id ?? Symbol()), { ...(map.get(String(r.id)) || {}), ...r });
      }
      const arr = Array.from(map.values()).sort((a, b) => {
        const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (ta !== tb) return ta - tb;
        return (Number(a.id) || 0) - (Number(b.id) || 0);
      });
      return arr;
    });
  };
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

  const [hasMore, setHasMore] = useState(true);
  const loadingOlderRef = useRef(false);

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

  const [highestSeenId, setHighestSeenId] = useState(0); // track highest numeric message id we've seen

  const [reportOpen, setReportOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  const [reportReason, setReportReason] = useState('harassment');
  const [reportDetails, setReportDetails] = useState('');
  const [reportContextCount, setReportContextCount] = useState('10');
  const [blockAfterReport, setBlockAfterReport] = useState(true);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportError, setReportError] = useState('');

  const [e2eeLocked, setE2eeLocked] = useState(false);

  const pendingPages = useRef(new Set());

  const canLoadOlderRef = useRef(false);

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

  // ✅ for 1:1 seen label (simple version)
  const otherParticipant = useMemo(() => {
    const ps = Array.isArray(chatroom?.participants) ? chatroom.participants : [];
    return (
      ps.find((p) => Number(p?.id ?? p?.userId) !== Number(currentUserId)) || null
    );
  }, [chatroom?.participants, currentUserId]);

  const otherUserId = Number(otherParticipant?.id ?? otherParticipant?.userId);

  // ✅ mark newest N unread as read
  const markNewestUnreadBulk = useCallback(
    async (limit = 50) => {
      if (!chatroom?.id) return;
      try {
        await axiosClient.post('/messages/read-bulk', {
          chatRoomId: chatroom.id,
          limit,
        });
      } catch (e) {
        console.error('read-bulk failed', e);
      }
    },
    [chatroom?.id]
  );

  // ✅ mark single message read (fallback if you want instant receipts)
  const markMessageRead = useCallback(async (messageId) => {
    if (!messageId) return;
    try {
      await axiosClient.patch(`/messages/${messageId}/read`);
    } catch (e) {
      console.error('PATCH read failed', e);
    }
  }, []);

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

  /* ---------- header: call/video ---------- */

  const startChatCall = useCallback(() => {
    if (!chatroom?.id) return;
    // Wire to your in-app voice calling flow
    console.log('[call] start voice call', { chatRoomId: chatroom.id });
    navigate(`/calls?roomId=${encodeURIComponent(String(chatroom.id))}`);
  }, [chatroom?.id, navigate]);

  const startChatVideo = useCallback(() => {
    if (!chatroom?.id) return;
    // Wire to your in-app video flow
    console.log('[video] start video call', { chatRoomId: chatroom.id });
    navigate(`/video?roomId=${encodeURIComponent(String(chatroom.id))}`);
  }, [chatroom?.id, navigate]);

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
        // try reload a page of messages to recover
        await loadMore(true);
      }
    },
    []
  );

    console.log('[ChatView render]', {
    chatroomId: chatroom?.id,
    chatroomName: chatroom?.name,
    messageCount: messages.length,
  });

  // ---------- dynamic encryption helpers ----------
  /**
   * Returns the unlocked private key or null if locked/unavailable.
   * We intentionally catch errors and return null so code paths that
   * gracefully handle locked keys keep working.
   */
  async function maybeGetUnlockedPrivateKey() {
  try {
    const mod = await loadEncryptionClient();
    if (typeof mod.getUnlockedPrivateKey === 'function') {
      return await mod.getUnlockedPrivateKey();
    }
    console.warn('[E2EE] getUnlockedPrivateKey is not exported');
    return null;
  } catch (e) {
    console.warn('[E2EE] private key unavailable:', e?.message || e);
    return null;
  }
}

  /**
   * Decrypts rows using the encryption client if available.
   * If the encryption client fails to load, falls back to returning
   * the input rows unchanged (so UI still shows raw payload).
   */
  async function maybeDecryptFetchedMessages(rows, privKey, senderKeys = null, uid = null) {
    try {
      const mod = await loadEncryptionClient();
      if (typeof mod.decryptFetchedMessages === 'function') {
        return await mod.decryptFetchedMessages(rows, privKey, senderKeys, uid);
      }
    } catch (e) {
      console.warn('Encryption client not available for decryption:', e);
    }
    // fallback: return original rows (no decryption)
    return rows;
  }

  /* ---------- pagination loader (initial + older pages) ---------- */

  async function loadMore(initial = false) {
    if (!chatroom?.id) return false;
    if (loadingOlderRef.current) return false;

    // prevent duplicate page requests for same cursor
    const requestedCursor = initial ? 'initial' : cursor ?? 'null';
    if (pendingPages.current.has(requestedCursor)) return false;
    pendingPages.current.add(requestedCursor);

    loadingOlderRef.current = true;
    setLoading(true);

    try {
      // call server via canonical api
          let resp;
            if (initial) {
              resp = await fetchLatestMessages(chatroom.id, 50);
            } else {
              resp = await fetchOlderMessages(chatroom.id, cursor, 30);
            }

            const data = resp || {};

    console.log('[ChatView loadMore FULL DEBUG]', {
      roomId: chatroom?.id,
      initial,
      resp: data,
      isArray: Array.isArray(data),
      dataKeys: data && typeof data === 'object' ? Object.keys(data) : null,
      items: data?.items,
      messages: data?.messages,
      rows: data?.rows,
      nextCursor: data?.nextCursor,
    });
    

      const rows =
        Array.isArray(data?.items) ? data.items :
        Array.isArray(data?.messages) ? data.messages :
        Array.isArray(data?.rows) ? data.rows :
        Array.isArray(data) ? data :
      [];

      console.log('[ChatView resolved rows]', rows);

    // Only decrypt if at least one row is actually encrypted.
    const needsDecrypt = rows.some(
      (m) => m?.contentCiphertext || m?.encryptedKeyForMe
    );

    const priv = needsDecrypt ? await maybeGetUnlockedPrivateKey() : null;
    setE2eeLocked(Boolean(needsDecrypt && !priv));

    if (needsDecrypt && !priv) {
      console.warn('[E2EE] Messages require decryption but no unlocked private key is available');
    }

    const decrypted = needsDecrypt
      ? await maybeDecryptFetchedMessages(rows, priv, null, currentUserId)
      : rows;

    console.log('[ChatView] loadMore result', {
      roomId: chatroom?.id,
      initial,
      fetchedCount: rows.length,
      needsDecrypt,
      sample: rows.slice(0, 3),
    });

    // server returns newest -> oldest; UI wants oldest -> newest
    const chronological = (decrypted || []).slice().reverse();

    console.log('[ChatView] after decrypt', {
      roomId: chatroom?.id,
      privLoaded: !!priv,
      decrypted,
      chronological,
    });

      // update highestSeenId (max id we've seen)
      const maxId = (decrypted || [])
        .map((m) => Number(m?.id || 0))
        .filter(Number.isFinite)
        .reduce((a, b) => Math.max(a, b), 0);
      if (maxId > 0) setHighestSeenId((prev) => Math.max(prev || 0, maxId));

      if (initial) {
        setMessages(chronological);
        setCursor(data.nextCursor ?? null);
        setHasMore(Boolean(data.nextCursor));

        addMessages(chatroom.id, chronological).catch(() => {});

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            scrollToBottomNow();
          });
        });
      } else {
        // preserve scroll position while prepending older messages
        const v = scrollViewportRef.current;
        const prevHeight = v ? v.scrollHeight : 0;
        const prevTop = v ? v.scrollTop : 0;

        setMessages((prev) => {
          const seen = new Set(prev.map((m) => String(m.id ?? m.clientMessageId ?? '')));
          const older = chronological.filter(
            (m) => !seen.has(String(m.id ?? m.clientMessageId ?? ''))
          );
          return [...older, ...prev];
        });

        setCursor(data.nextCursor ?? null);
        setHasMore(Boolean(data.nextCursor));

        // persist older page (dedup tolerant)
        addMessages(chatroom.id, chronological).catch(() => {});

        requestAnimationFrame(() => {
          const vv = scrollViewportRef.current;
          if (!vv) return;
          const newHeight = vv.scrollHeight;
          const delta = newHeight - prevHeight;
          vv.scrollTop = prevTop + delta;
        });
      }

      return true;
      } catch (err) {
      console.error('[ChatView] failed to fetch/decrypt paged messages', {
        roomId: chatroom?.id,
        message: err?.message,
        status: err?.response?.status,
        data: err?.response?.data,
        err,
      });
      return false;
      }finally {
          pendingPages.current.delete(requestedCursor);
          setLoading(false);
          loadingOlderRef.current = false;
      }
  }

  /* ---------- initial load / room change ---------- */

  useEffect(() => {
    let alive = true;

    setCursor(null);
    setShowNewMessage(false);
    setHasMore(true);

    pendingPages.current.clear();
    setHighestSeenId(0);
    canLoadOlderRef.current = false;

    if (!chatroom?.id) return;

    (async () => {
      try {
        const ok = await loadMore(true);
        if (!alive || !ok) return;

        // allow top-pagination only after initial load settles
        requestAnimationFrame(() => {
          canLoadOlderRef.current = true;
        });

        await markNewestUnreadBulk(50);

        socket.emit('join:rooms', [String(chatroom.id)]);
        socket.emit('join_room', chatroom.id);
      } catch (e) {
        console.error('initial load failed', e);
      }
    })();

  return () => {
    alive = false;
    socket.emit('leave_room', chatroom.id);
  };
}, [chatroom?.id, markNewestUnreadBulk]);

  /* ---------- infinite scroll: load older when near TOP ---------- */

  useEffect(() => {
  const v = scrollViewportRef.current;
  if (!v) return;

  let ticking = false;

  const onScroll = () => {
    if (!canLoadOlderRef.current) return;
    if (loadingOlderRef.current) return;

    if (ticking) return;
    ticking = true;

    requestAnimationFrame(() => {
      ticking = false;

      const vv = scrollViewportRef.current;
      if (!vv) return;

      if (vv.scrollTop > 120) return;
      if (!hasMore || !cursor || loadingOlderRef.current) return;

      loadMore(false);
    });
  };

  v.addEventListener('scroll', onScroll, { passive: true });
  return () => v.removeEventListener('scroll', onScroll);
}, [chatroom?.id, cursor, hasMore]);

  /* ---------- realtime: new messages + typing ---------- */

  useEffect(() => {
    if (!chatroom || !currentUserId) return;

    const mergeIncomingMessage = mergeIncomingMessageFactory(setMessages);
    const mergeIncomingBatch = mergeIncomingBatchFactory(setMessages);

    // handler that decrypts then merges a single incoming msg
    const handleReceiveMessage = async (payload) => {
      const raw = payload?.item ?? payload;
      if (Number(raw?.chatRoomId) !== Number(chatroom.id)) return;

      try {
        const priv = await maybeGetUnlockedPrivateKey();
        const [decrypted] = await maybeDecryptFetchedMessages([raw], priv, null, currentUserId);

        // merge decrypted row into local state (factory handles merge/ordering)
        mergeIncomingMessage(decrypted);

        const incomingId = Number(decrypted?.id || 0);
        if (Number.isFinite(incomingId) && incomingId > 0) {
          setHighestSeenId((prev) => Math.max(prev || 0, incomingId));
        }

        // persist single canonical message (dedup/upsert)
        upsertMessage(chatroom.id, decrypted).catch(() => {});

        // persist to local cache
        addMessages(chatroom.id, [decrypted]).catch(() => {});

        // read-receipt: if it's NOT mine and I'm in this chat, mark it read
        const decryptedSenderId = decrypted?.sender?.id ?? decrypted?.senderId;
        const isMine = Number(decryptedSenderId) === Number(currentUserId);
        if (!isMine) {
          markMessageRead(decrypted?.id ?? raw?.id);
        }

        // scroll / sound
        const v = scrollViewportRef.current;
        const atBottom = v && v.scrollTop + v.clientHeight >= v.scrollHeight - 10;
        if (atBottom) scrollToBottomNow();
        else setShowNewMessage(true);

        const tabHidden = document.hidden;
        if (!isMine && (!atBottom || tabHidden)) {
          playSound('/sounds/new-message.mp3', { volume: 0.6 });
        }
      } catch (e) {
        console.error('Failed to decrypt/merge incoming message', e);
        // fallback: merge raw payload so we still see something
        mergeIncomingMessage(raw);

        // fallback read receipt
        const isMine = Number(raw?.sender?.id ?? raw?.senderId) === Number(currentUserId);
        if (!isMine) markMessageRead(raw?.id);

        const v = scrollViewportRef.current;
        const atBottom = v && v.scrollTop + v.clientHeight >= v.scrollHeight - 10;
        if (atBottom) scrollToBottomNow();
        else setShowNewMessage(true);

        const tabHidden = document.hidden;
        if (!isMine && (!atBottom || tabHidden)) {
          playSound('/sounds/new-message.mp3', { volume: 0.6 });
        }
      }
    };

    // If server sometimes sends batches (e.g., replay), handle them
    const handleBatch = async (payload) => {
      const rows = payload?.items ?? payload;
      if (!Array.isArray(rows) || rows.length === 0) return;

      try {
        const priv = await maybeGetUnlockedPrivateKey();
        const decrypted = await maybeDecryptFetchedMessages(rows, priv, null, currentUserId);

        // decrypted is an array of rows; use batch merge
        mergeIncomingBatch(decrypted);
        addMessages(chatroom.id, decrypted).catch(() => {});

        // update highestSeenId from batch
        const maxInBatch = (decrypted || [])
          .map((m) => Number(m?.id || 0))
          .filter(Number.isFinite)
          .reduce((a, b) => Math.max(a, b), 0);
        if (maxInBatch > 0) {
          setHighestSeenId((prev) => Math.max(prev || 0, maxInBatch));
        }
      } catch (e) {
        console.error('Failed to decrypt incoming batch', e);
        // fallback: merge raw rows
        mergeIncomingBatch(rows);
      }
    };

    // typing handler unchanged
    const onTypingUpdate = ({ roomId, username, isTyping }) => {
      if (Number(roomId) !== Number(chatroom.id)) return;
      setTypingUser(isTyping ? username || '' : '');
    };

    // wire socket events
    socket.on('message:upsert', handleReceiveMessage);
    socket.on('message:new', handleReceiveMessage); // keep legacy support
    socket.on('message:expired', handleReceiveMessage); // optional legacy
    socket.on('message:batch', handleBatch); // if you emit batch replays under this event
    socket.on('typing:update', onTypingUpdate);

    return () => {
      socket.off('message:upsert', handleReceiveMessage);
      socket.off('message:new', handleReceiveMessage);
      socket.off('message:expired', handleReceiveMessage);
      socket.off('message:batch', handleBatch);
      socket.off('typing:update', onTypingUpdate);
    };
  }, [chatroom?.id, currentUserId, scrollToBottomNow, markMessageRead]);

  // ✅ Block (safety feature — FREE)
  const handleBlockThread = useCallback(async () => {
    // Find "other user" for 1:1 rooms
    const participants = Array.isArray(chatroom?.participants) ? chatroom.participants : [];
    const other =
      participants.find((p) => Number(p?.id) !== Number(currentUserId)) ||
      participants.find((p) => Number(p?.userId) !== Number(currentUserId));

    const otherId = Number(other?.id ?? other?.userId);

    const name = other?.username || other?.displayName || other?.name || 'this user';

    const ok = window.confirm(`Block ${name}? You won't receive messages from them.`);
    if (!ok) return;

    try {
      // ✅ Recommended: implement this endpoint
      // POST /blocks  { targetUserId }
      if (Number.isFinite(otherId)) {
        await axiosClient.post('/blocks', { targetUserId: otherId });
      } else {
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
    socket.on('message:expired', onExpired);
    return () => socket.off('message:expired', onExpired);
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

      const editedAt = payload?.editedAt ?? payload?.message?.editedAt ?? new Date().toISOString();

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
    const onRead = (payload) => {
      // Supports either:
      // 1) { messageId, reader }
      // 2) { chatRoomId, readerId, messageIds, readAt }
      // 3) { messageIds, reader, readAt }
      const messageIds =
        (Array.isArray(payload?.messageIds) && payload.messageIds) ||
        (payload?.messageId ? [payload.messageId] : []);

      if (!messageIds.length) return;

      const readerId = payload?.readerId ?? payload?.reader?.id ?? payload?.reader?.userId;

      // Ignore "me read my own messages"
      if (!readerId || Number(readerId) === Number(currentUserId)) return;

      const readAt = payload?.readAt ?? new Date().toISOString();

      const messageIdSet = new Set(messageIds.map(String));

      setMessages((prev) =>
        prev.map((m) => {
          if (!messageIdSet.has(String(m.id))) return m;

          // stamp readAt for UI (simple 1:1 "Seen")
          const next = { ...m, readAt: m.readAt ?? readAt };

          // keep your existing readBy array behavior (optional)
          if (payload?.reader) {
            const r = payload.reader;
            next.readBy = Array.isArray(m.readBy)
              ? m.readBy.some((u) => Number(u.id) === Number(r.id))
                ? m.readBy
                : [...m.readBy, r]
              : [r];
          }

          return next;
        })
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

  useEffect(() => {
    if (!chatroom?.id) return;

    const onSocketConnect = async () => {
      if (!highestSeenId || highestSeenId <= 0) return;

      try {
        const resp = await fetchMessageDeltas(chatroom.id, highestSeenId);
        const rows = resp?.items || [];
        if (!rows.length) return;

        const priv = await maybeGetUnlockedPrivateKey();
        const decrypted = await maybeDecryptFetchedMessages(rows, priv, null, currentUserId);

        const chronological = decrypted.slice().reverse();

        setMessages((prev) => {
          const seen = new Set(prev.map((m) => String(m.id ?? m.clientMessageId ?? '')));
          const newRows = chronological.filter(
            (m) => !seen.has(String(m.id ?? m.clientMessageId ?? ''))
          );
          return [...prev, ...newRows]; // new messages arrive at end (newest)
        });

        addMessages(chatroom.id, chronological).catch(() => {});

        const maxId = (decrypted || [])
          .map((m) => Number(m?.id || 0))
          .filter(Number.isFinite)
          .reduce((a, b) => Math.max(a, b), 0);
        if (maxId > 0) setHighestSeenId((prev) => Math.max(prev || 0, maxId));
      } catch (e) {
        console.error('Delta resync failed on socket reconnect', e);
      }
    };

    socket.on('connect', onSocketConnect);
    return () => {
      socket.off('connect', onSocketConnect);
    };
  }, [chatroom?.id, highestSeenId, currentUserId]);

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
      setForcedCalendarText(null);
    }
  };

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

  /* ---------- backend ops: edit/delete/clear ---------- */

  const handleClearForMe = useCallback(async () => {
    if (!chatroom?.id) return;

    const ok = window.confirm(
      'Clear this conversation for you? This hides prior messages for your account.'
    );
    if (!ok) return;

    setMessages([]);
    setCursor(null);
    setShowNewMessage(false);

    try {
      await axiosClient.post(`/messages/${chatroom.id}/clear`);
      await loadMore(true);
    } catch (e) {
      console.error('Clear-for-me failed', e);
      await loadMore(true);
    }
  }, [chatroom?.id]);

  const getBestPlaintextForReport = useCallback((m) => {
    return (
      m?.decryptedContent ||
      m?.translatedForMe ||
      m?.rawContent ||
      m?.content ||
      ''
    );
  }, []);

  const openReportModal = useCallback((msg) => {
    setReportTarget(msg);
    setReportReason('harassment');
    setReportDetails('');
    setReportContextCount('10');
    setBlockAfterReport(true);
    setReportError('');
    setReportOpen(true);
  }, []);

  const submitReport = useCallback(async () => {
    if (!reportTarget?.id) return;

    setReportSubmitting(true);
    setReportError('');

    try {
      const targetIndex = messages.findIndex((m) => m.id === reportTarget.id);
      const contextCount = Math.max(0, Number(reportContextCount || 0));

      const start = Math.max(0, targetIndex - contextCount);
      const selected =
        targetIndex >= 0 ? messages.slice(start, targetIndex + 1) : [reportTarget];

      const evidenceMessages = selected.map((m) => ({
        messageId: m.id,
        senderId: m.sender?.id ?? m.senderId ?? null,
        createdAt: m.createdAt ?? null,
        plaintext: getBestPlaintextForReport(m),
        translatedForMe: m.translatedForMe ?? null,
        rawContent: m.rawContent ?? null,
        content: m.content ?? null,
        contentCiphertext: m.contentCiphertext ?? null,
        encryptedKeyForMe: m.encryptedKeyForMe ?? null,
        attachments: Array.isArray(m.attachments) ? m.attachments : [],
        deletedForAll: !!m.deletedForAll,
        editedAt: m.editedAt ?? null,
      }));

      const payload = {
        messageId: reportTarget.id,
        chatRoomId: chatroom?.id,
        reportedUserId: reportTarget.sender?.id ?? reportTarget.senderId ?? null,
        reason: reportReason,
        details: reportDetails,
        blockAfterReport,
        messages: evidenceMessages,
        clientMetadata: {
          platform: 'web',
          locale: navigator.language || 'en-US',
        },
      };

      const res = await reportMessage(payload);
      if (!res.ok) {
        let msg = 'Failed to submit report';
        try {
          const data = await res.json();
          msg = data?.error || data?.message || msg;
        } catch {}
        throw new Error(msg);
      }

      if (blockAfterReport) {
        const targetUserId = Number(reportTarget.sender?.id ?? reportTarget.senderId);
        if (Number.isFinite(targetUserId) && targetUserId !== Number(currentUserId)) {
          try {
            await axiosClient.post('/blocks', { targetUserId });
          } catch (e) {
            console.warn('Block after report failed', e);
          }
        }
      }

      setReportOpen(false);
      setReportTarget(null);
      setReportDetails('');
      setReportError('');
      window.alert('Report submitted.');
    } catch (e) {
      console.error('submitReport failed', e);
      setReportError(e?.message || 'Failed to submit report');
    } finally {
      setReportSubmitting(false);
    }
  }, [
    reportTarget,
    reportContextCount,
    reportReason,
    reportDetails,
    blockAfterReport,
    messages,
    chatroom?.id,
    currentUserId,
    getBestPlaintextForReport,
  ]);

  const handleClearForEveryone = useCallback(async () => {
    if (!chatroom?.id) return;

    const ok = window.confirm(
      'Clear this conversation for everyone? All messages will show “This message was deleted”.'
    );
    if (!ok) return;

    const nowIso = new Date().toISOString();

    setMessages((prev) =>
      prev.map((m) => ({
        ...m,
        deletedForAll: true,
        deletedAt: nowIso,
        deletedById: currentUserId,
        rawContent: '',
        content: '',
        translatedForMe: null,
        attachments: [],
        attachmentsInline: [],
      }))
    );

    try {
      await axiosClient.post(`/messages/${chatroom.id}/clear-all`);
    } catch (e) {
      console.error('Clear-for-everyone failed', e);
      setMessages([]);
      setCursor(null);
      await loadMore(true);
    }
  }, [chatroom?.id, currentUserId]);

  /* ---------- empty state (no chat selected) ---------- */

  if (!chatroom) {
    const showPromo =
      !isPremium &&
      !emptyDismissed &&
      canShow(PLACEMENTS.EMPTY_STATE_PROMO, 'app') &&
      Object.keys(ADS_CONFIG?.house || {}).length > 0;

      console.log('CHATVIEW FILE IS RUNNING');

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

  const lastOutgoingId = useMemo(() => {
    // last message sent by me
    const last = [...messages].reverse().find((m) => {
      const senderId = m.sender?.id ?? m.senderId;
      return Number(senderId) === Number(currentUserId);
    });
    return last?.id ?? null;
  }, [messages, currentUserId]);

  const lastOutgoingSeen = useMemo(() => {
    if (!lastOutgoingId) return false;

    const m = messages.find((x) => x.id === lastOutgoingId);
    if (!m) return false;

    // Prefer readAt if available
    if (m.readAt) return true;

    // Fallback to readBy if your server uses it
    if (Array.isArray(m.readBy) && Number.isFinite(otherUserId)) {
      return m.readBy.some((u) => Number(u?.id) === Number(otherUserId));
    }

    return false;
  }, [messages, lastOutgoingId, otherUserId]);

  /* ---------- render ---------- */

  return (
    <Box
      style={{
        flex: 1,
        minHeight: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
    }}
  >
    <ThreadShell
      header={
        <Box
          p="md"
          className={clsx(
            privacyActive && !reveal && 'privacy-blur',
            reveal && 'privacy-revealed'
          )}
          onMouseDown={holdToReveal ? () => setReveal(true) : undefined}
          onMouseUp={holdToReveal ? () => setReveal(false) : undefined}
          onMouseLeave={holdToReveal ? () => setReveal(false) : undefined}
          onTouchStart={holdToReveal ? () => setReveal(true) : undefined}
          onTouchEnd={holdToReveal ? () => setReveal(false) : undefined}
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
                  {chatroom?.name || otherParticipant?.username || otherParticipant?.displayName || otherParticipant?.name || 'Conversation'}
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
                <Tooltip label="Call" withArrow>
                  <ActionIcon
                    variant="subtle"
                    onClick={startChatCall}
                    aria-label="Start voice call"
                  >
                    <IconPhoneCall size={18} />
                  </ActionIcon>
                </Tooltip>

                <Tooltip label="Video" withArrow>
                  <ActionIcon
                    variant="subtle"
                    onClick={startChatVideo}
                    aria-label="Start video call"
                  >
                    <IconVideo size={18} />
                  </ActionIcon>
                </Tooltip>

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
                  onClear={handleClearForMe}
                  onClearAll={handleClearForEveryone}
                  clearLabel="Clear conversation"
                />
              </Group>
            </Group>
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

              try {
                // 1) attachments already uploaded -> send canonical HTTP
                if (payload?.attachments?.length) {
                  await axiosClient.post(
                    '/messages',
                    {
                      chatRoomId: chatroom.id,
                      content: text || '',
                      attachmentsInline: payload.attachments.map((f) => ({
                        kind: (f.contentType || '').startsWith('audio/') ? 'AUDIO' : 'FILE',
                        url: f.url,
                        mimeType: f.contentType || 'audio/webm',
                        durationSec: f.durationSec || null,
                        caption: f.caption || null,
                      })),
                    },
                    { headers: { 'X-Requested-With': 'XMLHttpRequest' } }
                  );

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

                // 3) normal text send (canonical HTTP)
                if (!text) return;

                await axiosClient.post(
                  '/messages',
                  { chatRoomId: chatroom.id, content: text },
                  { headers: { 'X-Requested-With': 'XMLHttpRequest' } }
                );

                setDraft('');
              } catch (e) {
                console.error('Send failed', e);
              }
            }}
          />
        </Box>
      }
    >
      <Box
        w="100%"
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {!isPremium && showThreadTop && (
          <div style={{ padding: '8px 12px', flex: '0 0 auto' }}>
            <CardAdWrap>
              <HouseAdSlot placement="thread_top" variant="card" />
            </CardAdWrap>
          </div>
        )}

        {e2eeLocked && (
          <Alert color="yellow" variant="light" mx="md" mt="sm">
            Encrypted messages are locked on this device. Unlock your private key to view them.
          </Alert>
        )}

        <ScrollArea
          key={chatroom?.id}
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            height: 0,
          }}
          viewportRef={scrollViewportRef}
          type="auto"
        >
          <Box
            style={{
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Stack gap="xs" p="xs">
              {messages.map((m, idx) => {
                const msg = normalizeMsg(m);
                const isLastOutgoing = msg.id && msg.id === lastOutgoingId;

                const prevRaw = messages[idx - 1];
                const prevMsg = prevRaw ? normalizeMsg(prevRaw) : null;

                const nextRaw = messages[idx + 1];
                const nextMsg = nextRaw ? normalizeMsg(nextRaw) : null;

                const thisSenderId = Number(msg?.sender?.id ?? msg?.senderId ?? 0);
                const prevSenderId = Number(prevMsg?.sender?.id ?? prevMsg?.senderId ?? 0);
                const nextSenderId = Number(nextMsg?.sender?.id ?? nextMsg?.senderId ?? 0);

                const thisTime = msg?.createdAt ? new Date(msg.createdAt).getTime() : 0;
                const prevTime = prevMsg?.createdAt ? new Date(prevMsg.createdAt).getTime() : 0;
                const nextTime = nextMsg?.createdAt ? new Date(nextMsg.createdAt).getTime() : 0;

                const prevGapMs = thisTime && prevTime ? thisTime - prevTime : 0;
                const nextGapMs = thisTime && nextTime ? nextTime - thisTime : 0;

                const sameAsPrev =
                  !!prevMsg &&
                  thisSenderId === prevSenderId &&
                  prevGapMs <= 5 * 60 * 1000;

                const isRestartAfterGap = nextGapMs > 5 * 60 * 1000;

                const showTail =
                  !nextMsg ||
                  thisSenderId !== nextSenderId ||
                  isRestartAfterGap;

                return (
                  <Box
                    key={msg.id ?? `${msg.createdAt}-${idx}`}
                    mt={sameAsPrev ? 4 : 12}
                  >
                    <MessageBubble
                      msg={msg}
                      currentUserId={currentUserId}
                      onRetry={handleRetry}
                      onEdit={(mm) => handleEditMessage(mm)}
                      onDeleteMe={(mm) => handleDeleteMessage(mm, 'me')}
                      onDeleteAll={(mm) => handleDeleteMessage(mm, 'all')}
                      onAddToCalendar={(mm) => handleAddToCalendarFromMessage(mm)}
                      onReport={(mm) => openReportModal(mm)}
                      canEdit={canEditMessage(msg)}
                      canDeleteAll={canDeleteForEveryone(msg)}
                      showTail={showTail}
                      sameAsPrev={sameAsPrev}
                    />

                    {chatroom?.participants?.length === 2 && msg.mine && isLastOutgoing && (
                      <Text size="xs" c="dimmed" ta="right" mt={4} mr={6}>
                        {lastOutgoingSeen ? 'Seen' : ''}
                      </Text>
                    )}
                  </Box>
                );
              })}

              <div ref={messagesEndRef} />
            </Stack>
          </Box>
        </ScrollArea>

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

      <Modal
        opened={reportOpen}
        onClose={() => setReportOpen(false)}
        title="Report message"
        centered
        radius="lg"
      >
        <Stack>
          <Select
            label="Reason"
            value={reportReason}
            onChange={(value) => setReportReason(value || 'harassment')}
            data={[
              { value: 'harassment', label: 'Harassment' },
              { value: 'threats', label: 'Threats' },
              { value: 'hate', label: 'Hate or abusive conduct' },
              { value: 'sexual_content', label: 'Sexual content' },
              { value: 'spam_scam', label: 'Spam or scam' },
              { value: 'impersonation', label: 'Impersonation' },
              { value: 'other', label: 'Other' },
            ]}
          />

          <Select
            label="Include previous messages"
            value={reportContextCount}
            onChange={(value) => setReportContextCount(value || '10')}
            data={[
              { value: '0', label: 'Only this message' },
              { value: '5', label: 'This + previous 5' },
              { value: '10', label: 'This + previous 10' },
              { value: '20', label: 'This + previous 20' },
            ]}
          />

          <Textarea
            label="Additional details"
            placeholder="Anything else moderators should know?"
            value={reportDetails}
            onChange={(e) => setReportDetails(e.currentTarget.value)}
            autosize
            minRows={3}
          />

          <Checkbox
            label="Block this user after reporting"
            checked={blockAfterReport}
            onChange={(e) => setBlockAfterReport(e.currentTarget.checked)}
          />

          {reportTarget && (
            <Alert variant="light">
              <Text size="sm">
                Reporting message from{' '}
                <strong>{reportTarget.sender?.username || 'Unknown user'}</strong>
              </Text>
              <Text size="sm" mt={6}>
                {getBestPlaintextForReport(reportTarget) || '[No visible text]'}
              </Text>
            </Alert>
          )}

          {reportError && (
            <Alert color="red" variant="light">
              {reportError}
            </Alert>
          )}

          <Group justify="flex-end">
            <Button variant="light" onClick={() => setReportOpen(false)}>
              Cancel
            </Button>
            <Button color="red" onClick={submitReport} loading={reportSubmitting}>
              Submit report
            </Button>
          </Group>
        </Stack>
      </Modal>
    </ThreadShell>
    </Box>
  );
}