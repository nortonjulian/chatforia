import React from 'react';
import { Container, Title, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';

export default function CookieSettings() {
  const { t } = useTranslation();

  return (
    <Container size="md" py="xl">
      <Title order={1}>
        {t('cookies.title', 'Cookie Settings')}
      </Title>

      <Text c="dimmed" mb="md">
        {t(
          "cookies.bodyAudit20261103",
          "Chatforia uses cookies and browser storage for sign-in, security, and preferences. When enabled, analytics and advertising integrations, including PostHog and Google AdSense, may also use cookies, identifiers, or similar technologies. This page currently provides information, not an in-page consent switch. You can manage cookies and site data in your browser; blocking or clearing them may sign you out or affect features. Browser cookie controls do not by themselves submit a privacy request to Chatforia. Contact privacy@chatforia.com for privacy requests."
        )}
      </Text>
    </Container>
  );
}
