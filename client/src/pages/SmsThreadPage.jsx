import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  Box,
  Group,
  Paper,
  Text,
  ActionIcon,
  Menu,
  Tooltip,
} from '@mantine/core';
import { IconDotsVertical, IconTrash } from '@tabler/icons-react';

import axiosClient from '@/api/axiosClient';
import BottomComposer from '@/components/BottomComposer.jsx';
import { isOutgoingMessage } from '@/utils/messageDirection';

export default function SmsThreadPage() {
  const { threadId } = useParams();
  const [thread, setThread] = useState(null);
  const [text, setText] = useState('');
  const loadingRef = useRef(false);

  const toNumber = useMemo(() => thread?.contactPhone || '', [thread]);

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
    setThread(null);
    setText('');
    loadThread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const sendTextOnly = async () => {
    const body = text.trim();
    if (!toNumber || !body) return;

    setText('');

    try {
      await axiosClient.post('/sms/send', { to: toNumber, body });
      await loadThread();
    } catch (e) {
      setText(body);
      console.error('SMS send failed', e);
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

  if (!thread) return null;

  const currentUserIdForSmsDirection = 'sms:self'; // dummy id for utility fallback

  if (typeof window !== 'undefined') {
  window.__SMS_RENDERER__ = 'SmsThreadPage.jsx ✅';
  console.log(window.__SMS_RENDERER__);
}


  return (
    <Box
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      {/* Hover-only styling for per-message dots */}
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
        style={{
          background: 'red',
          color: 'white',
          padding: 8,
          fontWeight: 800,
          borderRadius: 8,
          margin: 8,
        }}
      >
        RENDERER: SmsThreadPage.jsx ✅
      </Box>


      {/* Messages */}
      <Box
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 16,
          paddingBottom: 140, // space for fixed composer
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          gap: 10,
        }}
      >
        {(thread.messages || []).map((m) => {
          const isMine =
            isOutgoingMessage(m, currentUserIdForSmsDirection) ||
            ['out', 'outbound', 'sent', 'outbound-api', 'outgoing'].includes(
              String(m.direction || '').toLowerCase()
            );

          const ts = dayjs(m.createdAt || m.sentAt || m.created_at).format(
            'MMM D, YYYY • h:mm A'
          );

          const bubbleStyle = {
            maxWidth: 420,
            background: isMine
              ? 'var(--bubble-outgoing, #ffb000)'
              : 'var(--bubble-incoming-bg, rgba(255,255,255,0.6))',
            color: isMine
              ? 'var(--bubble-outgoing-text, #111)'
              : 'var(--fg, #111)',
            borderRadius: 18,
          };

          const menu = (
            <Menu
              position={isMine ? 'bottom-start' : 'bottom-end'}
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
                  style={{ alignSelf: 'flex-start', marginTop: 2 }}
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
          );

          return (
            <Group
              key={m.id}
              className="sms-message-row"
              justify={isMine ? 'flex-end' : 'flex-start'}
              align="flex-start"
              wrap="nowrap"
              gap={6}
              style={{ width: '100%' }}
            >
              {/* ✅ SENT: dots on LEFT */}
              {isMine ? menu : null}

              {/* Bubble */}
              <Tooltip label={ts} withinPortal>
                <Paper
                  px="md"
                  py="xs"
                  radius="lg"
                  withBorder={false}
                  style={bubbleStyle}
                >
                  <Text style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {m.body || m.content || ''}
                  </Text>
                </Paper>
              </Tooltip>

              {/* ✅ RECEIVED: dots on RIGHT */}
              {!isMine ? menu : null}
            </Group>
          );
        })}
      </Box>

      {/* Fixed Bottom Composer */}
      <BottomComposer
        value={text}
        onChange={setText}
        placeholder="Type a message…"
        showGif={false}
        showEmoji={false}
        showMic={false}
        showUpload={false}
        onSend={(payload = {}) => {
          if (payload.files?.length || payload.attachments?.length) return;
          return sendTextOnly();
        }}
      />
    </Box>
  );
}
