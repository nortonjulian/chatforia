import { useState, useMemo } from 'react';
import { Group, ActionIcon, Select, Textarea, Button, Badge } from '@mantine/core';
import { IconSend, IconPaperclip } from '@tabler/icons-react';
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
    <form onSubmit={handleSend}>
      <Group align="end" gap="xs" wrap="nowrap">
        {/* Text */}
        <Textarea
          className='message-input'
          aria-label="Message input"
          placeholder="Say something…"
          autosize
          minRows={2}
          maxRows={3}
          value={content}
          onChange={(e) => setContent(e.currentTarget.value)}
          disabled={sending}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter makes a new line
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          styles={{
            root: { flex: 1, minWidth: 0 },
            input: {
              fontSize: '1rem',
              lineHeight: 1.45,
              paddingTop: 8,
              paddingBottom: 8,
            },
          }}
        />

        {/* TTL */}
        <Select
          value={ttl}
          onChange={handleTtlChange}
          data={TTL_OPTIONS}
          w={110}
          aria-label="Message timer"
          disabled={sending}
        />

        {/* Emoji / Sticker picker trigger */}
        <Button
          variant="light"
          onClick={() => setPickerOpen(true)}
          disabled={sending}
          type="button"
          aria-label={String.fromCodePoint(0x1f600)}
          title="Stickers & GIFs"
        >
          {String.fromCodePoint(0x1f600)}
        </Button>

        {/* 🎙️ Voice message (records → uploads → adds to attachments) */}
        <MicButton
          chatRoomId={chatroomId}
          onUploaded={(fileMeta) => {
            setUploaded((prev) => [...prev, fileMeta]);
            toast.ok('Voice note added.');
          }}
        />

        {/* FileUploader (R2) */}
        <FileUploader
          button={
            <Button
              variant="light"
              leftSection={<IconPaperclip size={16} />}
              disabled={sending}
              aria-label="Attach files"
              type="button"
              title="Attach files"
            >
              Attach
            </Button>
          }
          onUploaded={(fileMeta) => {
            setUploaded((prev) => [...prev, fileMeta]);
            toast.ok('Attachment added.');
          }}
          onError={(message) => {
            toast.err(message || 'Failed to upload file.');
          }}
        />

        {/* Send */}
        <ActionIcon
          type="submit"
          variant="filled"
          radius="xl"
          size="lg"
          disabled={sending || nothingToSend}
          aria-label="Send message"
          title="Send (Enter)"
        >
          <IconSend size={18} />
        </ActionIcon>
      </Group>

      {/* Uploaded files with optional captions */}
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

      {/* Inline stickers / GIFs preview badges */}
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

      {/* Sticker / GIF picker modal */}
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
