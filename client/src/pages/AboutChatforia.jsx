import { Container, Title, Text, List, Stack, Paper } from '@mantine/core';
import { useTranslation } from 'react-i18next';

export default function AboutChatforia() {
  const { t } = useTranslation();

  return (
    <Container size="md" py="xl">
      {/* About Chatforia */}
      <Title
        order={2}
        mb="sm"
        aria-label={t('about.title', 'About Chatforia')}
      >
        {t('about.title', 'About Chatforia')}
      </Title>

      <Text
        c="dimmed"
        mb="md"
        aria-label={t(
          'about.description',
          'Chatforia is a secure, multilingual messenger with end-to-end encryption, instant translation, and voice/video calling. Our mission is simple: help people connect—safely, privately, and across languages.'
        )}
      >
        {t(
          'about.description',
          'Chatforia is a secure, multilingual messenger with end-to-end encryption, instant translation, and voice/video calling. Our mission is simple: help people connect—safely, privately, and across languages.'
        )}
      </Text>

      <Stack gap="sm">
        {/* What we value */}
        <Paper withBorder p="md" radius="md">
          <Title
            order={4}
            mb={6}
            aria-label={t('about.valuesTitle', 'What we value')}
          >
            {t('about.valuesTitle', 'What we value')}
          </Title>

          <List>
            <List.Item
              aria-label={t(
                'about.values.privacy',
                'Privacy-first: E2E encryption by default.'
              )}
            >
              {t(
                'about.values.privacy',
                'Privacy-first: E2E encryption by default.'
              )}
            </List.Item>

            <List.Item
              aria-label={t(
                'about.values.access',
                'Access for all: Auto-translate 100+ languages.'
              )}
            >
              {t(
                'about.values.access',
                'Access for all: Auto-translate 100+ languages.'
              )}
            </List.Item>

            <List.Item
              aria-label={t(
                'about.values.control',
                'Control: Disappearing messages & read receipts are optional.'
              )}
            >
              {t(
                'about.values.control',
                'Control: Disappearing messages & read receipts are optional.'
              )}
            </List.Item>
          </List>
        </Paper>

        {/* How Chatforia works */}
        <Paper withBorder p="md" radius="md">
          <Title
            order={4}
            mb={6}
            aria-label={t('about.howTitle', 'How Chatforia works')}
          >
            {t('about.howTitle', 'How Chatforia works')}
          </Title>

          <Text
            aria-label={t(
              'about.howDescription',
              'Messages are encrypted on your device before they leave it. Translation, backups, and device sync are designed to minimize what our servers can see.'
            )}
          >
            {t(
              'about.howDescription',
              'Messages are encrypted on your device before they leave it. Translation, backups, and device sync are designed to minimize what our servers can see.'
            )}
          </Text>
        </Paper>
      </Stack>
    </Container>
  );
}
