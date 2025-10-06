import { Container, Title, Text, List, Stack, Paper } from '@mantine/core';

export default function AboutChatforia() {
  return (
    <Container size="md" py="xl">
      <Title order={2} mb="sm">About Chatforia</Title>
      <Text c="dimmed" mb="md">
        Chatforia is a secure, multilingual messenger with end-to-end encryption,
        instant translation, and voice/video calling. Our mission is simple:
        help people connect—safely, privately, and across languages.
      </Text>

      <Stack gap="sm">
        <Paper withBorder p="md" radius="md">
          <Title order={4} mb={6}>What we value</Title>
          <List>
            <List.Item><b>Privacy-first:</b> E2E encryption by default.</List.Item>
            <List.Item><b>Access for all:</b> Auto-translate 100+ languages.</List.Item>
            <List.Item><b>Control:</b> Disappearing messages & read receipts are optional.</List.Item>
          </List>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Title order={4} mb={6}>How Chatforia works</Title>
          <Text>
            Messages are encrypted on your device before they leave it. Translation,
            backups, and device sync are designed to minimize what our servers can see.
          </Text>
        </Paper>
      </Stack>
    </Container>
  );
}
