import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  useLayoutEffect,
} from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  Box,
  Group,
  Paper,
  Text,
  Title,
  Stack,
  ActionIcon,
  Tooltip,
  Menu,
  Textarea,
  Button,
} from '@mantine/core';
import {
  IconSearch,
  IconPhoto,
  IconDotsVertical,
  IconTrash,
  IconPencil,
  IconPhoneCall,
  IconVideo,
} from '@tabler/icons-react';

import axiosClient from '@/api/axiosClient';
import { sendCarrierMmsAttachment } from './sendCarrierMmsAttachment.js';
import ThreadShell from '@/threads/ThreadShell';
import ThreadComposer from '@/threads/ThreadComposer.jsx';
import ThreadActionsMenu from '@/threads/ThreadActionsMenu.jsx';

import SmartReplyBar from '@/components/SmartReplyBar.jsx';
import { useSmartReplies } from '@/hooks/useSmartReplies.js';
import useEntitlements from '@/hooks/useEntitlements';
import { canUseAiComposer } from '@/utils/planAccess';
import { getPref, setPref, PREF_SMART_REPLIES } from '@/utils/prefsStore';
import { useSocket } from '@/context/SocketContext';
import SmsMessageMedia from '@/components/sms/SmsMessageMedia';
import { createSmsThreadLoader, subscribeSmsThread } from '@/utils/smsThreadLive';
import './SmsLayout.css';

// ✅ NEW: local SMS cache + UI
import {
  addSmsMessages,
  searchSmsMessages,
  getSmsMediaItems,
} from '@/utils/smsMessagesStore.js';
import SmsSearchDrawer from '@/components/sms/SmsSearchDrawer.jsx';
import SmsMediaGalleryModal from '@/components/sms/SmsMediaGalleryModal.jsx';
import { useTwilioVoice } from '@/hooks/useTwilioVoice';

function isSmsOutgoing(m) {
  return ['out', 'outbound', 'sent', 'outbound-api', 'outgoing'].includes(
    String(m?.direction || '').toLowerCase()
  );
}

export default function SmsLayout({ currentUserId, currentUser }) {
  const { entitlements: planEntitlements } = useEntitlements();
  const backendAiRewriteLevel =
    planEntitlements?.entitlements?.aiRewriteLevel;

  const aiComposerEnabled = canUseAiComposer(
    backendAiRewriteLevel,
    currentUser
  );

  const { threadId } = useParams();
  const navigate = useNavigate();

  const [thread, setThread] = useState(null);
  const [draft, setDraft] = useState('');

  const [smartEnabled, setSmartEnabled] = useState(
    () => currentUser?.enableSmartReplies ?? false
  );

  // ✅ Edit state
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState('');

  // ✅ Search + media UI
  const [searchOpen, setSearchOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);

  const loaderRef = useRef(null);
  const { socket } = useSocket() ?? {};
  const accountKey = String(currentUser?.id ?? currentUserId ?? '');
  const scopeKey = `${accountKey}:${threadId}`;
  const [loadedScope, setLoadedScope] = useState('');
  const [loadError, setLoadError] = useState('');
  const bottomRef = useRef(null);
  const scrollViewportRef = useRef(null);
  const followBottomRef = useRef(true);

  const {
    startBrowserCall,
    hangup,
    initializing: voiceInitializing,
    calling: voiceCalling,
    callStatus,
    currentCall,
    error: voiceError,
  } = useTwilioVoice();

  const scrollToBottom = useCallback(() => {
    const scroll = () => {
      const viewport = scrollViewportRef.current;
      if (!viewport) return;
      viewport.scrollTop = viewport.scrollHeight;
    };

    const frame = requestAnimationFrame(scroll);

    return () => {
      cancelAnimationFrame(frame);
    };
  }, []);

  useLayoutEffect(() => {
    if (!thread) return undefined;
    followBottomRef.current = true;
    return scrollToBottom();
  }, [thread?.id, thread?.messages?.length, scrollToBottom]);

  // Attachments and composer previews can resize after history first renders.
  // Follow those changes only while the reader is already at the bottom.
  useLayoutEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (followBottomRef.current) viewport.scrollTop = viewport.scrollHeight;
    });
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    return () => observer.disconnect();
  }, [thread?.id, loadedScope]);

  // Thread display helpers
  const toNumber = useMemo(() => thread?.contactPhone || '', [thread]);
  const titleText = useMemo(() => {
    return thread?.displayName || thread?.contactName || toNumber || 'Message';
  }, [thread, toNumber]);

  const callBannerText = useMemo(() => {
    if (voiceError) return voiceError;

    switch (callStatus) {
      case 'initializing':
        return 'Preparing browser calling…';
      case 'connecting':
        return `Connecting to ${toNumber}…`;
      case 'ringing':
        return `Ringing ${toNumber}…`;
      case 'in-call':
        return `On call with ${toNumber}`;
      case 'ending':
        return 'Ending call…';
      case 'ended':
        return 'Call ended';
      case 'incoming':
        return 'Incoming browser call…';
      case 'error':
        return voiceError || 'Call error';
      default:
        return '';
    }
  }, [callStatus, toNumber, voiceError]);

