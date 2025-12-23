import { useSearchParams, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import axiosClient from '@/api/axiosClient';
import {
  Box,
  Group,
  Text,
  Button,
  TextInput,
  Textarea,
  FileButton,
} from '@mantine/core';
import {
  IconMoodSmile,
  IconGif,
  IconPaperclip,
  IconSend,
  IconX,
} from '@tabler/icons-react';
import StickerPicker from '@/components/StickerPicker';
import { NumberPickerModal } from '@/components/profile/PhoneNumberManager';

/* ---------------- helpers ---------------- */

function toE164Dev(raw) {
  const s = String(raw || '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('+')) return s;
  if (s.length === 10) return `+1${s}`;
  return `+${s}`;
}

/* ---------------- component ---------------- */

export default function SmsCompose() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();

  const presetTo = sp.get('to') || '';
  const presetName = sp.get('name') || '';

  const [to, setTo] = useState(presetTo);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [numberPickerOpen, setNumberPickerOpen] = useState(false);

  const inputRef = useRef(null);

  /* -----------------------------------------------------------
   * 🔥 KEY FIX: redirect to existing thread if it already exists
   * ----------------------------------------------------------- */
  useEffect(() => {
    (async () => {
      if (!presetTo) return;

      const normalized = toE164Dev(presetTo);
      if (!normalized) return;

      try {
        const res = await axiosClient.get('/sms/threads/lookup', {
          params: { to: normalized },
        });

        const threadId = res?.data?.threadId;
        if (threadId) {
          navigate(`/sms/${threadId}`, { replace: true });
        }
      } catch {
        // lookup failure → stay on compose
      }
    })();
  }, [presetTo, navigate]);

  useEffect(() => {
    if (presetTo) setTo(presetTo);
  }, [presetTo]);

  const canSend = useMemo(
    () => Boolean(to && text.trim()),
    [to, text]
  );

  async function handleSend() {
    if (!canSend) return;

    setSending(true);
    try {
      const res = await axiosClient.post('/sms/send', {
        to: toE164Dev(to),
        body: text.trim(),
      });

      const data = res.data;

      // If backend returns threadId → navigate
      if (data?.threadId) {
        navigate(`/sms/${data.threadId}`);
        return;
      }

      // Fallback: lookup thread after send
      const lookup = await axiosClient.get('/sms/threads/lookup', {
        params: { to: toE164Dev(to) },
      });

      if (lookup?.data?.threadId) {
        navigate(`/sms/${lookup.data.threadId}`);
      } else {
        setText('');
      }
    } catch (e) {
      const code = e?.response?.data?.code;
      if (code === 'NO_NUMBER') {
        setNumberPickerOpen(true);
      } else {
        console.error('SMS send failed', e);
      }
    } finally {
      setSending(false);
    }
  }

  function handlePick(p) {
    if (p.kind === 'EMOJI' && p.native) {
      setText((t) => `${t}${p.native}`);
      setPickerOpen(false);
      inputRef.current?.focus();
      return;
    }
    if ((p.kind === 'GIF' || p.kind === 'STICKER') && p.url) {
      setText((t) => (t ? `${t} ${p.url}` : p.url));
      setPickerOpen(false);
      inputRef.current?.focus();
    }
  }

  return (
    <Box
      style={{
        minHeight: 'calc(100vh - 60px)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <Group justify="space-between" px="md" py="xs">
        <Text fw={600}>New text</Text>
        <Button
          variant="light"
          color="gray"
          leftSection={<IconX size={16} />}
          onClick={() => navigate(-1)}
        >
          Cancel
        </Button>
      </Group>

      {/* To field */}
      <Box px="md" pb="xs">
        <TextInput
          placeholder="To: phone number"
          value={to}
          onChange={(e) => setTo(e.currentTarget.value)}
          leftSection={<Text size="sm">To</Text>}
          description={presetName ? `Contact: ${presetName}` : undefined}
          onKeyDown={(e) => {
            if (e.key === 'Enter') inputRef.current?.focus();
          }}
        />
      </Box>

      <div style={{ flex: 1 }} />

      {/* Composer */}
      <Box
        px="md"
        py="sm"
        style={{
          position: 'sticky',
          bottom: 0,
          background: 'var(--mantine-color-body)',
          borderTop: '1px solid var(--mantine-color-default-border)',
        }}
      >
        <Group gap="xs" align="center" wrap="nowrap">
          <Button variant="subtle" onClick={() => setPickerOpen(true)}>
            <IconMoodSmile size={18} />
          </Button>
          <Button variant="subtle" onClick={() => setPickerOpen(true)}>
            <IconGif size={18} />
          </Button>
          <FileButton onChange={() => {}}>
            {(props) => (
              <Button variant="subtle" {...props}>
                <IconPaperclip size={18} />
              </Button>
            )}
          </FileButton>

          <Textarea
            ref={inputRef}
            variant="filled"
            placeholder="Type a message…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autosize
            minRows={3}
            maxRows={6}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            styles={{ root: { flex: 1 } }}
          />

          <Button
            onClick={handleSend}
            disabled={!canSend}
            loading={sending}
            rightSection={<IconSend size={16} />}
          >
            Send
          </Button>
        </Group>
      </Box>

      <StickerPicker
        opened={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={handlePick}
      />

      <NumberPickerModal
        opened={numberPickerOpen}
        onClose={() => setNumberPickerOpen(false)}
      />
    </Box>
  );
}
