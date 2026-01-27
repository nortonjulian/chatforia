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
  ScrollArea,
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
import ThreadShell from '@/threads/ThreadShell';
import ThreadComposer from '@/threads/ThreadComposer.jsx';
import ThreadActionsMenu from '@/threads/ThreadActionsMenu.jsx';

import SmartReplyBar from '@/components/SmartReplyBar.jsx';
import { useSmartReplies } from '@/hooks/useSmartReplies.js';
import { getPref, setPref, PREF_SMART_REPLIES } from '@/utils/prefsStore';

// ✅ NEW: local SMS cache + UI
import {
  addSmsMessages,
  searchSmsMessages,
  getSmsMediaItems,
} from '@/utils/smsMessagesStore.js';
import SmsSearchDrawer from '@/components/sms/SmsSearchDrawer.jsx';
import SmsMediaGalleryModal from '@/components/sms/SmsMediaGalleryModal.jsx';

export default function SmsLayout({ currentUserId, currentUser }) {
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

  const loadingRef = useRef(false);
  const bottomRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    });
  }, []);

  useLayoutEffect(() => {
    if (!thread) return;
    scrollToBottom();
  }, [thread?.id, thread?.messages?.length, scrollToBottom]);

  // Thread display helpers
  const toNumber = useMemo(() => thread?.contactPhone || '', [thread]);
  const titleText = useMemo(() => {
    return thread?.displayName || thread?.contactName || toNumber || 'Message';
  }, [thread, toNumber]);

  const isPremium = Boolean(currentUser?.plan && currentUser.plan !== 'FREE');

  // ✅ SMS → Chat link signal:
  // If this exists, we treat the contact as a Chatforia account (or at least linked to a Chat room)
  const linkedChatRoomId = useMemo(() => {
    const id = Number(thread?.chatRoomId);
    return Number.isFinite(id) ? id : null;
  }, [thread?.chatRoomId]);

  async function loadThread() {
    if (!threadId || loadingRef.current) return;
    loadingRef.current = true;

    try {
      const res = await axiosClient.get(`/sms/threads/${threadId}`);
      setThread(res.data);

      // ✅ Cache locally for search + media
      try {
        await addSmsMessages(String(threadId), res.data?.messages || []);
      } catch {
        // ignore local cache errors
      }
    } catch {
      setThread(null);
    } finally {
      loadingRef.current = false;
    }
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
    setThread(null);
    setDraft('');
    setEditingId(null);
    setEditingText('');
    setSearchOpen(false);
    setGalleryOpen(false);
    loadThread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

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
    enabled: smartEnabled,
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
      await axiosClient.delete(`/sms/media/${messageId}`);
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
      // ✅ Backend should implement:
      // POST /sms/blocks  { phone }
      await axiosClient.post('/sms/blocks', { phone: target });

      window.alert(`Blocked ${titleText || target}.`);
      navigate('/sms');
    } catch (e) {
      console.error('SMS Block failed', e);
      window.alert('Block failed (backend not wired yet).');
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
  const startSmsCall = useCallback(() => {
    const target = (toNumber || '').trim();
    if (!target) return;
    // Wire this to your Calls flow. This is a sane default.
    navigate(`/calls?to=${encodeURIComponent(target)}`);
  }, [navigate, toNumber]);

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

  if (!thread) return null;

  return (
    <ThreadShell
      header={
        <Box p="md" w="100%">
          <Group mb="sm" justify="space-between" align="center">
            <Title order={4}>{titleText}</Title>

            <Group gap="xs">
              {/* ✅ NEW: Call */}
              <Tooltip label="Call" withArrow withinPortal>
                <ActionIcon
                  variant="subtle"
                  aria-label="Call"
                  onClick={startSmsCall}
                >
                  <IconPhoneCall size={18} />
                </ActionIcon>
              </Tooltip>

              {/* ✅ NEW: Video (requires Chatforia link) */}
              <Tooltip
                label={
                  linkedChatRoomId
                    ? 'Video'
                    : 'Invite them to Chatforia to enable video'
                }
                withArrow
                withinPortal
              >
                {/* Mantine Tooltips + disabled need a wrapper */}
                <span style={{ display: 'inline-flex' }}>
                  <ActionIcon
                    variant="subtle"
                    aria-label="Video"
                    onClick={startSmsVideo}
                    disabled={!linkedChatRoomId}
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

              {/* ✅ Same menu structure as ChatView (AI Power + Schedule), plus Invite + Block */}
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
                // ✅ SMS-specific “Invite” (NOT room invite)
                canInvite
                inviteLabel="Invite to Chatforia"
                onInvitePeople={inviteToChatforia}
                // ✅ Local block
                onBlock={blockNumber}
                blockLabel={`Block ${titleText || 'number'}`}
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
                  style={{
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    userSelect: 'none',
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
                  onPick={(t) => sendSms(t)}
                  compact
                />
              </Group>
            }
            onSend={async (payload) => {
              const text = (draft || '').trim();

              // attachments from mic/upload
              if (payload?.attachments?.length) {
                const fileMeta = payload.attachments[0];

                const roomId = thread?.chatRoomId;
                if (roomId) {
                  await axiosClient.post('/messages', {
                    chatRoomId: String(roomId),
                    content: text || '',
                    attachmentsInline: [
                      {
                        kind: (fileMeta.contentType || '').startsWith('audio/')
                          ? 'AUDIO'
                          : 'FILE',
                        url: fileMeta.url,
                        mimeType: fileMeta.contentType,
                      },
                    ],
                  });
                  setDraft('');
                  await loadThread();
                  return;
                }

                await axiosClient.post(`/sms/threads/${threadId}/messages`, {
                  body: text || '',
                  attachmentsInline: [
                    {
                      kind: (fileMeta.contentType || '').startsWith('audio/')
                        ? 'AUDIO'
                        : 'FILE',
                      url: fileMeta.url,
                      mimeType: fileMeta.contentType,
                    },
                  ],
                });

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
        w="100%"
        style={{
          height: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <ScrollArea
          style={{ flex: '1 1 auto', minHeight: 0 }}
          viewportProps={{ className: 'sms-thread-viewport' }}
          type="auto"
          styles={{
            viewport: { display: 'flex', flexDirection: 'column' },
            content: {
              display: 'flex',
              flexDirection: 'column',
              flex: '1 1 auto',
            },
          }}
        >
          <Stack gap="xs" p="xs" style={{ marginTop: 'auto' }}>
            {(thread.messages || []).length ? (
              (thread.messages || []).map((m) => {
                const isOut = m.direction === 'out';
                const ts = dayjs(m.createdAt || m.sentAt || m.created_at).format(
                  'MMM D, YYYY • h:mm A'
                );

                const bubbleStyle = {
                  maxWidth: 360,
                  background: isOut
                    ? 'var(--bubble-outgoing)'
                    : 'var(--bubble-incoming-bg, var(--card))',
                  color: isOut
                    ? 'var(--bubble-outgoing-text, #fff)'
                    : 'var(--bubble-incoming-text, var(--fg))',
                  borderRadius: 18,
                  ...(isPremium
                    ? {
                        border: '1px solid var(--bubble-premium-outline)',
                        boxShadow: 'var(--bubble-premium-glow)',
                      }
                    : {}),
                };

                const isEditing = editingId === m.id;

                // ✅ NEW: MMS thumbnails (per-message)
                const media = Array.isArray(m.mediaUrls) ? m.mediaUrls : [];

                return (
                  <Group
                    key={m.id}
                    data-sms-msg-id={m.id}
                    className="sms-message-row"
                    justify={isOut ? 'flex-end' : 'flex-start'}
                    align="flex-start"
                    wrap="nowrap"
                    gap={6}
                    style={{ width: '100%' }}
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
                    <Tooltip label={ts} withinPortal>
                      <Paper
                        px="md"
                        py="xs"
                        radius="lg"
                        withBorder={false}
                        style={bubbleStyle}
                        className="sms-bubble"
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
                                {media.map((_, idx) => {
                                  const base =
                                    import.meta.env.VITE_API_BASE_URL || '';
                                  const src = `${base}/sms/media/${m.id}/${idx}`;

                                  return (
                                    <img
                                      key={`${m.id}-${idx}`}
                                      src={src}
                                      alt="MMS"
                                      style={{
                                        width: 140,
                                        height: 140,
                                        objectFit: 'cover',
                                        borderRadius: 12,
                                        cursor: 'pointer',
                                      }}
                                      onClick={() => {
                                        setGalleryOpen(true);
                                      }}
                                    />
                                  );
                                })}
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
                              <Button
                                variant="subtle"
                                size="xs"
                                onClick={cancelEdit}
                              >
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

            <div ref={bottomRef} />
          </Stack>
        </ScrollArea>
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
  );
}
