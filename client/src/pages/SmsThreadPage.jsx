import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Group, Paper, Text } from '@mantine/core';

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

  if (!thread) return null;

  const currentUserIdForSmsDirection = 'sms:self'; // dummy id for utility fallback if needed

  return (
    <Box
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      {/* Messages (flex:1, scrolls, and anchors to bottom when short) */}
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
          // Normalize direction better than `=== 'out'`
          const isMine =
            isOutgoingMessage(m, currentUserIdForSmsDirection) ||
            ['out', 'outbound', 'sent', 'outbound-api', 'outgoing'].includes(
              String(m.direction || '').toLowerCase()
            );

          const bubbleStyle = {
            maxWidth: 420,
            background: isMine
              ? 'var(--mantine-color-blue-filled)'
              : 'var(--mantine-color-gray-2)',
            color: isMine ? 'white' : 'var(--mantine-color-text)',
          };

          return (
            <Group
              key={m.id}
              justify={isMine ? 'flex-end' : 'flex-start'}
              align="flex-end"
              wrap="nowrap"
            >
              <Paper
                radius="lg"
                px="md"
                py="xs"
                withBorder={false}
                style={bubbleStyle}
              >
                <Text style={{ whiteSpace: 'pre-wrap' }}>
                  {m.body || m.content || ''}
                </Text>
              </Paper>
            </Group>
          );
        })}
      </Box>

      {/* Fixed Bottom Composer (SMS-only features) */}
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
