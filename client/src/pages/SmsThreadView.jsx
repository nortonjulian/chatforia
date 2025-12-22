// client/src/pages/SmsThreadView.jsx
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
} from '@mantine/core';
import {
  IconDotsVertical,
  IconSearch,
  IconPhoto,
  IconTrash,
} from '@tabler/icons-react';

import axiosClient from '@/api/axiosClient';
import ThreadShell from '@/threads/ThreadShell';
import ThreadComposer from '@/threads/ThreadComposer.jsx';

import SmartReplyBar from '@/components/SmartReplyBar.jsx';
import { useSmartReplies } from '@/hooks/useSmartReplies.js';
import { getPref, setPref, PREF_SMART_REPLIES } from '@/utils/prefsStore';

function MessageMenu({ onDelete, side = 'right' }) {
  return (
    <Menu
      position={side === 'left' ? 'bottom-start' : 'bottom-end'}
      withinPortal
      shadow="md"
      radius="md"
    >
      <Menu.Target>
        <ActionIcon
          className="sms-message-menu"
          variant="subtle"
          size="sm"
          aria-label="Message actions"
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
          onClick={onDelete}
        >
          Delete
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

export default function SmsThreadView({ currentUserId, currentUser }) {
  const { threadId } = useParams();
  const navigate = useNavigate();

  const [thread, setThread] = useState(null);
  const [draft, setDraft] = useState('');

  const [smartEnabled, setSmartEnabled] = useState(
    () => currentUser?.enableSmartReplies ?? false
  );

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

  const toNumber = useMemo(() => thread?.contactPhone || '', [thread]);
  const titleText = useMemo(() => {
    return thread?.displayName || thread?.contactName || toNumber || 'Message';
  }, [thread, toNumber]);

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
    loadThread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

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

  if (!thread) return null;

  return (
    <ThreadShell
      header={
        <Box p="md" w="100%">
          <Group mb="sm" justify="space-between" align="center">
            <Title order={4}>{titleText}</Title>

            <Group gap="xs">
              <Tooltip label="Search" withArrow>
                <ActionIcon variant="subtle" aria-label="Search (coming soon)" onClick={() => {}}>
                  <IconSearch size={18} />
                </ActionIcon>
              </Tooltip>

              <Tooltip label="Media" withArrow>
                <ActionIcon variant="subtle" aria-label="Media (coming soon)" onClick={() => {}}>
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
                  <Menu.Label>Thread</Menu.Label>
                  <Menu.Item onClick={() => navigate('/upgrade')}>Upgrade</Menu.Item>
                  <Divider my="xs" />
                  <Menu.Item color="red">Block (later)</Menu.Item>
                </Menu.Dropdown>
              </Menu>
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

                <SmartReplyBar suggestions={suggestions} onPick={(t) => sendSms(t)} compact />
              </Group>
            }
            onSend={async () => {
              const text = (draft || '').trim();
              if (!text) return;
              setDraft('');
              await sendSms(text);
            }}
          />
        </Box>
      }
    >
      {/* Hover-only menus (matches your thread hover behavior) */}
      <style>{`
        .sms-message-row .sms-message-menu {
          opacity: 0;
          transition: opacity 120ms ease;
        }
        .sms-message-row:hover .sms-message-menu {
          opacity: 1;
        }
      `}</style>

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
          type="auto"
          styles={{
            viewport: { display: 'flex', flexDirection: 'column' },
            content: { display: 'flex', flexDirection: 'column', flex: '1 1 auto' },
          }}
        >
          <Stack gap="xs" p="xs" style={{ marginTop: 'auto' }}>
            {(thread.messages || []).length ? (
              (thread.messages || []).map((m) => {
                const isOut = m.direction === 'out';
                const ts = dayjs(m.createdAt || m.sentAt || m.created_at).format(
                  'MMM D, YYYY • h:mm A'
                );

                // ✅ Use your theme vars, with safe fallbacks that preserve your orange look
                const bubbleStyle = isOut
                  ? {
                      maxWidth: 360,
                      background:
                        'var(--bubble-outgoing, linear-gradient(135deg, #ffb000, #ff7a00))',
                      color: 'var(--bubble-outgoing-text, #111)',
                      borderRadius: 18,
                    }
                  : {
                      maxWidth: 360,
                      background: 'var(--bubble-incoming-bg, rgba(255,255,255,0.6))',
                      color: 'var(--bubble-incoming-text, var(--fg, #111))',
                      borderRadius: 18,
                      border: '1px solid rgba(0,0,0,0.06)',
                    };

                return (
                  <Group
                    key={m.id}
                    className="sms-message-row"
                    justify={isOut ? 'flex-end' : 'flex-start'}
                    align="center"
                    wrap="nowrap"
                    gap={6}
                    style={{ width: '100%' }}
                  >
                    {/* Incoming: dots on left */}
                    {!isOut && (
                      <MessageMenu side="left" onDelete={() => deleteMessage(m.id)} />
                    )}

                    {/* Bubble */}
                    <Tooltip label={ts} withinPortal>
                      <Paper px="md" py="xs" radius="lg" withBorder={false} style={bubbleStyle}>
                        <Text style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                          {m.body}
                        </Text>
                      </Paper>
                    </Tooltip>

                    {/* Outgoing: dots on right */}
                    {isOut && (
                      <MessageMenu side="right" onDelete={() => deleteMessage(m.id)} />
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
