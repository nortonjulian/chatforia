import { Container, Title, Text, List, Stack, Paper } from '@mantine/core';
import { useTranslation, Trans } from 'react-i18next';

export default function AboutChatforia() {
  const { t } = useTranslation();

  return (
    <Container size="md" py="xl">
      <Title order={2} mb="sm" aria-label={t('about.title', 'About Chatforia')}>
        {t('about.title', 'About Chatforia')}
      </Title>

      <Text c="dimmed" mb="md" aria-label={t('about.description')}>
        {t(
          'about.description',
          'Chatforia is a secure, multilingual messenger with end-to-end encryption, instant translation, and voice/video calling. Our mission is simple: help people connect—safely, privately, and across languages.'
        )}
      </Text>

      <Stack gap="sm">
        <Paper withBorder p="md" radius="md">
          <Title order={4} mb={6} aria-label={t('about.valuesTitle', 'What we value')}>
            {t('about.valuesTitle', 'What we value')}
          </Title>

          <List>
            <List.Item aria-label={t('about.values.privacy_aria', 'Privacy-first: E2E encryption by default.')}>
              <Trans
                i18nKey="about.values.privacy"
                components={{ b: <strong /> }}
                defaults="<b>Privacy-first:</b> E2E encryption by default."
              />
            </List.Item>

            <List.Item aria-label={t('about.values.access_aria', 'Access for all: Auto-translate 100+ languages.')}>
              <Trans
                i18nKey="about.values.access"
                components={{ b: <strong /> }}
                defaults="<b>Access for all:</b> Auto-translate 100+ languages."
              />
            </List.Item>

            <List.Item aria-label={t('about.values.control_aria', 'Control: Disappearing messages & read receipts are optional.')}>
              <Trans
                i18nKey="about.values.control"
                components={{ b: <strong /> }}
                defaults="<b>Control:</b> Disappearing messages & read receipts are optional."
              />
            </List.Item>
          </List>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Title order={4} mb={6} aria-label={t('about.howTitle', 'How Chatforia works')}>
            {t('about.howTitle', 'How Chatforia works')}
          </Title>

          <Text aria-label={t('about.howDescription')}>
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
