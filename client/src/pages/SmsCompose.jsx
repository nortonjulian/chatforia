import { useSearchParams, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import axiosClient from '@/api/axiosClient';
import { Box, Group, Text, Button, TextInput, Textarea, FileButton } from '@mantine/core';
import { IconMoodSmile, IconGif, IconPaperclip, IconSend, IconX } from '@tabler/icons-react';
import StickerPicker from '@/components/StickerPicker'; // ⬅️ add this import

function toE164Dev(raw) {
  const s = String(raw || '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('+')) return s;
  if (s.length === 10) return `+1${s}`;
  return `+${s}`;
}

export default function SmsCompose() {
  const [sp] = useSearchParams();
  const presetTo = sp.get('to') || '';
  const [to, setTo] = useState(presetTo);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const navigate = useNavigate();
  const inputRef = useRef(null);

  useEffect(() => { if (presetTo) setTo(presetTo); }, [presetTo]);

  const canSend = useMemo(() => Boolean(to && text.trim()), [to, text]);

  async function handleSend() {
    if (!canSend) return;
    setSending(true);
    try {
      const { data } = await axiosClient.post('/sms/send', {
        to: toE164Dev(to),
        body: text.trim(),
      });
      if (data?.threadId) navigate(`/sms/threads/${data.threadId}`);
      else setText('');
    } catch (e) {
      console.error('SMS send failed', e);
    } finally {
      setSending(false);
    }
  }

  // When the picker returns an item:
  function handlePick(p) {
    // Emoji -> insert native character into the text box
    if (p.kind === 'EMOJI' && p.native) {
      setText((t) => `${t}${p.native}`);
      setPickerOpen(false);
      inputRef.current?.focus();
      return;
    }
    // GIF/Sticker -> DEV: append URL into message (simple MMS-ish placeholder)
    if ((p.kind === 'GIF' || p.kind === 'STICKER') && p.url) {
      setText((t) => (t ? `${t} ${p.url}` : p.url));
      setPickerOpen(false);
      inputRef.current?.focus();
    }
  }

  return (
    <Box
      // 🔑 Make the page itself full-height and a column so the composer sits at the bottom
      style={{
        minHeight: 'calc(100vh - 60px)', // header is 60px in your AppShell
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <Group justify="space-between" px="md" py="xs">
        <Text fw={600}>New text</Text>
        <Button variant="light" color="gray" leftSection={<IconX size={16} />} onClick={() => navigate(-1)}>
          Cancel
        </Button>
      </Group>

      {/* “To” field */}
      <Box px="md" pb="xs">
        <TextInput
          placeholder="To: phone number"
          value={to}
          onChange={(e) => setTo(e.currentTarget.value)}
          leftSection={<Text size="sm">To</Text>}
          onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current?.focus(); }}
        />
      </Box>

      {/* This spacer pushes the composer to the bottom */}
      <div style={{ flex: 1 }} />

      {/* Bottom composer (always at bottom now) */}
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
          <Button variant="subtle" aria-label="Emoji" title="Emoji" onClick={() => setPickerOpen(true)}>
            <IconMoodSmile size={18} />
          </Button>
          <Button variant="subtle" aria-label="GIF" title="GIF" onClick={() => setPickerOpen(true)}>
            <IconGif size={18} />
          </Button>
          <FileButton onChange={() => { /* TODO: attach upload */ }}>
            {(props) => (
              <Button variant="subtle" {...props} aria-label="Attach" title="Attach">
                <IconPaperclip size={18} />
              </Button>
            )}
          </FileButton>

          {/* ⬇️ CHANGED: TextInput → Textarea (multi-line) */}
          <Textarea
            data-composer="textarea"
            ref={inputRef}
            className="message-input"
            variant="filled"
            placeholder="Type a message…"
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            autosize
            minRows={2}
            maxRows={6}
            // Enter sends; Shift+Enter inserts newline
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            styles={{
              root: { flex: 1, minWidth: 0 },
              input: {
                height: 'auto !important',
                minHeight: 72,
                maxHeight: 160,
                overflowY: 'auto',
                overflowX: 'hidden',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
                lineHeight: 1.45,
                paddingTop: 8,
                paddingBottom: 8,
                resize: 'none',
              },
            }}
          />

          <Button onClick={handleSend} disabled={!canSend} loading={sending} rightSection={<IconSend size={16} />}>
            Send
          </Button>
        </Group>
      </Box>

      {/* Emoji/GIF picker modal */}
      <StickerPicker opened={pickerOpen} onClose={() => setPickerOpen(false)} onPick={handlePick} />
    </Box>
  );
}