const showCallBanner = Boolean(
  voiceInitializing ||
    voiceCalling ||
    currentCall ||
    voiceError ||
    ['connecting', 'ringing', 'in-call', 'ending', 'ended', 'incoming', 'error'].includes(callStatus)
);

  const isPremium = Boolean(currentUser?.plan && currentUser.plan !== 'FREE');

  // ✅ SMS → Chat link signal:
  // If this exists, we treat the contact as a Chatforia account (or at least linked to a Chat room)
  const linkedChatRoomId = useMemo(() => {
    const id = Number(thread?.chatRoomId);
    return Number.isFinite(id) ? id : null;
  }, [thread?.chatRoomId]);

  function loadThread() {
    return loaderRef.current?.refresh() ?? Promise.resolve();
  }

  // Pull setting from user profile if present; otherwise use IndexedDB pref
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

  useEffect(() => {
    setThread(null); setLoadedScope(''); setLoadError('');
    setDraft(''); setEditingId(null); setEditingText('');
    setSearchOpen(false); setGalleryOpen(false);
    if (!accountKey || !threadId) return;
    const loader = createSmsThreadLoader({
      fetchThread: async () => (await axiosClient.get(`/sms/threads/${threadId}`)).data,
      onThread: data => { setThread(data); setLoadedScope(scopeKey); setLoadError(''); },
      onError: () => setLoadError('Could not refresh this conversation. Try again.'),
      cache: data => addSmsMessages(String(threadId), data?.messages || []),
      onRefresh: () => window.dispatchEvent(new Event('sidebar:reload-rooms')),
    });
    loaderRef.current = loader;
    void loader.refresh();
    return () => { loader.dispose(); if (loaderRef.current === loader) loaderRef.current = null; };
  }, [threadId, accountKey]);

  useEffect(() => subscribeSmsThread({ socket, threadId,
    refresh: () => loaderRef.current?.refresh(),
  }), [socket, threadId, accountKey]);

  // Normalize SMS messages so Smart Replies can work consistently
  const normalizedMessages = useMemo(() => {
    return (thread?.messages || []).map((m) => ({
      id: m.id,
      content: m.body,
      createdAt: m.createdAt || m.sentAt || m.created_at,
      sender: { id: m.direction === 'out' ? currentUserId : 'sms-peer' },
    }));
  }, [thread?.messages, currentUserId]);

  const { suggestions, clear } = useSmartReplies({
    messages: normalizedMessages,
    currentUserId,
    enabled: smartEnabled && aiComposerEnabled,
    locale: navigator.language || 'en-US',
  });

  const sendSms = async (text) => {
    const body = (text || '').trim();
    if (!toNumber || !body) return;

    try {
      await axiosClient.post('/sms/send', { to: toNumber, body });
      clear();
      await loadThread();
    } catch (e) {
      console.error('SMS send failed', e);
      setDraft(body);
    }
  };

  const deleteMessage = async (messageId) => {
    const ok = window.confirm('Delete this message for you?');
    if (!ok) return;

    // optimistic remove
    setThread((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        messages: (prev.messages || []).filter((m) => m.id !== messageId),
      };
    });

    try {
      await axiosClient.delete(`/sms/messages/${messageId}`);
      await loadThread();
    } catch (e) {
      console.error('SMS delete failed', e);
      await loadThread();
    }
  };

  // ✅ Block SMS number (LOCAL BLOCK — FREE)
  const blockNumber = useCallback(async () => {
    const target = (toNumber || '').trim();
    if (!target) return;

    const ok = window.confirm(
      `Block ${titleText || target}? You won't receive messages from them.`
    );
    if (!ok) return;

    try {
      const { data } = await axiosClient.post(
        '/sms/blocked-numbers',
        { phone: target }
      );
      if (!data?.success) {
        throw new Error('Blocking was not confirmed by the server.');
      }

      window.alert(`Blocked ${titleText || target}.`);
      navigate('/sms');
    } catch (e) {
      console.error('SMS Block failed', e);
      window.alert(
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        'Could not block this number. Please try again.'
      );
    }
  }, [toNumber, titleText, navigate]);

  // ✅ Invite to Chatforia (share sheet / clipboard fallback)
  const inviteToChatforia = useCallback(async () => {
    const origin = window.location.origin;
    const link = `${origin}/download`; // change if you have a better deep link
    const text = `Join me on Chatforia: ${link}`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Chatforia',
          text,
          url: link,
        });
        return;
      }
    } catch {
      // fall through to clipboard
    }

    try {
      await navigator.clipboard.writeText(text);
      window.alert('Invite link copied to clipboard.');
    } catch {
      window.prompt('Copy this invite link:', text);
    }
  }, []);

  // ✅ Header actions: CALL + VIDEO
  const startSmsCall = useCallback(async () => {
    const target = (toNumber || '').trim();

    if (
      !target ||
      voiceInitializing ||
      voiceCalling ||
      currentCall ||
      ['connecting', 'ringing', 'in-call', 'ending'].includes(callStatus)
    ) {
      return;
    }

    try {
      await startBrowserCall(target);
    } catch (e) {
      const message =
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e?.message ||
        'Could not start the browser call.';

      window.alert(message);
    }
  }, [
    toNumber,
    voiceInitializing,
    voiceCalling,
    currentCall,
    callStatus,
    startBrowserCall,
  ]);

  const startSmsVideo = useCallback(() => {
    if (linkedChatRoomId) {
      // Video is an in-app feature, so route to a chat/video experience
      navigate(`/chat/${linkedChatRoomId}`);
      return;
    }
    // Not linked => convert limitation into growth loop
    inviteToChatforia();
  }, [inviteToChatforia, linkedChatRoomId, navigate]);

  // ✅ Edit handlers
  const startEdit = (m) => {
    setEditingId(m.id);
    setEditingText(String(m.body || ''));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText('');
  };

  const saveEdit = async (m) => {
    const body = String(editingText || '').trim();
    if (!body) return;

    // optimistic update
    setThread((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        messages: (prev.messages || []).map((x) =>
          x.id === m.id ? { ...x, body } : x
        ),
      };
    });

    try {
      // ✅ requires backend PATCH /sms/messages/:id
      await axiosClient.patch(`/sms/messages/${m.id}`, { body });
      cancelEdit();
      await loadThread();
    } catch (e) {
      console.error('SMS edit failed', e);
      await loadThread();
    }
  };

  // ✅ Search: jump to message in viewport
  const jumpToSmsMessage = useCallback((messageId) => {
    const el = document.querySelector(`[data-sms-msg-id="${messageId}"]`);
    if (el?.scrollIntoView) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('sms-jump-highlight');
      setTimeout(() => el.classList.remove('sms-jump-highlight'), 900);
    }
  }, []);

  // ✅ Media items for gallery
  const smsMediaItems = useMemo(() => {
    if (!threadId) return [];
    return getSmsMediaItems(String(threadId));
  }, [threadId, thread?.messages?.length]); // refresh when messages change

  if (!thread || loadedScope !== scopeKey) {
    return loadError ? <Text role="alert">{loadError} <Button onClick={loadThread}>Retry</Button></Text> : null;
  }
  
  return (
    <Box
      style={{
        flex: '1 1 0',
        minHeight: 0,
        minWidth: 0,
        width: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {loadError && <Text role="alert" c="red" size="sm">{loadError} <Button size="xs" onClick={loadThread}>Retry</Button></Text>}
      <ThreadShell
            header={
              <>
                {showCallBanner && (
                  <Box
                    mx="xs"
                    mt="xs"
                    mb="xs"
                    p="xs"
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      background: 'var(--card)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      flexShrink: 0,
                    }}
                  >
                    <Text size="sm" c={voiceError ? 'red' : undefined}>
                      {callBannerText}
                    </Text>

                    {(currentCall ||
                      voiceCalling ||
                      callStatus === 'ringing' ||
                      callStatus === 'in-call') && (
                      <Button color="red" size="xs" onClick={hangup}>
                        End
                      </Button>
                    )}
                  </Box>
                )}

                <Box p="md" w="100%">
                  <Group mb="sm" justify="space-between" align="center" wrap="nowrap">
                    <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
                      <Title
                        order={4}
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {titleText}
                      </Title>
                      <Text size="xs" c="dimmed" data-transport="sms">
                        SMS
                      </Text>
                    </Stack>

                    <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
                      <Tooltip label="Call" withArrow withinPortal>
                        <ActionIcon
                          variant="subtle"
                          aria-label="Call"
                          onClick={startSmsCall}
                          disabled={
                            !toNumber ||
                            voiceInitializing ||
                            voiceCalling ||
                            !!currentCall ||
                            ['connecting', 'ringing', 'in-call', 'ending'].includes(callStatus)
                          }
                        >
                          <IconPhoneCall size={18} />
                        </ActionIcon>
                      </Tooltip>

                      <Tooltip
                        label={
                          linkedChatRoomId
                            ? 'Video'
                            : 'Invite them to Chatforia to enable video'
                        }
                        withArrow
                        withinPortal
                      >
                        <span style={{ display: 'inline-flex' }}>
                          <ActionIcon
                            variant="subtle"
                            aria-label="Video"
                            onClick={startSmsVideo}
                          >
                            <IconVideo size={18} />
                          </ActionIcon>
                        </span>
                      </Tooltip>

                      <Tooltip label="Search" withArrow>
                        <ActionIcon
                          variant="subtle"
                          aria-label="Search"
                          onClick={() => setSearchOpen(true)}
                        >
                          <IconSearch size={18} />
                        </ActionIcon>
                      </Tooltip>

                      <Tooltip label="Media" withArrow>
                        <ActionIcon
                          variant="subtle"
                          aria-label="Media"
                          onClick={() => setGalleryOpen(true)}
                        >
                          <IconPhoto size={18} />
                        </ActionIcon>
                      </Tooltip>

                      <ThreadActionsMenu
                        isPremium={isPremium}
                        showPremiumSection
                        showThreadSection
                        onAiPower={() => {
                          if (!isPremium) return navigate('/upgrade');
                          console.log('SMS AI Power (todo)');
                        }}
                        onSchedule={() => {
                          if (!isPremium) return navigate('/upgrade');
                          console.log('SMS Schedule (todo)');
                        }}
                        onSearch={() => setSearchOpen(true)}
                        onMedia={() => setGalleryOpen(true)}
                        canInvite
                        inviteLabel="Invite to Chatforia"
                        onInvitePeople={inviteToChatforia}
                        onBlock={blockNumber}
                        blockLabel={`Block ${titleText || 'number'}`}
                      />
                    </Group>
                  </Group>
                </Box>
              </>
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
                    style={{
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      userSelect: 'none',
                      opacity: aiComposerEnabled ? 1 : 0.65,
                      cursor: aiComposerEnabled ? 'pointer' : 'not-allowed',
                    }}
                    title={
                      aiComposerEnabled
                        ? 'Enable Smart Replies'
                        : 'Available with Plus or Premium.'
                    }
                  >
                    <input
                      type="checkbox"
                      checked={aiComposerEnabled && smartEnabled}
                      disabled={!aiComposerEnabled}
                      onChange={(e) => {
                        if (!aiComposerEnabled) return;

                        const v = e.target.checked;
                        setSmartEnabled(v);
                        setPref(PREF_SMART_REPLIES, v);
                      }}
                      aria-label={
                        aiComposerEnabled
                          ? 'Enable Smart Replies'
                          : 'Smart Replies — Upgrade'
                      }
                    />

                    <span>Smart Replies</span>

                  </label>

                  {!aiComposerEnabled && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        navigate('/upgrade');
                      }}
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        lineHeight: 1,
                        padding: '3px 6px',
                        border: '1px solid var(--accent)',
                        borderRadius: 999,
                        background: 'color-mix(in oklab, var(--accent) 8%, transparent)',
                        color: 'var(--accent)',
                        cursor: 'pointer',
                      }}
                      aria-label="Upgrade to use Smart Replies"
                    >
                      Upgrade
                    </button>
                  )}

                  {aiComposerEnabled && (
                    <SmartReplyBar
                      suggestions={suggestions}
                      onPick={(t) => sendSms(t)}
                      compact
                    />
                  )}
                </Group>
              }
              onSend={async (payload) => {
                const text = (draft || '').trim();

                // attachments from mic/upload
                if (payload?.attachments?.length) {
                  const fileMeta = payload.attachments[0];

                  await sendCarrierMmsAttachment({
                    axiosClient,
                    toNumber,
                    text,
                    fileMeta,
                  });

                  clear();
                  setDraft('');
                  await loadThread();
                  return;
                }

                if (!text) return;
                setDraft('');
                await sendSms(text);
              }}
            />
          </Box>
        }
      >
        <Box
          ref={scrollViewportRef}
          className="sms-thread-viewport"
          onScroll={event => {
            const viewport = event.currentTarget;
            followBottomRef.current =
              viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 32;
          }}
          w="100%"
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            minWidth: 0,
            width: '100%',
            overflowY: 'auto',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
            <Stack className="sms-thread-messages" gap="xs" p="xs">
              {(thread.messages || []).length ? (
                (thread.messages || []).map((m, index, arr) => {
                  const isOut = isSmsOutgoing(m);

                  const prev = arr[index - 1];
                  const next = arr[index + 1];

                  const sameAsPrev = prev ? isSmsOutgoing(prev) === isOut : false;
                  const sameAsNext = next ? isSmsOutgoing(next) === isOut : false;

                  const ts = dayjs(m.createdAt || m.sentAt || m.created_at).format(
                    'MMM D, YYYY • h:mm A'
                  );

                  const isEditing = editingId === m.id;
                  const media = Array.isArray(m.mediaUrls) ? m.mediaUrls : [];

                  const hasText = Boolean(String(m.body || '').trim());
                  const hasMedia = media.length > 0;

                  // Match app-to-app behavior: only the last bubble in a streak gets the tail.
                  const shouldShowTail = !sameAsNext && hasText && !hasMedia;

                  const tailBg = isOut
                    ? 'var(--bubble-outgoing, #f7a600)'
                    : 'var(--bubble-incoming-bg, #f3f4f6)';

                  const bubbleStyle = {
                    maxWidth: 360,
                    background: isOut
                      ? 'var(--bubble-outgoing, #f7a600)'
                      : 'var(--bubble-incoming-bg, #f3f4f6)',
                    color: isOut
                      ? 'var(--bubble-outgoing-text, #111)'
                      : 'var(--bubble-incoming-fg, var(--bubble-incoming-text, #111))',
                    textShadow: isOut ? 'var(--bubble-outgoing-shadow, none)' : undefined,

                    // To match MessageBubble.jsx more closely.
                    border: 'none',
                    boxShadow: 'none',
                  };

                  return (
                    <Group
                      key={m.id}
                      data-sms-msg-id={m.id}
                      className="sms-message-row"
                      justify={isOut ? 'flex-end' : 'flex-start'}
                      align="flex-start"
                      wrap="nowrap"
                      gap={6}
                      style={{ width: '100%', minWidth: 0, maxWidth: '100%' }}
                    >
                      {/* ✅ SENT: dots on LEFT */}
                      {isOut && (
                        <Menu
                          position="bottom-start"
                          withinPortal
                          shadow="md"
                          radius="md"
                        >
                          <Menu.Target>
                            <ActionIcon
                              className="sms-message-menu"
                              aria-label="Message actions"
                              variant="subtle"
                              size="sm"
                              style={{ marginTop: 2 }}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                              }}
                            >
                              <IconDotsVertical size={18} />
                            </ActionIcon>
                          </Menu.Target>

                          <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
                            <Menu.Item
                              leftSection={<IconPencil size={16} />}
                              onClick={() => startEdit(m)}
                            >
                              Edit
                            </Menu.Item>

                            <Menu.Item
                              color="red"
                              leftSection={<IconTrash size={16} />}
                              onClick={() => deleteMessage(m.id)}
                            >
                              Delete
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      )}

                      {/* Bubble */}
                      <Box
                        style={{
                          position: 'relative',
                          display: 'inline-block',
                          maxWidth: 360,
                          minWidth: 0,
                          flexShrink: 1,
                        }}
                      >
                        <Tooltip label={ts} withinPortal>
                          <Paper
                            px="md"
                            py="xs"
                            radius="lg"
                            withBorder={false}
                            style={{
                              ...bubbleStyle,
                              position: 'relative',
                              zIndex: 2,
                              borderRadius: 18,
                              borderTopRightRadius: isOut && sameAsPrev ? 13 : 18,
                              borderTopLeftRadius: !isOut && sameAsPrev ? 13 : 18,
                              borderBottomRightRadius: isOut && shouldShowTail ? 6 : isOut && sameAsNext ? 13 : 18,
                              borderBottomLeftRadius: !isOut && shouldShowTail ? 6 : !isOut && sameAsNext ? 13 : 18,
                            }}
                            className="sms-bubble"
                            data-media-only={!hasText && !isEditing ? "true" : undefined}
                          >
                            {!isEditing ? (
                              <>
                                <Text
                                  c="inherit"
                                  style={{
                                    whiteSpace: 'pre-wrap',
                                    overflowWrap: 'anywhere',
                                  }}
                                >
                                  {m.body}
                                </Text>

                                {media.length > 0 && (
                                  <Group gap="xs" mt={8} wrap="wrap">
                                    {media.map((item, idx) => (
                                      <SmsMessageMedia key={`${accountKey}:${m.id}-${idx}`}
                                        messageId={m.id} mediaIndex={idx} item={item}
                                        accountKey={accountKey} onOpenImage={() => setGalleryOpen(true)} />
                                    ))}
                                  </Group>
                                )}
                              </>
                            ) : (
                              <Box style={{ minWidth: 240 }}>
                                <Textarea
                                  value={editingText}
                                  onChange={(e) => setEditingText(e.target.value)}
                                  autosize
                                  minRows={2}
                                  styles={{
                                    input: {
                                      background: 'transparent',
                                      color: 'inherit',
                                      borderColor: 'rgba(255,255,255,0.25)',
                                    },
                                  }}
                                />

                                <Group justify="flex-end" gap="xs" mt={6}>
                                  <Button variant="subtle" size="xs" onClick={cancelEdit}>
                                    Cancel
                                  </Button>

                                  <Button size="xs" onClick={() => saveEdit(m)}>
                                    Save
                                  </Button>
                                </Group>
                              </Box>
                            )}
                          </Paper>
                        </Tooltip>

                        {shouldShowTail && (
                          <>
                            <Box
                              aria-hidden="true"
                              style={{
                                position: 'absolute',
                                bottom: 0,
                                right: isOut ? -8 : 'auto',
                                left: isOut ? 'auto' : -8,
                                width: 20,
                                height: 18,
                                background: tailBg,
                                borderBottomLeftRadius: isOut ? 18 : 0,
                                borderBottomRightRadius: isOut ? 0 : 18,
                                zIndex: 1,
                                pointerEvents: 'none',
                              }}
                            />

                            <Box
                              aria-hidden="true"
                              style={{
                                position: 'absolute',
                                bottom: -1,
                                right: isOut ? -21 : 'auto',
                                left: isOut ? 'auto' : -21,
                                width: 21,
                                height: 21,
                                background: 'var(--chat-bg, var(--bg, #fff7ef))',
                                borderBottomLeftRadius: isOut ? 18 : 0,
                                borderBottomRightRadius: isOut ? 0 : 18,
                                zIndex: 1,
                                pointerEvents: 'none',
                              }}
                            />
                          </>
                        )}
                      </Box>

                      {/* ✅ RECEIVED: dots on RIGHT */}
                      {!isOut && (
                        <Menu
                          position="bottom-end"
                          withinPortal
                          shadow="md"
                          radius="md"
                        >
                          <Menu.Target>
                            <ActionIcon
                              className="sms-message-menu"
                              aria-label="Message actions"
                              variant="subtle"
                              size="sm"
                              style={{ marginTop: 2 }}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                              }}
                            >
                              <IconDotsVertical size={18} />
                            </ActionIcon>
                          </Menu.Target>

                          <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
                            <Menu.Item
                              color="red"
                              leftSection={<IconTrash size={16} />}
                              onClick={() => deleteMessage(m.id)}
                            >
                              Delete
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      )}
                    </Group>
                  );
                })
              ) : (
                <Text c="dimmed" ta="center" py="md">
                  No messages yet.
                </Text>
              )}

              <div ref={bottomRef} style={{ height: 12, flexShrink: 0 }} />
            </Stack>
        </Box>

        {/* ✅ Local Search Drawer (IndexedDB) */}
        <SmsSearchDrawer
          opened={searchOpen}
          onClose={() => setSearchOpen(false)}
          threadId={String(threadId)}
          onJumpToMessage={(id) => jumpToSmsMessage(id)}
          searchFn={searchSmsMessages}
        />

        {/* ✅ MMS / Media Gallery */}
        <SmsMediaGalleryModal
          opened={galleryOpen}
          onClose={() => setGalleryOpen(false)}
          title={titleText}
          items={smsMediaItems}
        />
      </ThreadShell>
    </Box>
  );
}