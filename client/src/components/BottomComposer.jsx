import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Group, Button, ActionIcon, Textarea, Tooltip} from '@mantine/core';
import { Smile, Image as ImageIcon, Send } from 'lucide-react';
import StickerPicker from '@/components/StickerPicker.jsx';
import MicButton from '@/components/MicButton.jsx';
import FileUploader from '@/components/FileUploader.jsx';

const TAB_EMOJI = 'emoji';
const TAB_GIFS = 'gifs';

export default function BottomComposer({
  value,
  onChange,
  onSend,
  placeholder,
  topSlot,

  // NEW: layout mode
  // - embedded: parent layout controls placement (recommended for SmsLayout / chat grid)
  // - fixed: old behavior (position: fixed) with left/right offsets
  mode = 'embedded', // 'embedded' | 'fixed'

  // layout controls (used only when mode === 'fixed')
  left = 300 + 16, // nav width + gutter-ish (tweak if needed)
  right = 280 + 16, // aside width + gutter-ish (tweak if needed)
  bottom = 12,

  disabled = false,
  showGif = true,
  showEmoji = true,
  showMic = true,
  showUpload = true,
  onUploadFiles, // optional; if omitted, we'll pass files to onSend via 2nd arg
}) {
  const { t } = useTranslation();
  const fileRef = useRef(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState(TAB_EMOJI);
  const uploadTriggerRef = useRef(null);
  const openUploader = () => uploadTriggerRef.current?.click?.();

  const [pendingAttachment, setPendingAttachment] = useState(null);
  const [isPreviewHovered, setIsPreviewHovered] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');

  const handleSend = async (payloadOrEvent) => {
  if (disabled) return;

  // Ignore click/submit events
  const isEvent =
    payloadOrEvent &&
    (typeof payloadOrEvent.preventDefault === 'function' ||
      typeof payloadOrEvent.stopPropagation === 'function');

  if (isEvent) {
    payloadOrEvent.preventDefault?.();
  }

  const attachments = pendingAttachment ? [pendingAttachment] : [];

  const rawText = value || '';
  const trimmedText = rawText.trim();

  const hasAttachments = attachments.length > 0;
  const hasText = !!trimmedText;

  // ✅ Prevent placeholder / empty text when sending media-only
  const outgoing = !isEvent && payloadOrEvent
  ? payloadOrEvent
  : {
      text: hasAttachments && !hasText ? '' : rawText,
      attachments,
    };

  if (!hasText && !hasAttachments) return;

  console.log('BottomComposer handleSend payload:', outgoing);
  await onSend?.(outgoing);

  setPendingAttachment(null);
  setUploadProgress(0);
  setUploadStatus('');
  onChange?.('');
};

  const wrapperStyle =
    mode === 'fixed'
      ? {
          position: 'fixed',
          bottom: `calc(${bottom}px + env(safe-area-inset-bottom))`,
          left,
          right,
          zIndex: 10,
          pointerEvents: 'none',
        }
      : {
          position: 'relative',
          width: '100%',
          pointerEvents: 'none',
        };

  return (
    <>
      <div style={wrapperStyle}>
        <Card
            withBorder
            radius="md"
            p="xs"
            style={{
              pointerEvents: 'auto',
              width: '100%',
              margin: 0,
              background: 'var(--mantine-color-body)',
            }}
          >
            {topSlot ? <div style={{ marginBottom: 8 }}>{topSlot}</div> : null}

            {uploading && (
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>
                {uploadStatus} {uploadProgress > 0 ? `${uploadProgress}%` : ''}
              </div>
            )}

            {pendingAttachment && (() => {
                const mime = String(pendingAttachment.mimeType || pendingAttachment.contentType || '').toLowerCase();
                const isVideo = mime.startsWith('video/');
                const isAudio = mime.startsWith('audio/');
                const isImage = mime.startsWith('image/');

                const previewSrc =
                  pendingAttachment.previewUrl ||
                  pendingAttachment.thumbUrl ||
                  pendingAttachment.thumbnailUrl ||
                  pendingAttachment.url;

                return (
                  <div
                    style={{
                      marginBottom: 8,
                      position: 'relative',
                      display: 'block',
                      width: 96,
                      overflow: 'visible',
                    }}
                    onMouseEnter={() => setIsPreviewHovered(true)}
                    onMouseLeave={() => setIsPreviewHovered(false)}
                  >
                    {isVideo ? (
                      previewSrc ? (
                        <video
                          src={previewSrc}
                          poster={pendingAttachment.thumbUrl || pendingAttachment.thumbnailUrl || undefined}
                          style={{
                            width: 96,
                            height: 96,
                            objectFit: 'cover',
                            borderRadius: 12,
                            display: 'block',
                            background: 'rgba(0,0,0,0.08)',
                          }}
                          muted
                          playsInline
                          preload="metadata"
                        />
                      ) : (
                        <div
                          style={{
                            width: 96,
                            height: 96,
                            borderRadius: 12,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(0,0,0,0.08)',
                            fontSize: 12,
                          }}
                        >
                          Video
                        </div>
                      )
                    ) : isAudio ? (
                      <div
                        style={{
                          width: 96,
                          height: 96,
                          borderRadius: 12,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'rgba(0,0,0,0.08)',
                          fontSize: 12,
                        }}
                      >
                        Audio
                      </div>
                    ) : isImage ? (
                      <img
                        src={previewSrc}
                        alt="Selected attachment"
                        style={{
                          width: 96,
                          height: 96,
                          objectFit: 'cover',
                          borderRadius: 12,
                          display: 'block',
                          background: 'rgba(0,0,0,0.08)',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 96,
                          height: 96,
                          borderRadius: 12,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'rgba(0,0,0,0.08)',
                          fontSize: 12,
                        }}
                      >
                        File
                      </div>
                    )}

                    {isPreviewHovered && (
                      <button
                        type="button"
                        aria-label="Remove selected attachment"
                        onClick={() => setPendingAttachment(null)}
                        style={{
                          position: 'absolute',
                          top: 6,
                          right: 6,
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          border: 'none',
                          cursor: 'pointer',
                          background: 'rgba(0, 0, 0, 0.6)',
                          color: 'white',
                          fontSize: 14,
                          lineHeight: '22px',
                          textAlign: 'center',
                          zIndex: 10,
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })()}

            <Group gap="xs" wrap="nowrap" align="center" style={{ width: '100%' }}>
              {showGif && (
                <Button
                  variant="filled"
                  radius="xl"
                  size="compact-md"
                  styles={{
                    label: { color: 'var(--cta-on)', textShadow: 'var(--cta-on-shadow)' },
                  }}
                  aria-label={t('composer.gifPicker', 'Open GIF picker')}
                  onClick={() => {
                    setPickerTab(TAB_GIFS);
                    setPickerOpen(true);
                  }}
                >
                  GIF
                </Button>
              )}

              {showEmoji && (
                <ActionIcon
                  variant="default"
                  size="lg"
                  radius="md"
                  aria-label={t('composer.emoji', 'Emoji')}
                  onClick={() => {
                    setPickerTab(TAB_EMOJI);
                    setPickerOpen(true);
                  }}
                  title={t('composer.emoji', 'Emoji')}
                >
                  <Smile size={18} />
                </ActionIcon>
              )}

              {showMic && (
                <MicButton
                  onUploaded={(fileMeta) => {
                    setPendingAttachment(fileMeta);
                  }}
                  variant="default"
                  size="lg"
                  radius="md"
                  tooltip={t('composer.voiceNote', 'Record a voice note')}
                />
              )}

              {showUpload && (
                <FileUploader
                  button={
                    <ActionIcon
                      variant="default"
                      size="lg"
                      radius="md"
                      aria-label={t('composer.upload', 'Upload')}
                      title={t('composer.upload', 'Photo / video')}
                      disabled={disabled}
                    >
                      <ImageIcon size={18} />
                    </ActionIcon>
                  }
                  onStart={(file) => {
                    setUploading(true);
                    setUploadProgress(0);

                    const mime = String(file?.type || '').toLowerCase();
                    if (mime.startsWith('video/')) {
                      setUploadStatus('Uploading video...');
                    } else if (mime.startsWith('image/')) {
                      setUploadStatus('Uploading image...');
                    } else if (mime.startsWith('audio/')) {
                      setUploadStatus('Uploading audio...');
                    } else {
                      setUploadStatus('Uploading file...');
                    }
                  }}
                  onProgress={(pct) => {
                    setUploadProgress(pct);
                  }}
                  onUploaded={(fileMeta) => {
                    setUploading(false);
                    setUploadProgress(100);
                    setUploadStatus('');
                    setPendingAttachment(fileMeta);
                  }}
                  onError={() => {
                    setUploading(false);
                    setUploadProgress(0);
                    setUploadStatus('');
                  }}
                />
              )}

              <Textarea
                placeholder={placeholder ?? t('composer.placeholder', 'Type a message…')}
                aria-label={t('composer.aria', 'Message composer')}
                value={value}
                onChange={(e) => onChange?.(e.currentTarget.value)}
                variant="filled"
                radius="md"
                autosize
                minRows={2}
                maxRows={6}
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
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                disabled={disabled}
              />

              <Tooltip
                label={
                  value?.trim()
                    ? t('composer.send', 'Send')
                    : t('composer.sendDisabled', 'Type a message to send')
                }
                openDelay={400}
              >
                <ActionIcon
                  size="lg"
                  radius="xl"
                  variant="filled"
                  aria-label={t('composer.send', 'Send')}
                  onClick={handleSend}
                  disabled={disabled || (!value?.trim() && !pendingAttachment)}
                >
                  <Send size={16} />
                </ActionIcon>
              </Tooltip>

              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.zip"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  e.target.value = '';

                  if (!files.length) return;
                  if (onUploadFiles) return onUploadFiles(files);

                  handleSend({ files });
                }}
              />
            </Group>
          </Card>
      </div>
        
      <StickerPicker
        opened={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(pick) => {
          if (!pick) {
            setPickerOpen(false);
            return;
          }

          if (pick.native) {
            const next = `${value || ''}${pick.native}`;
            onChange?.(next);
            setPickerOpen(false);
            return;
          }

          setPendingAttachment({
            kind: pick.kind === 'GIF' ? 'GIF' : 'IMAGE',
            url: pick.url,
            mimeType: pick.mimeType || 'image/gif',
            width: pick.width || null,
            height: pick.height || null,
            durationSec: pick.durationSec || null,
            previewUrl: pick.previewUrl || null,
          });

          setPickerOpen(false);
        }}
        initialTab={pickerTab}
      />
    </>
  );
}