import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Stack, Text } from '@mantine/core';

import axiosClient from '@/api/axiosClient';
import BottomComposer from '@/components/BottomComposer.jsx';

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

  if (!thread) return null;

  return (
    <Box
      w="100%"
      style={{
        // 2-row layout: messages (scroll) + composer (sticky/embedded)
        display: 'grid',
        gridTemplateRows: '1fr auto',
        height: '100dvh',
        minHeight: 0,
      }}
    >
      {/* Messages region */}
      <Box
        className="sms-messages"
        style={{
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '12px 12px 0',
        }}
      >
        {(thread.messages || []).length ? (
          (thread.messages || []).map((m) => (
            <div key={m.id} className={m.direction === 'out' ? 'msg out' : 'msg in'}>
              {m.body}
            </div>
          ))
        ) : (
          <Stack align="center" justify="center" py="xl">
            <Text c="dimmed" size="sm">
              No messages yet.
            </Text>
          </Stack>
        )}
      </Box>

      {/* Composer region (embedded, not fixed) */}
      <Box
        style={{
          borderTop: '1px solid rgba(0,0,0,.06)',
          background: 'var(--mantine-color-body)',
          padding: '8px 12px',
          paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
        }}
      >
        <BottomComposer
          mode="embedded"
          value={text}
          onChange={setText}
          placeholder="Type a message…"
          // If you want SMS to be "text-only" for now, keep these off:
          // showUpload={false}
          // showMic={false}
          // showGif={false}
          onSend={async (payload = {}) => {
            // Optional: block attachments until MMS is supported
            if (payload.files?.length || payload.attachments?.length) return;

            const body = text.trim();
            if (!toNumber || !body) return;

            // optimistic clear
            setText('');

            try {
              await axiosClient.post('/sms/send', { to: toNumber, body });
              await loadThread();
            } catch (e) {
              setText(body);
              console.error('SMS send failed', e);
            }
          }}
        />
      </Box>
    </Box>
  );
}
