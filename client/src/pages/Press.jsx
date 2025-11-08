import { Container, Title, Text, Paper, Stack, Button, Group } from '@mantine/core';

// Public assets are served from / (Vite/CRA). Put your zip here: client/public/brand/chatforia-logo-kit.zip
const MEDIA_KIT_URL = '/brand/chatforia-logo-kit.zip';

export default function Press() {
  return (
    <Container size="lg" py="xl">
      <Title order={2} mb="md">Press</Title>

      <Text c="dimmed" mb="md">
        For media inquiries, reach us at <a href="mailto:press@chatforia.com">press@chatforia.com</a>.
      </Text>

      <Stack gap="lg">
        {/* Boilerplate */}
        <Paper withBorder p="md" radius="md">
          <Title order={4} mb={6}>Boilerplate</Title>
          <Text>
            Chatforia is a privacy-first messaging app that makes cross-language chat effortless.
            Messages are end-to-end encrypted by default, and built-in translation supports 100+
            languages in real time. Users can enable disappearing messages, keep read receipts
            optional, and sync across devices. Available on iOS, Android, and the web.
          </Text>
        </Paper>

        {/* Brand assets (no “coming soon”) */}
        <Paper withBorder p="md" radius="md">
          <Group justify="space-between" align="center" wrap="wrap">
            <div>
              <Title order={4} mb={6}>Brand assets</Title>
              <Text>Logos, screenshots, and product imagery.</Text>
            </div>
            <Button
              component="a"
              href={MEDIA_KIT_URL}
              download="chatforia-logo-kit.zip"
              radius="xl"
            >
              Download media kit
            </Button>
          </Group>
        </Paper>
      </Stack>
    </Container>
  );
}
