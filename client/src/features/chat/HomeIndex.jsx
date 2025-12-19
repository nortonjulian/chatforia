import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Card, Stack, Text, Button } from '@mantine/core';

import BottomComposer from '@/components/BottomComposer.jsx';

export default function HomeIndex() {
  const { t } = useTranslation();
  const [msg, setMsg] = useState('');

  const openNewChatDraft = (draft) => {
    window.dispatchEvent(
      new CustomEvent('open-new-chat-modal', { detail: { draft } })
    );
  };

  return (
    <Box role="region" aria-label="Home" w="100%" style={{ position: 'relative' }}>
      {/* Center card */}
      <Box
        style={{
          minHeight: 'calc(100vh - 140px)',
          display: 'grid',
          placeItems: 'center',
          paddingBottom: 120, // so center card doesn’t clash with fixed composer
        }}
      >
        <Card
          withBorder
          radius="lg"
          p="lg"
          maw={380}
          w="100%"
          style={{ textAlign: 'center', margin: '0 auto' }}
        >
          <Stack gap="xs" align="center">
            <Text fw={700} size="lg">
              {t('home.header', 'Your messages')}
            </Text>
            <Text c="dimmed" size="sm" mb="xs">
              {t('home.subheader', 'Send a message to start a chat.')}
            </Text>
            <Button
              size="md"
              onClick={() => {
                const text = msg.trim();
                openNewChatDraft(text ? { text } : {});
                if (text) setMsg('');
              }}
            >
              {t('home.cta', 'Send message')}
            </Button>
          </Stack>
        </Card>
      </Box>

      {/* Unified BottomComposer */}
      <BottomComposer
        value={msg}
        onChange={setMsg}
        placeholder={t('home.inputPlaceholder', 'Type a message…')}
        onSend={(payload = {}) => {
          const text = msg.trim();

          const draft = {
            ...(text ? { text } : {}),
            ...(payload.attachments ? { attachments: payload.attachments } : {}),
            ...(payload.files ? { files: payload.files } : {}),
          };

          openNewChatDraft(draft);

          // Clear only if they typed something (keep drafts if it was just an attachment)
          if (text) setMsg('');
        }}
      />
    </Box>
  );
}
