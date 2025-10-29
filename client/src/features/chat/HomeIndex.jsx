import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Card,
  Stack,
  Text,
  Button,
  TextInput,
  Group,
  ActionIcon,
  Tooltip
} from '@mantine/core';
import { Smile, Image as ImageIcon, Send } from 'lucide-react';
import StickerPicker from '@/components/StickerPicker.jsx';

// ---- shared tab values (inline constants) ----
const TAB_EMOJI = 'emoji';
const TAB_GIFS = 'gifs';

const NAV_W = 300;   // match AppRoutes
const ASIDE_W = 280; // match AppRoutes
const GUTTER = 32;   // visual breathing room across center (set to 0 for true edge-to-edge)

export default function HomeIndex() {
  const { t } = useTranslation();
  const [msg, setMsg] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState(TAB_EMOJI);
  const fileRef = useRef(null);

  const handleSendMessage = () => {
    if (!msg.trim()) return;
    window.dispatchEvent(new CustomEvent('open-new-chat-modal'));
  };

  const openImageVideo = () => fileRef.current?.click();

  return (
    <Box role="region" aria-label="Home" w="100%" style={{ position: 'relative' }}>
      {/* Centered empty-state card */}
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

            <TextInput
              placeholder={t('home.inputPlaceholder', 'Type a message…')}
              aria-label={t('home.inputAriaLabel', 'Message composer')}
              value={msg}
              onChange={(e) => setMsg(e.currentTarget.value)}
              style={{ flex: 1, minWidth: 0 }}
              variant="filled"
              radius="md"
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
              accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.zip"
              style={{ display: 'none' }}
              onChange={() => {}}
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
