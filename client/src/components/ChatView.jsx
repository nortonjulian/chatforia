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

import { useSocket } from '@/context/SocketContext';
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
import ReportModal from '@/components/chat/ReportModal.jsx';

// ✅ Message row UI (menu + tombstone)
import MessageBubble from '@/components/chat/MessageBubble.jsx';

import { playSound } from '@/lib/sounds.js';

// 🔒 Premium check
import useIsPremium from '@/hooks/useIsPremium';

// 🧱 Ads (render only for Free users)
import { CardAdWrap } from '@/ads/AdWrappers';
import HouseAdSlot from '@/ads/HouseAdSlot';
import { PLACEMENTS } from '@/ads/placements';
import { useAds } from '@/ads/AdProvider';
import { ADS_CONFIG } from '@/ads/config';

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

function unwrapMessage(payload) {
  return payload?.item ?? payload?.message ?? payload?.shaped ?? payload;
}

function getMessageRoomId(payload) {
  return Number(
    payload?.chatRoomId ??
      payload?.chatroomId ??
      payload?.roomId ??
      payload?.chat_room_id ??
      payload?.message?.chatRoomId ??
      payload?.message?.chatroomId ??
      payload?.message?.roomId ??
      payload?.message?.chat_room_id ??
      payload?.item?.chatRoomId ??
      payload?.item?.chatroomId ??
      payload?.item?.roomId ??
      payload?.item?.chat_room_id ??
      0
  );
}

function getMessageKey(m) {
  if (m?.id != null) return `id:${m.id}`;
  if (m?.clientMessageId != null) return `client:${m.clientMessageId}`;
  return `tmp:${m?.createdAt ?? Math.random()}`;
}

function sortMessagesChronologically(arr) {
  return arr.sort((a, b) => {
    const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return (Number(a?.id) || 0) - (Number(b?.id) || 0);
  });
}

function upsertLocalMessage(prev, incoming) {
  if (!incoming) return prev;

  const incomingId = incoming?.id != null ? String(incoming.id) : null;
  const incomingClientId =
    incoming?.clientMessageId != null ? String(incoming.clientMessageId) : null;

  let found = false;

  const next = prev.map((m) => {
    const sameId = incomingId && m?.id != null && String(m.id) === incomingId;
    const sameClientId =
      incomingClientId &&
      m?.clientMessageId != null &&
      String(m.clientMessageId) === incomingClientId;

    if (sameId || sameClientId) {
      found = true;
      return { ...m, ...incoming };
    }
    return m;
  });

  if (!found) next.push(incoming);

  return sortMessagesChronologically(next);
}

function mergeIncomingMessageFactory(setMessages) {
  return (incoming) => {
    if (!incoming) return;

    setMessages((prev) => {
      const map = new Map(prev.map((m) => [getMessageKey(m), m]));
      const key = getMessageKey(incoming);
      map.set(key, { ...(map.get(key) || {}), ...incoming });
      return sortMessagesChronologically(Array.from(map.values()));
    });
  };
}

