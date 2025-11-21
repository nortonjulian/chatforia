import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Card,
  Stack,
  Text,
  Button,
  Textarea,
  Group,
  ActionIcon,
  Tooltip
} from '@mantine/core';
import { Smile, Image as ImageIcon, Send } from 'lucide-react';
import StickerPicker from '@/components/StickerPicker.jsx';
import MicButton from '@/components/MicButton.jsx';

const TAB_EMOJI = 'emoji';
const TAB_GIFS = 'gifs';

const NAV_W = 300;
const ASIDE_W = 280;
const GUTTER = 32;

// Feature flag so you can roll out safely
const FEATURE_HOME_MIC =
  (import.meta.env.VITE_FEATURE_HOME_MIC ?? 'true').toString() !== 'false';

export default function HomeIndex() {
  const { t } = useTranslation();
  const [msg, setMsg] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState(TAB_EMOJI);
  const fileRef = useRef(null);

  const openNewChatDraft = (draft) => {
    window.dispatchEvent(new CustomEvent('open-new-chat-modal', { detail: { draft } }));
  };

  const handleSendMessage = () => {
    const text = msg.trim();
    // Open the modal either way; include a draft only if non-empty
    openNewChatDraft(text ? { text } : {});
    if (text) setMsg(''); // only clear if you actually had text
  };

  const openImageVideo = () => fileRef.current?.click();

  return (
    <Box role="region" aria-label="Home" w="100%" style={{ position: 'relative' }}>
      {/* Center card */}
      <Box
        style={{
          minHeight: 'calc(100vh - 140px)',
          display: 'grid',
          placeItems: 'center',
          paddingBottom: 120,
        }}
      >
        <Card withBorder radius="lg" p="lg" maw={380} w="100%" style={{ textAlign: 'center', margin: '0 auto' }}>
          <Stack gap="xs" align="center">
            <Text fw={700} size="lg">{t('home.header', 'Your messages')}</Text>
            <Text c="dimmed" size="sm" mb="xs">
              {t('home.subheader', 'Send a message to start a chat.')}
            </Text>
            <Button size="md" onClick={handleSendMessage}>
              {t('home.cta', 'Send message')}
            </Button>
          </Stack>
        </Card>
      </Box>

      {/* Fixed bottom composer */}
      <div
        style={{
          position: 'fixed',
          bottom: `calc(12px + env(safe-area-inset-bottom))`,
          left: NAV_W + GUTTER / 2,
          right: ASIDE_W + GUTTER / 2,
          zIndex: 10,
          pointerEvents: 'none',
        }}
      >
        <Card
          withBorder
          radius="md"
          p="xs"
          style={{
            boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
            pointerEvents: 'auto',
            width: '100%',
            margin: 0,
            background: 'var(--mantine-color-body)'
          }}
        >
          <Group gap="xs" wrap="nowrap" align="center" style={{ width: '100%' }}>
            <Button
              variant="filled"
              radius="xl"
              size="compact-md"
              aria-label={t('home.gifPicker', 'Open GIF picker')}
              onClick={() => { setPickerTab(TAB_GIFS); setPickerOpen(true); }}
              className="composer-btn gif-button gif-button--filled"
            >
              GIF
            </Button>

            <ActionIcon
              variant="default"
              size="lg"
              radius="md"
              aria-label={t('home.emoji', 'Emoji')}
              onClick={() => { setPickerTab(TAB_EMOJI); setPickerOpen(true); }}
              title={t('home.emoji', 'Emoji')}
              className="composer-btn icon-button"
            >
              <Smile size={18} />
            </ActionIcon>

            {/* 🎙️ Voice-first entry (feature-flagged) */}
            {FEATURE_HOME_MIC && (
              <MicButton
                // Home has no room; just prepare a draft with one audio attachment
                onUploaded={(fileMeta) => {
                  // Open StartChatModal prefilled with any typed text + the audio meta
                  const text = msg.trim();
                  openNewChatDraft({ text, attachments: [fileMeta] });
                  // keep text unless you prefer to clear it
                }}
                // Optional: make the button visually consistent with the other icons
                variant="default"
                size="lg"
                radius="md"
                className="composer-btn icon-button"
                tooltip={t('home.voiceNote', 'Record a voice note')}
              />
            )}

            <ActionIcon
              variant="default"
              size="lg"
              radius="md"
              aria-label={t('home.upload', 'Upload photo or video')}
              onClick={openImageVideo}
              title={t('home.upload', 'Photo / video')}
              className="composer-btn icon-button"
            >
              <ImageIcon size={18} />
            </ActionIcon>

            {/* Textarea that wraps & autosizes */}
            <Textarea
              data-composer="home-textarea"
              placeholder={t('home.inputPlaceholder', 'Type a message…')}
              aria-label={t('home.inputAriaLabel', 'Message composer')}
              value={msg}
              onChange={(e) => setMsg(e.currentTarget.value)}
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
                  handleSendMessage();
                }
              }}
            />

            <Tooltip
              label={
                msg.trim()
                  ? t('home.send', 'Send')
                  : t('home.sendDisabled', 'Type a message to send')
              }
              openDelay={400}
            >
              <ActionIcon
                size="lg"
                radius="xl"
                variant="filled"
                aria-label={t('home.send', 'Send')}
                onClick={handleSendMessage}
                className="composer-btn send-button"
                data-empty={msg.trim() === '' ? 'true' : 'false'}
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
                openNewChatDraft({ text: msg.trim(), files });
                // optional: clear local state
                e.target.value = '';
                setMsg((m) => m); // keep text unless you want to clear it too
              }}
            />
          </Group>
        </Card>
      </div>

      <StickerPicker
        opened={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={() => setPickerOpen(false)}
        initialTab={pickerTab}
      />
    </Box>
  );
}
