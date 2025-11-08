// client/src/pages/Press.jsx
import { Container, Title, Text, Paper, Stack, Button, Group } from '@mantine/core';
import { useTranslation } from 'react-i18next';

// Public assets are served from / (Vite/CRA). Put your zip here: client/public/brand/chatforia-logo-kit.zip
const MEDIA_KIT_URL = '/brand/chatforia-logo-kit.zip';

export default function Press() {
  const { t } = useTranslation();

  const pageTitle = t('press.title', 'Press');

  const boilerplateTitle = t('press.boilerplateTitle', 'Boilerplate');
  const boilerplateBody = t(
    'press.boilerplateBody',
    'Chatforia is a privacy-first messaging app that makes cross-language chat effortless. ' +
      'Messages are end-to-end encrypted by default, and built-in translation supports 100+ ' +
      'languages in real time. Users can enable disappearing messages, keep read receipts ' +
      'optional, and sync across devices. Available on iOS, Android, and the web.'
  );

  const contactLine = t(
    'press.contactLine',
    'For media inquiries, reach us at'
  );

  const assetsTitle = t('press.assetsTitle', 'Brand assets');
  const assetsSubtitle = t('press.assetsSubtitle', 'Logos, screenshots, and product imagery.');
  const downloadCta = t('press.downloadCta', 'Download media kit');

  return (
    <Container size="lg" py="xl">
      <Title order={2} mb="md">{pageTitle}</Title>

      <Text c="dimmed" mb="md">
        {contactLine} <a href="mailto:press@chatforia.com">press@chatforia.com</a>.
      </Text>

      <Stack gap="lg">
        {/* Boilerplate */}
        <Paper withBorder p="md" radius="md">
          <Title order={4} mb={6}>{boilerplateTitle}</Title>
          <Text>{boilerplateBody}</Text>
        </Paper>

        {/* Brand assets */}
        <Paper withBorder p="md" radius="md">
          <Group justify="space-between" align="center" wrap="wrap">
            <div>
              <Title order={4} mb={6}>{assetsTitle}</Title>
              <Text>{assetsSubtitle}</Text>
            </div>
            <Button
              component="a"
              href={MEDIA_KIT_URL}
              download="chatforia-logo-kit.zip"
              radius="xl"
            >
              {downloadCta}
            </Button>
          </Group>
        </Paper>
      </Stack>
    </Container>
  );
}
