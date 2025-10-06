import { Container, Title, Text, Paper, Stack } from '@mantine/core';

export default function Press() {
  return (
    <Container size="md" py="xl">
      <Title order={2}>Press</Title>
      <Text c="dimmed" mb="md">
        For media inquiries, reach us at <a href="mailto:press@chatforia.com">press@chatforia.com</a>.
      </Text>
      <Stack>
        <Paper withBorder p="md" radius="md">
          <Title order={4}>Boilerplate</Title>
          <Text>
            Chatforia is a secure messenger with instant translation and E2E encryption,
            designed to make global conversations private and effortless.
          </Text>
        </Paper>
        <Paper withBorder p="md" radius="md">
          <Title order={4}>Brand assets</Title>
          <Text>Logos, screenshots, and product imagery (coming soon).</Text>
        </Paper>
      </Stack>
    </Container>
  );
}