function mergeIncomingBatchFactory(setMessages) {
  return (rows = []) => {
    if (!Array.isArray(rows) || rows.length === 0) return;

    setMessages((prev) => {
      const map = new Map(prev.map((m) => [getMessageKey(m), m]));
      for (const r of rows) {
        if (!r) continue;
        const key = getMessageKey(r);
        map.set(key, { ...(map.get(key) || {}), ...r });
      }
      return sortMessagesChronologically(Array.from(map.values()));
    });
  };
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getSenderId(message) {
  return message?.sender?.id ?? message?.senderId ?? message?.userId ?? null;
}

function isSameUser(a, b) {
  const aa = toNum(a);
  const bb = toNum(b);
  return aa > 0 && bb > 0 && aa === bb;
}

/* ---------- component ---------- */
export default function ChatView({ chatroom, currentUserId, currentUser }) {
  const isPremium = useIsPremium();
  const navigate = useNavigate();

  const [messages, setMessages] = useState([]);
  const [typingUser, setTypingUser] = useState('');
  const [showNewMessage, setShowNewMessage] = useState(false);

  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const loadingOlderRef = useRef(false);

  const [reveal, setReveal] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);

  const [draft, setDraft] = useState('');
  const [forcedCalendarText, setForcedCalendarText] = useState(null);
  const [highestSeenId, setHighestSeenId] = useState(0);

  const [reportOpen, setReportOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  const [reportReason, setReportReason] = useState('harassment');
  const [reportDetails, setReportDetails] = useState('');
  const [reportContextCount, setReportContextCount] = useState('10');
  const [blockAfterReport, setBlockAfterReport] = useState(true);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportError, setReportError] = useState('');

  const [e2eeLocked, setE2eeLocked] = useState(false);

  // ✅ new edit/delete modal state
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editText, setEditText] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteMode, setDeleteMode] = useState('me');
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const pendingPages = useRef(new Set());
  const canLoadOlderRef = useRef(false);

  const ads = useAds();
  const canShow = ads?.canShow || (() => true);
  const markShown = ads?.markShown || (() => {});

  const { socket } = useSocket();

  const isOwnerOrAdmin =
    currentUser?.role === 'ADMIN' || currentUser?.id === chatroom?.ownerId;

  const isRandomRoom = Boolean(
    chatroom?.isRandom ||
      chatroom?.origin === 'random' ||
      chatroom?.randomChatRoomId ||
      (Array.isArray(chatroom?.tags) && chatroom.tags.includes('random'))
  );

  const otherParticipant = useMemo(() => {
    const ps = Array.isArray(chatroom?.participants) ? chatroom.participants : [];
    return (
      ps.find((p) => Number(p?.id ?? p?.userId) !== Number(currentUserId)) || null
    );
  }, [chatroom?.participants, currentUserId]);

  const otherUserId = Number(otherParticipant?.id ?? otherParticipant?.userId);

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

  const markMessageRead = useCallback(async (messageId) => {
    if (!messageId) return;
    try {
      await axiosClient.patch(`/messages/${messageId}/read`);
    } catch (e) {
      console.error('PATCH read failed', e);
    }
  }, []);

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
  useNow();

  useEffect(() => {
    setMessages([]);
    setCursor(null);
    setHasMore(true);
    setHighestSeenId(0);
  }, [chatroom?.id]);

  const [emptyDismissed] = useDismissed('empty_state_promo', 14);
  const shouldShowEmptyPromo =
    !chatroom &&
    !isPremium &&
    !emptyDismissed &&
    canShow(PLACEMENTS.EMPTY_STATE_PROMO, 'app');

  useEffect(() => {
    if (shouldShowEmptyPromo) markShown(PLACEMENTS.EMPTY_STATE_PROMO, 'app');
  }, [shouldShowEmptyPromo, markShown]);

  const normalizeMsg = useCallback(
    (m) => {
      const mine = Boolean(m.mine) || isSameUser(getSenderId(m), currentUserId);

      const content =
        m.decryptedContent ||
        m.translatedForMe ||
        m.rawContent ||
        m.content ||
        null;

      return { ...m, mine, content };
    },
    [currentUserId]
  );

  const canEditMessage = useCallback(
    (m) => {
      if (!isSameUser(getSenderId(m), currentUserId)) return false;
      if (m.deletedForAll) return false;
      return true;
    },
    [currentUserId]
  );

  const canDeleteForEveryone = useCallback(
    (m) => {
      if (!isSameUser(getSenderId(m), currentUserId)) return false;
      if (m.deletedForAll) return false;
      return true;
    },
    [currentUserId]
  );

  const startChatCall = useCallback(() => {
    if (!chatroom?.id) return;
    navigate(`/calls?roomId=${encodeURIComponent(String(chatroom.id))}`);
  }, [chatroom?.id, navigate]);

  const startChatVideo = useCallback(() => {
    if (!chatroom?.id) return;
    navigate(`/video?roomId=${encodeURIComponent(String(chatroom.id))}`);
  }, [chatroom?.id, navigate]);

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

  // ✅ modal open helpers
  const openEditModal = useCallback((msg) => {
    const current = msg.rawContent ?? msg.content ?? '';
    setEditTarget(msg);
    setEditText(current);
    setEditOpen(true);
  }, []);

  const closeEditModal = useCallback(() => {
    if (editSubmitting) return;
    setEditOpen(false);
    setEditTarget(null);
    setEditText('');
  }, [editSubmitting]);

  const openDeleteModal = useCallback((msg, mode = 'me') => {
    setDeleteTarget(msg);
    setDeleteMode(mode);
    setDeleteOpen(true);
  }, []);

  const closeDeleteModal = useCallback(() => {
    if (deleteSubmitting) return;
    setDeleteOpen(false);
    setDeleteTarget(null);
    setDeleteMode('me');
  }, [deleteSubmitting]);

  // ✅ real edit submit
  const handleEditMessage = useCallback(async () => {
  if (!editTarget?.id) return;

  const current = editTarget.rawContent ?? editTarget.content ?? '';
  const newText = editText.trim();

  if (!newText || newText === current) {
    closeEditModal();
    return;
  }

  try {
    setEditSubmitting(true);

    const { data } = await axiosClient.patch(
      `/messages/${editTarget.id}/edit`,
      { newContent: newText }
    );

    const updated = data?.message ?? data ?? null;

    const merged =
      updated != null
        ? {
            ...editTarget,
            ...updated,
            rawContent: updated.rawContent ?? newText,
            content: updated.rawContent ?? newText,
            decryptedContent: updated.rawContent ?? newText,
            translatedForMe: updated.translatedForMe ?? null,
            editedAt: updated.editedAt ?? new Date().toISOString(),
          }
        : {
            ...editTarget,
            rawContent: newText,
            content: newText,
            decryptedContent: newText,
            translatedForMe: null,
            editedAt: new Date().toISOString(),
          };

    setMessages((prev) => upsertLocalMessage(prev, merged));

    if (chatroom?.id) {
      upsertMessage(chatroom.id, merged).catch(() => {});
      addMessages(chatroom.id, [merged]).catch(() => {});
    }

    closeEditModal();
  } catch (error) {
    console.error('Message edit failed', error);
  } finally {
    setEditSubmitting(false);
  }
}, [editTarget, editText, closeEditModal, chatroom?.id]);

  // ✅ real delete submit
  const handleDeleteMessage = useCallback(async () => {
    if (!deleteTarget?.id) return;

    const msg = deleteTarget;
    const mode = deleteMode;

    try {
      setDeleteSubmitting(true);

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

      await axiosClient.delete(`/messages/${msg.id}`, {
        params: { mode },
        data: { mode },
      });

      closeDeleteModal();
    } catch (e) {
      console.error('Delete failed', e);
      await loadMore(true);
    } finally {
      setDeleteSubmitting(false);
    }
  }, [deleteTarget, deleteMode, closeDeleteModal]);

  async function maybeGetUnlockedPrivateKey() {
    try {
      const mod = await loadEncryptionClient();

      if (
        typeof mod.getUnlockedPrivateKeyForPublicKey === 'function' &&
        currentUser?.publicKey
      ) {
        return await mod.getUnlockedPrivateKeyForPublicKey(currentUser.publicKey);
      }

      if (typeof mod.getUnlockedPrivateKey === 'function') {
        return await mod.getUnlockedPrivateKey();
      }

      return null;
    } catch {
      return null;
    }
  }

  async function maybeDecryptFetchedMessages(rows, privKey, senderKeys = null, uid = null) {
    try {
      const mod = await loadEncryptionClient();
      if (typeof mod.decryptFetchedMessages === 'function') {
        return await mod.decryptFetchedMessages(rows, privKey, senderKeys, uid);
      }
    } catch {}
    return rows;
  }

  async function loadMore(initial = false) {
    if (!chatroom?.id) return false;
    if (loadingOlderRef.current) return false;

    const requestedCursor = initial ? 'initial' : cursor ?? 'null';
    if (pendingPages.current.has(requestedCursor)) return false;
    pendingPages.current.add(requestedCursor);

    loadingOlderRef.current = true;
    setLoading(true);

    try {
      let resp;
      if (initial) {
        resp = await fetchLatestMessages(chatroom.id, 50);
      } else {
        resp = await fetchOlderMessages(chatroom.id, cursor, 30);
      }

      const data = resp || {};
      const rows = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.messages)
          ? data.messages
          : Array.isArray(data?.rows)
            ? data.rows
            : Array.isArray(data)
              ? data
              : [];

      const chronological = rows.slice().reverse();

      const maxId = rows
        .map((m) => Number(m?.id || 0))
        .filter(Number.isFinite)
        .reduce((a, b) => Math.max(a, b), 0);

      if (maxId > 0) {
        setHighestSeenId((prev) => Math.max(prev || 0, maxId));
      }

      const looksEncrypted = rows.some(
        (m) => m?.contentCiphertext || m?.encryptedKeyForMe || m?.encryptedKeys
      );
      setE2eeLocked(looksEncrypted);

      if (initial) {
        setMessages(chronological);
        setCursor(data?.nextCursor ?? null);
        setHasMore(Boolean(data?.nextCursor));

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            scrollToBottomNow();
          });
        });
      } else {
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

        setCursor(data?.nextCursor ?? null);
        setHasMore(Boolean(data?.nextCursor));

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
      console.error('[ChatView] loadMore failed', err);
      return false;
    } finally {
      pendingPages.current.delete(requestedCursor);
      setLoading(false);
      loadingOlderRef.current = false;
    }
  }

  // ✅ own room membership here, not in ChatroomList
  useEffect(() => {
    if (!chatroom?.id || !socket) return;

    const roomId = Number(chatroom.id);

    const join = () => {
      if (socket.connected) {
        socket.emit('join_room', roomId);
      }
    };

    join();
    socket.on('connect', join);

    return () => {
      socket.off('connect', join);
      if (socket.connected) {
        socket.emit('leave_room', roomId);
      }
    };
}, [chatroom?.id, socket]);

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

        requestAnimationFrame(() => {
          canLoadOlderRef.current = true;
        });

        await markNewestUnreadBulk(50);
      } catch (e) {
        console.error('initial load failed', e);
      }
    })();

    return () => {
      alive = false;
    };
  }, [chatroom?.id, markNewestUnreadBulk]);

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

  useEffect(() => {
  if (!socket || !chatroom || !currentUserId) return;

  const mergeIncomingMessage = mergeIncomingMessageFactory(setMessages);
  const mergeIncomingBatch = mergeIncomingBatchFactory(setMessages);

  const handleRealtimeMessage = async (payload) => {
    if (getMessageRoomId(payload) !== Number(chatroom.id)) return;

    const raw = unwrapMessage(payload);
    if (!raw) return;

    try {
      const priv = await maybeGetUnlockedPrivateKey();
      const [decrypted] = await maybeDecryptFetchedMessages(
        [raw],
        priv,
        null,
        currentUserId
      );

      const incoming = decrypted ?? raw;
      mergeIncomingMessage(incoming);

      const incomingId = Number(incoming?.id || 0);
      if (Number.isFinite(incomingId) && incomingId > 0) {
        setHighestSeenId((prev) => Math.max(prev || 0, incomingId));
      }

      upsertMessage(chatroom.id, incoming).catch(() => {});
      addMessages(chatroom.id, [incoming]).catch(() => {});

      const isMine = isSameUser(getSenderId(incoming), currentUserId);

      if (!isMine && incoming?.id) {
        markMessageRead(incoming.id);
      }

      const v = scrollViewportRef.current;
      const atBottom = v && v.scrollTop + v.clientHeight >= v.scrollHeight - 10;

      if (atBottom) scrollToBottomNow();
      else setShowNewMessage(true);

      const tabHidden = document.hidden;
      if (!isMine && (!atBottom || tabHidden)) {
        playSound('/sounds/new-message.mp3', { volume: 0.6 });
      }
    } catch (e) {
      console.error('Failed to decrypt/merge incoming realtime message', e);

      mergeIncomingMessage(raw);
      upsertMessage(chatroom.id, raw).catch(() => {});
      addMessages(chatroom.id, [raw]).catch(() => {});

      const isMine = isSameUser(getSenderId(raw), currentUserId);

      if (!isMine && raw?.id) {
        markMessageRead(raw.id);
      }

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

    const handleDeletedMessage = (payload) => {
      if (getMessageRoomId(payload) !== Number(chatroom.id)) return;

      const item = unwrapMessage(payload) ?? payload?.item ?? payload;
      if (!item?.id) return;

      if (item.deletedForMe) {
        setMessages((prev) =>
          prev.filter((m) => Number(m.id) !== Number(item.id))
        );

        upsertMessage(chatroom.id, { ...item, deletedForMe: true }).catch(() => {});
        return;
      }

      mergeIncomingMessage(item);

      const incomingId = Number(item?.id || 0);
      if (Number.isFinite(incomingId) && incomingId > 0) {
        setHighestSeenId((prev) => Math.max(prev || 0, incomingId));
      }

      upsertMessage(chatroom.id, item).catch(() => {});
      addMessages(chatroom.id, [item]).catch(() => {});
  };

  const handleBatch = async (payload) => {
    const rows = payload?.items ?? payload?.messages ?? payload;
    if (!Array.isArray(rows) || rows.length === 0) return;

    const roomFilteredRows = rows.filter(
      (row) => getMessageRoomId(row) === Number(chatroom.id)
    );
    if (!roomFilteredRows.length) return;

    try {
      const priv = await maybeGetUnlockedPrivateKey();
      const decrypted = await maybeDecryptFetchedMessages(
        roomFilteredRows,
        priv,
        null,
        currentUserId
      );

      const incomingRows = decrypted?.length ? decrypted : roomFilteredRows;

      mergeIncomingBatch(incomingRows);
      addMessages(chatroom.id, incomingRows).catch(() => {});

      const maxInBatch = incomingRows
        .map((m) => Number(m?.id || 0))
        .filter(Number.isFinite)
        .reduce((a, b) => Math.max(a, b), 0);

      if (maxInBatch > 0) {
        setHighestSeenId((prev) => Math.max(prev || 0, maxInBatch));
      }
    } catch (e) {
      console.error('Failed to decrypt incoming batch', e);
      mergeIncomingBatch(roomFilteredRows);
    }
  };

  const onTypingUpdate = ({ roomId, username, isTyping }) => {
    if (Number(roomId) !== Number(chatroom.id)) return;
    setTypingUser(isTyping ? username || '' : '');
  };

  socket.on('message:upsert', handleRealtimeMessage);
  socket.on('message:new', handleRealtimeMessage);
  socket.on('message:expired', handleRealtimeMessage);
  socket.on('message:edited', handleRealtimeMessage);
  socket.on('message:deleted', handleDeletedMessage);
  socket.on('message:batch', handleBatch);
  socket.on('typing:update', onTypingUpdate);

  return () => {
    socket.off('message:upsert', handleRealtimeMessage);
    socket.off('message:new', handleRealtimeMessage);
    socket.off('message:expired', handleRealtimeMessage);
    socket.off('message:edited', handleRealtimeMessage);
    socket.off('message:deleted', handleRealtimeMessage);
    socket.off('message:batch', handleBatch);
    socket.off('typing:update', onTypingUpdate);
  };
}, [socket, chatroom?.id, currentUserId, scrollToBottomNow, markMessageRead]);

  const handleBlockThread = useCallback(async () => {
    const participants = Array.isArray(chatroom?.participants) ? chatroom.participants : [];
    const other =
      participants.find((p) => Number(p?.id) !== Number(currentUserId)) ||
      participants.find((p) => Number(p?.userId) !== Number(currentUserId));

    const otherId = Number(other?.id ?? other?.userId);
    const name = other?.username || other?.displayName || other?.name || 'this user';
    const ok = window.confirm(`Block ${name}? You won't receive messages from them.`);
    if (!ok) return;

    try {
      if (Number.isFinite(otherId)) {
        await axiosClient.post('/blocks', { targetUserId: otherId });
      } else {
        throw new Error('Could not determine a target user to block.');
      }

      window.alert(`Blocked ${name}.`);
      navigate('/');
    } catch (e) {
      console.error('Block failed', e);
      window.alert('Block failed (backend not wired yet).');
    }
  }, [chatroom?.participants, currentUserId, navigate]);


  useEffect(() => {
  if (!socket) return;

  const onRead = (payload) => {
    const messageIds =
      (Array.isArray(payload?.messageIds) && payload.messageIds) ||
      (payload?.messageId ? [payload.messageId] : []);

    if (!messageIds.length) return;

    const readerId = payload?.readerId ?? payload?.reader?.id ?? payload?.reader?.userId;
    if (!readerId || Number(readerId) === Number(currentUserId)) return;

    const readAt = payload?.readAt ?? new Date().toISOString();
    const messageIdSet = new Set(messageIds.map(String));

    setMessages((prev) =>
      prev.map((m) => {
        if (!messageIdSet.has(String(m.id))) return m;

        const next = { ...m, readAt: m.readAt ?? readAt };

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
}, [socket, currentUserId]);

  useEffect(() => {
  if (!socket) return;

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
}, [socket, currentUserId]);

  useEffect(() => {
  if (!socket || !chatroom?.id) return;

  const onSocketConnect = async () => {
    if (!highestSeenId || highestSeenId <= 0) return;

    try {
      const resp = await fetchMessageDeltas(chatroom.id, highestSeenId);
      const rows = resp?.items || [];
      if (!rows.length) return;

      const chronological = rows.slice().reverse();

      setMessages((prev) => {
        const seen = new Set(prev.map((m) => String(m.id ?? m.clientMessageId ?? '')));
        const newRows = chronological.filter(
          (m) => !seen.has(String(m.id ?? m.clientMessageId ?? ''))
        );
        return [...prev, ...newRows];
      });

      addMessages(chatroom.id, chronological).catch(() => {});

      const maxId = rows
        .map((m) => Number(m?.id || 0))
        .filter(Number.isFinite)
        .reduce((a, b) => Math.max(a, b), 0);

      if (maxId > 0) {
        setHighestSeenId((prev) => Math.max(prev || 0, maxId));
      }
    } catch (e) {
      console.error('Delta resync failed on socket reconnect', e);
    }
  };

  socket.on('connect', onSocketConnect);
  return () => {
    socket.off('connect', onSocketConnect);
  };
}, [socket, chatroom?.id, highestSeenId]);

  const { suggestions, clear } = useSmartReplies({
    messages,
    currentUserId,
    enabled: smartEnabled,
    locale: navigator.language || 'en-US',
  });

  const sendSmartReply = (text) => {
    if (!socket || !text?.trim() || !chatroom?.id) return;
    socket.emit('send_message', { content: text, chatRoomId: chatroom.id });
    clear();
 };

  const runPowerAi = async () => {
    if (!isPremium) return navigate('/upgrade');
    try {
      await axiosClient.post('/ai/power-feature', { context: [] });
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

  async function handleRetry(failedMsg) {
    try {
      const payload = {
        chatRoomId: String(chatroom.id),
        content: failedMsg.content || failedMsg.decryptedContent || '',
        expireSeconds: failedMsg.expireSeconds || 0,
        attachmentsInline: failedMsg.attachmentsInline || [],
      };
      const { data } = await axiosClient.post('/messages', payload, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      const saved = unwrapMessage(data);
      setMessages((prev) =>
        prev.map((m) => (m.id === failedMsg.id ? { ...m, ...saved } : m))
      );
    } catch (e) {
      console.error('Retry send failed', e);
    }
  }

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
    return m?.decryptedContent || m?.translatedForMe || m?.rawContent || m?.content || '';
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

  const closeReportModal = useCallback(() => {
    if (reportSubmitting) return;

    setReportOpen(false);
    setReportTarget(null);
    setReportReason('harassment');
    setReportDetails('');
    setReportContextCount('10');
    setBlockAfterReport(true);
    setReportError('');
  }, [reportSubmitting]);

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

      closeReportModal();
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
    closeReportModal,
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
        attachmentsInline: saved.attachmentsInline ?? [],
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

  const privacyActive = Boolean(currentUser?.privacyBlurEnabled);
  const holdToReveal = Boolean(currentUser?.privacyHoldToReveal);

  const showThreadTop = !isPremium && canShow(PLACEMENTS.THREAD_TOP, String(chatroom.id));

  useEffect(() => {
    if (showThreadTop) markShown(PLACEMENTS.THREAD_TOP, String(chatroom.id));
  }, [showThreadTop, markShown, chatroom?.id]);

  const lastOutgoingId = useMemo(() => {
    const last = [...messages].reverse().find((m) =>
      isSameUser(getSenderId(m), currentUserId)
    );
    return last?.id ?? null;
  }, [messages, currentUserId]);

  const lastOutgoingSeen = useMemo(() => {
    if (!lastOutgoingId) return false;

    const m = messages.find((x) => x.id === lastOutgoingId);
    if (!m) return false;

    if (m.readAt) return true;

    if (Array.isArray(m.readBy) && Number.isFinite(otherUserId)) {
      return m.readBy.some((u) => Number(u?.id) === Number(otherUserId));
    }

    return false;
  }, [messages, lastOutgoingId, otherUserId]);

  useEffect(() => {
    let cancelled = false;

    const decryptVisibleMessages = async () => {
      if (!chatroom?.id) return;
      if (!messages.length) return;

      const encryptedRows = messages.filter(
        (m) =>
          (m?.contentCiphertext || m?.encryptedKeyForMe || m?.encryptedKeys) &&
          !m?.decryptedContent
      );

      if (!encryptedRows.length) {
        setE2eeLocked(false);
        return;
      }

      try {
        const priv = await maybeGetUnlockedPrivateKey();

        if (!priv) {
          setE2eeLocked(true);
          return;
        }

        const senderKeys = Object.fromEntries(
          (chatroom?.participants || [])
            .filter(
              (p) =>
                (p?.user?.id || p?.userId || p?.id) &&
                (p?.user?.publicKey || p?.publicKey)
            )
            .map((p) => [
              String(p.user?.id ?? p.userId ?? p.id),
              p.user?.publicKey ?? p.publicKey,
            ])
        );

        const decrypted = await maybeDecryptFetchedMessages(
          encryptedRows,
          priv,
          senderKeys,
          currentUserId
        );

        if (cancelled) return;
        if (!Array.isArray(decrypted) || !decrypted.length) {
          setE2eeLocked(true);
          return;
        }

        const byId = new Map(decrypted.map((m) => [String(m.id), m]));

        setMessages((prev) => {
          let changed = false;

          const next = prev.map((m) => {
            const patched = byId.get(String(m.id));
            if (!patched) return m;

            if (
              patched.decryptedContent &&
              patched.decryptedContent !== '[Encrypted – could not decrypt]' &&
              patched.decryptedContent !== '[Encrypted – key unavailable]' &&
              patched.decryptedContent !== m.decryptedContent
            ) {
              changed = true;
              return { ...m, decryptedContent: patched.decryptedContent };
            }

            return m;
          });

          return changed ? next : prev;
        });

        const anyStillLocked = decrypted.some(
          (m) =>
            m.decryptedContent === '[Encrypted – could not decrypt]' ||
            m.decryptedContent === '[Encrypted – key unavailable]'
        );

        setE2eeLocked(anyStillLocked);
      } catch (e) {
        if (!cancelled) {
          console.warn('[E2EE] background decrypt failed', e);
          setE2eeLocked(true);
        }
      }
    };

    decryptVisibleMessages();

    return () => {
      cancelled = true;
    };
  }, [chatroom?.id, chatroom?.participants, currentUserId, messages.length]);

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
                  {chatroom?.name ||
                    otherParticipant?.username ||
                    otherParticipant?.displayName ||
                    otherParticipant?.name ||
                    'Conversation'}
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
                  <label
                    style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
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

                  <SmartReplyBar suggestions={suggestions} onPick={sendSmartReply} compact />
                </Group>
              }
              onSend={async (payload) => {
                const text = (draft || '').trim();

                try {
                  const buildSenderKeys = () =>
                    Object.fromEntries(
                      (chatroom?.participants || [])
                        .filter(
                          (p) =>
                            (p?.user?.id || p?.userId || p?.id) &&
                            (p?.user?.publicKey || p?.publicKey)
                        )
                        .map((p) => [
                          String(p.user?.id ?? p.userId ?? p.id),
                          p.user?.publicKey ?? p.publicKey,
                        ])
                    );

                  const insertSavedMessage = async (savedRaw, optimisticText = '') => {
                    const saved = unwrapMessage(savedRaw);
                    let rowToInsert = saved;

                    const forceMineShape = (base) => ({
                      ...base,
                      mine: true,
                      senderId: toNum(currentUserId),
                      sender: {
                        ...(base?.sender || {}),
                        id: toNum(currentUserId),
                        username: currentUser?.username ?? base?.sender?.username,
                      },
                    });

                    const makeOptimisticMineRow = (base, optimisticTextValue) =>
                      forceMineShape({
                        ...base,
                        decryptedContent: optimisticTextValue,
                        content: optimisticTextValue,
                        rawContent: optimisticTextValue,
                      });

                    try {
                      const priv = await maybeGetUnlockedPrivateKey();

                      if (priv) {
                        const senderKeys = buildSenderKeys();

                        const [decryptedSaved] = await maybeDecryptFetchedMessages(
                          [saved],
                          priv,
                          senderKeys,
                          currentUserId
                        );

                        if (
                          decryptedSaved &&
                          decryptedSaved.decryptedContent &&
                          decryptedSaved.decryptedContent !== '[Encrypted – key unavailable]' &&
                          decryptedSaved.decryptedContent !== '[Encrypted – could not decrypt]'
                        ) {
                          rowToInsert = decryptedSaved;
                        } else if (optimisticText) {
                          rowToInsert = makeOptimisticMineRow(saved, optimisticText);
                        }
                      } else if (optimisticText) {
                        rowToInsert = makeOptimisticMineRow(saved, optimisticText);
                      }
                    } catch (e) {
                      console.warn('Failed to decrypt sent message response', e);

                      if (optimisticText) {
                        rowToInsert = makeOptimisticMineRow(saved, optimisticText);
                      }
                    }

                    rowToInsert = forceMineShape(rowToInsert);

                    setMessages((prev) => upsertLocalMessage(prev, rowToInsert));
                    scrollToBottomNow();
                  };

                  if (payload?.attachments?.length) {
                      const clientMessageId = `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;

                      const optimisticAttachments = payload.attachments.map((f) => ({
                        kind:
                          f.kind ||
                          ((f.mimeType || f.contentType || '').startsWith('image/')
                            ? 'IMAGE'
                            : (f.mimeType || f.contentType || '').startsWith('video/')
                            ? 'VIDEO'
                            : (f.mimeType || f.contentType || '').startsWith('audio/')
                            ? 'AUDIO'
                            : 'FILE'),
                        url: f.url,
                        mimeType: f.mimeType || f.contentType || '',
                        width: f.width || null,
                        height: f.height || null,
                        durationSec: f.durationSec || null,
                        caption: f.caption || null,
                        thumbUrl: f.previewUrl || f.thumbUrl || f.thumbnailUrl || null,
                      }));

                      setMessages((prev) =>
                        upsertLocalMessage(prev, {
                          id: clientMessageId,
                          clientMessageId,
                          mine: true,
                          senderId: toNum(currentUserId),
                          sender: {
                            id: toNum(currentUserId),
                            username: currentUser?.username ?? null,
                          },
                          createdAt: new Date().toISOString(),
                          rawContent: text || '',
                          content: text || '',
                          decryptedContent: text || '',
                          attachments: optimisticAttachments,
                          attachmentsInline: optimisticAttachments,
                          optimistic: true,
                        })
                      );

                      scrollToBottomNow();

                      const { data } = await axiosClient.post(
                        '/messages',
                        {
                          chatRoomId: chatroom.id,
                          content: text || '',
                          clientMessageId,
                          attachmentsInline: optimisticAttachments,
                        },
                        { headers: { 'X-Requested-With': 'XMLHttpRequest' } }
                      );

                      const saved = unwrapMessage(data);

                      setMessages((prev) => {
                        const replaced = prev.map((m) =>
                          m.clientMessageId === clientMessageId || m.id === clientMessageId
                            ? {
                                ...m,
                                ...saved,
                                clientMessageId,
                                mine: true,
                                optimistic: false,
                                senderId: toNum(currentUserId),
                                sender: {
                                  ...(saved?.sender || {}),
                                  id: toNum(currentUserId),
                                  username: currentUser?.username ?? saved?.sender?.username ?? null,
                                },
                              }
                            : m
                        );

                        const found = replaced.some(
                          (m) => m.clientMessageId === clientMessageId || m.id === saved?.id
                        );

                        return found ? replaced : upsertLocalMessage(replaced, { ...saved, clientMessageId, mine: true });
                      });

                      setDraft('');
                      return;
                    }

                  if (payload?.files?.length) {
                    console.warn(
                      'ThreadComposer provided raw files; wire onUploadFiles to handle uploads.'
                    );
                    return;
                  }

                  if (!text) return;

                  const clientMessageId = `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;

                  const { data } = await axiosClient.post(
                    '/messages',
                    { chatRoomId: chatroom.id, content: text, clientMessageId },
                    { headers: { 'X-Requested-With': 'XMLHttpRequest' } }
                  );

                  await insertSavedMessage(data, text);
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
                  const showTail = !nextMsg || thisSenderId !== nextSenderId || isRestartAfterGap;

                  return (
                    <Box key={msg.id ?? `${msg.createdAt}-${idx}`} mt={sameAsPrev ? 4 : 12}>
                      <MessageBubble
                        msg={msg}
                        currentUserId={currentUserId}
                        onRetry={handleRetry}
                        onEdit={openEditModal}
                        onDeleteMe={(mm) => openDeleteModal(mm, 'me')}
                        onDeleteAll={(mm) => openDeleteModal(mm, 'all')}
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

        {/* ✅ Edit modal */}
        <Modal
          opened={editOpen}
          onClose={closeEditModal}
          title="Edit message"
          centered
          radius="xl"
          padding="md"
        >
          <Stack gap="md">
            {/* Subtitle (matches iOS) */}
            <Text size="sm" c="dimmed">
              Update your message
            </Text>

            {/* Editor card (matches iOS box) */}
            <Box
              style={{
                border: '1px solid var(--border)',
                borderRadius: 18,
                background: 'var(--card)',
              }}
            >
              <Textarea
                value={editText}
                onChange={(e) => setEditText(e.currentTarget.value)}
                autosize
                minRows={6}
                maxRows={10}
                placeholder="Edit your message"
                variant="unstyled"
                styles={{
                  input: {
                    padding: 14,
                    fontSize: '15px',
                    lineHeight: 1.5,
                    color: 'var(--fg)',
                  },
                }}
              />
            </Box>

            {/* Buttons */}
            <Group justify="space-between">
              <Button variant="subtle" color="gray" onClick={closeEditModal}>
                Cancel
              </Button>

              <Button
                onClick={handleEditMessage}
                loading={editSubmitting}
                disabled={
                  !editText.trim() ||
                  editText.trim() ===
                    ((editTarget?.rawContent ?? editTarget?.content ?? '').trim())
                }
              >
                Save
              </Button>
            </Group>
          </Stack>
        </Modal>

        {/* ✅ Delete modal */}
        <Modal
          opened={deleteOpen}
          onClose={closeDeleteModal}
          title={deleteMode === 'all' ? 'Delete for everyone' : 'Delete message'}
          centered
          radius="lg"
        >
          <Stack>
            <Text size="sm" c="dimmed">
              {deleteMode === 'all'
                ? 'This message will be removed for everyone in the conversation.'
                : 'This message will be removed from your view.'}
            </Text>

            {deleteTarget && (
              <Alert variant="light">
                <Text size="sm">
                  {(
                    deleteTarget?.rawContent ||
                    deleteTarget?.content ||
                    deleteTarget?.decryptedContent ||
                    (deleteTarget?.attachments?.length
                      ? `[${deleteTarget.attachments[0].kind === 'IMAGE' ? 'Image' : deleteTarget.attachments[0].kind}]`
                      : '')
                  )}
                </Text>
              </Alert>
            )}

            <Group justify="flex-end">
              <Button variant="light" onClick={closeDeleteModal}>
                Cancel
              </Button>
              <Button color="red" onClick={handleDeleteMessage} loading={deleteSubmitting}>
                Delete
              </Button>
            </Group>
          </Stack>
        </Modal>

        <ReportModal
          opened={reportOpen}
          onClose={closeReportModal}
          target={reportTarget}
          reason={reportReason}
          onReasonChange={setReportReason}
          details={reportDetails}
          onDetailsChange={setReportDetails}
          contextCount={reportContextCount}
          onContextCountChange={setReportContextCount}
          blockAfterReport={blockAfterReport}
          onBlockAfterReportChange={setBlockAfterReport}
          error={reportError}
          submitting={reportSubmitting}
          onSubmit={submitReport}
          getBestPlaintextForReport={getBestPlaintextForReport}
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
              <Button variant="light" onClick={closeReportModal}>
                Cancel
              </Button>
              <Button color="red" onClick={submitReport} loading={reportSubmitting}>
                Submit report
              </Button>
            </Group>
          </Stack>
        </ReportModal>
      </ThreadShell>
    </Box>
  );
}