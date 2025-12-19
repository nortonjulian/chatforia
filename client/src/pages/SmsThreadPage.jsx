import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Box } from '@mantine/core';

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

  const sendTextOnly = async () => {
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
  };

  if (!thread) return null;

  return (
    <Box w="100%" style={{ position: 'relative' }}>
      {/* Messages area (pad bottom so it doesn't hide behind fixed composer) */}
      <Box
        className="sms-messages"
        style={{
          minHeight: 'calc(100vh - 160px)',
          paddingBottom: 140,
        }}
      >
        {(thread.messages || []).map((m) => (
          <div key={m.id} className={m.direction === 'out' ? 'msg out' : 'msg in'}>
            {m.body}
          </div>
        ))}
      </Box>

      <BottomComposer
        value={text}
        onChange={setText}
        placeholder="Type a message…"
        // SMS for now: disable features you don’t support yet
        showGif={false}
        showEmoji={false}
        showMic={false}
        showUpload={false}
        onSend={(payload = {}) => {
          // If something tries to pass attachments, ignore (SMS-only)
          if (payload.files?.length || payload.attachments?.length) return;
          return sendTextOnly();
        }}
      />
    </Box>
  );
}
