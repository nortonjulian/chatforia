import { useState, useMemo } from 'react';
import { Group, Card, ActionIcon, Select, Textarea, Button, Badge, Tooltip, Menu, Divider } from '@mantine/core';
import { IconSend, IconPaperclip, IconClock } from '@tabler/icons-react';
import axiosClient from '../api/axiosClient';
import StickerPicker from './StickerPicker.jsx';
import FileUploader from './FileUploader.jsx';
import { toast } from '../utils/toast';
import { encryptForRoom } from '@/utils/encryptionClient';
import MicButton from '@/components/MicButton.jsx';

const TTL_OPTIONS = [
  { value: '0', label: 'Off' },
  { value: '10', label: '10s' },
  { value: '60', label: '1m' },
  { value: String(10 * 60), label: '10m' },
  { value: String(60 * 60), label: '1h' },
  { value: String(24 * 3600), label: '1d' },
];

export default function MessageInput({
  chatroomId,
  currentUser,
  onMessageSent,
  roomParticipants = [],
}) {
  const [content, setContent] = useState('');
  const [ttl, setTtl] = useState(String(currentUser?.autoDeleteSeconds || 0));

  // Files uploaded to R2 (or mic recordings returned as fileMeta)
  const [uploaded, setUploaded] = useState([]);
  // Stickers / GIFs picked (no upload)
  const [inlinePicks, setInlinePicks] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [sending, setSending] = useState(false);

  const nothingToSend = useMemo(
    () => !content.trim() && uploaded.length === 0 && inlinePicks.length === 0,
    [content, uploaded.length, inlinePicks.length]
  );

  function kindFromMime(m) {
    if (!m) return 'FILE';
    if (m.startsWith('image/')) return 'IMAGE';
    if (m.startsWith('video/')) return 'VIDEO';
    if (m.startsWith('audio/')) return 'AUDIO';
    return 'FILE';
  }

  // Clamp TTL client-side and inform user if plan-limited
  const handleTtlChange = (next) => {
    const nextVal = Number(next || 0);
    const isPremium = (currentUser?.plan || '').toUpperCase() === 'PREMIUM';
    const maxFree = 24 * 3600;
    const maxPremium = 30 * 24 * 3600;

    if (!isPremium && nextVal > maxFree) {
      setTtl(String(maxFree));
      toast.info('Free plan limit: auto-delete up to 1 day. Clamped to 1d.');
      return;
    }
    if (isPremium && nextVal > maxPremium) {
      setTtl(String(maxPremium));
      toast.info('Max auto-delete for Premium is 30 days. Clamped to 30d.');
      return;
    }
    setTtl(String(nextVal));
  };

  const handleSend = async (e) => {
    e?.preventDefault?.();
    if (sending) return;

    const text = content.trim();

    if (!text && uploaded.length === 0 && inlinePicks.length === 0) {
      toast.info('Type a message or attach a file to send.');
      return;
    }

    setSending(true);

    const attachmentsInline = [
      ...uploaded.map((f) => ({
        kind: kindFromMime(f.contentType),
        url: f.url,
        mimeType: f.contentType,
        width: f.width || null,
        height: f.height || null,
        durationSec: f.durationSec || null,
        caption: f.caption || null,
      })),
      ...inlinePicks,
    ];

    const payload = {
      chatRoomId: String(chatroomId),
      expireSeconds: Number(ttl) || 0,
      attachmentsInline,
    };

    // Strict E2EE: client encrypts and sends ciphertext + per-user sealed keys
    if (text) {
      if (currentUser?.strictE2EE) {
        try {
          // IMPORTANT: encryptForRoom must return { ciphertext, encryptedKeys }
          const { ciphertext, encryptedKeys } = await encryptForRoom(roomParticipants, text, currentUser?.id);
          payload.contentCiphertext = ciphertext;
          payload.encryptedKeys = encryptedKeys;

          // optional: omit plaintext entirely
          // payload.content = '';
        } catch (err) {
          console.error('Encryption failed', err);
          toast.err('Encryption failed. Message not sent.');
          setSending(false);
          return;
        }
      } else {
        payload.content = text;
      }
    }

    try {
      const { data: saved } = await axiosClient.post('/messages', payload, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      onMessageSent?.(saved);
      toast.ok('Message delivered.');
      setContent('');
      setUploaded([]);
      setInlinePicks([]);
    } catch (err) {
      // Construct a helpful error message
      const status = err?.response?.status;
      const code = err?.response?.data?.code;
      const reason = err?.response?.data?.reason;

      if (status === 402) {
        toast.err(
          reason === 'PREMIUM_REQUIRED'
            ? 'This action requires Premium.'
            : 'Upgrade required for this action.'
        );
      } else if (status === 413) {
        toast.err('Attachment too large. Try a smaller file.');
      } else if (status === 415) {
        toast.err('Unsupported file type.');
      } else if (status === 429) {
        toast.err('You’re sending messages too quickly. Please slow down.');
      } else if (code === 'VALIDATION_ERROR') {
        toast.err('Validation error. Please check your message and try again.');
      } else {
        toast.err('Failed to send. You can retry the failed bubble.');
      }

      // Optimistic failed bubble so user can retry/resend
      onMessageSent?.({
        id: `temp-${Date.now()}`,
        content: text,
        createdAt: new Date().toISOString(),
        mine: true,
        failed: true,
        expireSeconds: Number(ttl) || 0,
        attachmentsInline,
      });

      console.error('Error sending message', err);
    } finally {
      setSending(false);
    }
  };

  return (
  <form onSubmit={handleSend} style={{ width: '100%' }}>
    <Card
      withBorder
      radius="md"
      p="xs"
      style={{
        width: '100%',
        background: 'var(--mantine-color-body)',
      }}
    >
      <Group gap="xs" wrap="nowrap" align="center" style={{ width: '100%' }}>
        {/* GIF / Stickers */}
        <Button
          variant="filled"
          radius="xl"
          size="compact-md"
          onClick={() => setPickerOpen(true)}
          disabled={sending}
          type="button"
          aria-label="Stickers & GIFs"
          title="Stickers & GIFs"
        >
          GIF
        </Button>

        {/* Emoji (same picker for now) */}
        <ActionIcon
          variant="default"
          size="lg"
          radius="md"
          disabled={sending}
          aria-label="Emoji"
          title="Emoji"
          onClick={() => setPickerOpen(true)}
          type="button"
        >
          {String.fromCodePoint(0x1f600)}
        </ActionIcon>

        {/* 🎙️ Voice */}
        <MicButton
          chatRoomId={chatroomId}
          onUploaded={(fileMeta) => {
            setUploaded((prev) => [...prev, fileMeta]);
            toast.ok('Voice note added.');
          }}
        />

        {/* Upload */}
        <FileUploader
          button={
            <ActionIcon
              variant="default"
              size="lg"
              radius="md"
              disabled={sending}
              aria-label="Upload"
              title="Photo / video / file"
              type="button"
            >
              <IconPaperclip size={18} />
            </ActionIcon>
          }
          onUploaded={(fileMeta) => {
            setUploaded((prev) => [...prev, fileMeta]);
            toast.ok('Attachment added.');
          }}
          onError={(message) => {
            toast.err(message || 'Failed to upload file.');
          }}
        />

        {/* Text */}
        <Textarea
          placeholder="Type a message…"
          aria-label="Message composer"
          value={content}
          onChange={(e) => setContent(e.currentTarget.value)}
          variant="filled"
          radius="md"
          autosize
          minRows={2}
          maxRows={6}
          disabled={sending}
          styles={{
            root: { flex: 1, minWidth: 0 },
            input: {
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
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter newline
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />

        {/* TTL moved into a small menu (keeps layout clean like BottomComposer) */}
        <Menu withinPortal position="top-end" shadow="md">
          <Menu.Target>
            <Tooltip label="Auto-delete timer" openDelay={400}>
              <ActionIcon
                variant="default"
                size="lg"
                radius="md"
                disabled={sending}
                aria-label="Auto-delete timer"
                type="button"
              >
                <IconClock size={18} />
              </ActionIcon>
            </Tooltip>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>Auto-delete</Menu.Label>
            <Divider my="xs" />
            <Select
              value={ttl}
              onChange={handleTtlChange}
              data={TTL_OPTIONS}
              aria-label="Message timer"
              disabled={sending}
              w={180}
            />
          </Menu.Dropdown>
        </Menu>

        {/* Send */}
        <Tooltip
          label={nothingToSend ? 'Type a message to send' : 'Send'}
          openDelay={400}
        >
          <ActionIcon
            type="submit"
            size="lg"
            radius="xl"
            variant="filled"
            disabled={sending || nothingToSend}
            aria-label="Send"
            title="Send (Enter)"
          >
            <IconSend size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {/* Uploaded files with optional captions (keep your existing UI) */}
      {uploaded.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {uploaded.map((f, i) => (
            <Group
              key={`${f.key || f.url}-${i}`}
              gap="xs"
              align="center"
              wrap="nowrap"
              style={{ marginBottom: 6 }}
            >
              <Badge variant="light">
                {f.contentType?.split('/')[0]?.toUpperCase() || 'FILE'}
              </Badge>

              <a
                href={f.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  maxWidth: 260,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={f.url}
              >
                {(() => {
                  try {
                    return new URL(f.url).pathname.split('/').pop();
                  } catch {
                    return f.url;
                  }
                })()}
              </a>

              <Textarea
                placeholder="Caption (optional)"
                autosize
                minRows={1}
                maxRows={2}
                w={320}
                value={f.caption || ''}
                onChange={(e) =>
                  setUploaded((prev) =>
                    prev.map((x, idx) =>
                      idx === i ? { ...x, caption: e.currentTarget.value } : x
                    )
                  )
                }
                aria-label={`Attachment ${i + 1} caption`}
              />

              <Button
                size="xs"
                variant="subtle"
                color="red"
                onClick={() => {
                  setUploaded((prev) => prev.filter((_, idx) => idx !== i));
                  toast.info('Attachment removed.');
                }}
                aria-label={`Remove attachment ${i + 1}`}
                type="button"
              >
                Remove
              </Button>
            </Group>
          ))}
        </div>
      )}

      {/* Inline picks preview (keep your existing UI) */}
      {inlinePicks.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {inlinePicks.map((a, i) => (
            <span
              key={`${a.url}-${i}`}
              style={{
                display: 'inline-block',
                fontSize: 12,
                background: '#f3f3f3',
                borderRadius: 8,
                padding: '4px 8px',
                marginRight: 8,
              }}
              title={a.url}
            >
              {a.kind === 'GIF' ? 'GIF' : 'Sticker'}
            </span>
          ))}
          <Button
            size="xs"
            variant="subtle"
            color="red"
            onClick={() => {
              setInlinePicks([]);
              toast.info('Cleared stickers & GIFs.');
            }}
            style={{ marginLeft: 4 }}
            aria-label="Clear stickers and GIFs"
            type="button"
          >
            Clear
          </Button>
        </div>
      )}
    </Card>

    <StickerPicker
      opened={pickerOpen}
      onClose={() => setPickerOpen(false)}
      onPick={(att) => {
        setInlinePicks((prev) => [...prev, att]);
        setPickerOpen(false);
        toast.ok(att.kind === 'GIF' ? 'GIF added.' : 'Sticker added.');
      }}
    />
  </form>
 );
}
