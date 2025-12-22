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
  Divider,
  Textarea,
  Button,
} from '@mantine/core';
import {
  IconSearch,
  IconPhoto,
  IconDotsVertical,
  IconTrash,
  IconPencil,
} from '@tabler/icons-react';

import axiosClient from '@/api/axiosClient';
import ThreadShell from '@/threads/ThreadShell';
import ThreadComposer from '@/threads/ThreadComposer.jsx';
import ThreadActionsMenu from '@/threads/ThreadActionsMenu.jsx';

import SmartReplyBar from '@/components/SmartReplyBar.jsx';
import { useSmartReplies } from '@/hooks/useSmartReplies.js';
import { getPref, setPref, PREF_SMART_REPLIES } from '@/utils/prefsStore';

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

  async function loadThread() {
    if (!threadId || loadingRef.current) return;
    loadingRef.current = true;

    try {
      const res = await axiosClient.get(`/sms/threads/${threadId}`);
      setThread(res.data);
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
      await axiosClient.delete(`/sms/messages/${messageId}`);
      await loadThread();
    } catch (e) {
      console.error('SMS delete failed', e);
      await loadThread();
    }
  };

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

  if (!thread) return null;

  return (
    <ThreadShell
      header={
        <Box p="md" w="100%">
          <Group mb="sm" justify="space-between" align="center">
            <Title order={4}>{titleText}</Title>

            <Group gap="xs">
              <Tooltip label="Search" withArrow>
                <ActionIcon
                  variant="subtle"
                  aria-label="Search (coming soon)"
                  onClick={() => {}}
                >
                  <IconSearch size={18} />
                </ActionIcon>
              </Tooltip>

              <Tooltip label="Media" withArrow>
                <ActionIcon
                  variant="subtle"
                  aria-label="Media (coming soon)"
                  onClick={() => {}}
                >
                  <IconPhoto size={18} />
                </ActionIcon>
              </Tooltip>

              {/* ✅ Same menu structure as ChatView (AI Power + Schedule), plus Block */}
              <ThreadActionsMenu
                isPremium={isPremium}
                showPremiumSection
                showThreadSection

                // ✅ Force-show the group rows for UI parity
                isOwnerOrAdmin={true}

                onAiPower={() => {
                    if (!isPremium) return navigate('/upgrade');
                    console.log('SMS AI Power (todo)');
                }}
                onSchedule={() => {
                    if (!isPremium) return navigate('/upgrade');
                    console.log('SMS Schedule (todo)');
                }}

                onAbout={() => console.log('SMS About (todo)')}
                onSearch={() => console.log('SMS Search (todo)')}
                onMedia={() => console.log('SMS Media (todo)')}

                // ✅ These rows now appear (but are placeholders for SMS)
                onInvitePeople={() => console.log('SMS Invite people (todo)')}
                onRoomSettings={() => console.log('SMS Room settings (todo)')}

                onBlock={() => {
                    const ok = window.confirm(`Block ${titleText || toNumber}?`);
                    if (!ok) return;
                    console.log('SMS Block (todo)', { toNumber });
                }}
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

                return (
                  <Group
                    key={m.id}
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
                        {isEditing ? (
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
                        ) : (
                          <Text
                            c="inherit"
                            style={{
                              whiteSpace: 'pre-wrap',
                              overflowWrap: 'anywhere',
                            }}
                          >
                            {m.body}
                          </Text>
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
                          {/* Typically: you cannot edit received messages */}
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
    </ThreadShell>
  );
}
