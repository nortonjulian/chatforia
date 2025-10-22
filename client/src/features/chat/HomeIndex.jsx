import { useRef, useState } from 'react';
import { Box, Card, Stack, Text, Button, TextInput, Group, ActionIcon } from '@mantine/core';
import { Smile, Image as ImageIcon, Paperclip, Send } from 'lucide-react';
import StickerPicker from '@/components/StickerPicker.jsx';

const NAV_W = 300;   // match AppRoutes
const ASIDE_W = 280; // match AppRoutes
const GUTTER = 32;   // small breathing room across center

export default function HomeIndex() {
  const [msg, setMsg] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState('emoji');
  const fileRef = useRef(null);

  const handleSendMessage = () => {
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
            <Text fw={700} size="lg">Your messages</Text>
            <Text c="dimmed" size="sm" mb="xs">Send a message to start a chat.</Text>
            <Button size="md" onClick={handleSendMessage}>Send message</Button>
          </Stack>
        </Card>
      </Box>

      {/* Fixed bottom composer — spans entire middle between rails */}
      <div
        style={{
          position: 'fixed',
          left: '50%',
          bottom: 12,
          transform: 'translateX(-50%)',
          width: `calc(100vw - ${NAV_W + ASIDE_W + GUTTER}px)`,
          maxWidth: 'calc(100vw - 16px)', // guard for very small widths
          zIndex: 10,
          pointerEvents: 'none',
        }}
      >
        <Card
          withBorder
          radius="lg"
          p="xs"
          style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)', pointerEvents: 'auto' }}
        >
          <Group gap="xs" wrap="nowrap">
            <ActionIcon
              variant="light"
              aria-label="Emoji & GIFs"
              onClick={() => {
                setPickerTab('emoji');
                setPickerOpen(true);
              }}
            >
              <Smile size={18} />
            </ActionIcon>

            <ActionIcon variant="light" aria-label="Upload photo or video" onClick={openImageVideo} title="Upload media">
              <ImageIcon size={18} />
            </ActionIcon>

            <ActionIcon variant="light" aria-label="Attach file" onClick={openImageVideo} title="Attach file">
              <Paperclip size={18} />
            </ActionIcon>

            <TextInput
              placeholder="Type a message…"
              value={msg}
              onChange={(e) => setMsg(e.currentTarget.value)}
              style={{ flex: 1 }}
            />

            <Button rightSection={<Send size={16} />} onClick={handleSendMessage}>
              Send
            </Button>

            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,video/*"
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
