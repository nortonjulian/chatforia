import React from 'react';
import { Container, Title, Text } from '@mantine/core';

export default function CookieSettings() {
  return (
    <Container size="md" py="xl">
      <Title order={2}>Cookie Settings</Title>
      <Text c="dimmed" mb="md">
        Chatforia uses minimal cookies (e.g., session, security). We don’t use third-party ads cookies.
        Manage cookies via your browser’s settings.
      </Text>
    </Container>
  );
}
