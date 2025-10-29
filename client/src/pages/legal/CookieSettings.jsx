import React from 'react';
import { Container, Title, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';

export default function CookieSettings() {
  const { t } = useTranslation();

  return (
    <Container size="md" py="xl">
      <Title order={2}>
        {t('cookies.title', 'Cookie Settings')}
      </Title>

      <Text c="dimmed" mb="md">
        {t(
          'cookies.body',
          "Chatforia uses minimal cookies (e.g., session, security). We don’t use third-party ads cookies. Manage cookies via your browser’s settings."
        )}
      </Text>
    </Container>
  );
}
