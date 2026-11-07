import { Container, Title, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { PrivacyChoices } from '@/privacy/PrivacyChoices';

export default function CookieSettings() {
  const { t } = useTranslation();
  return <Container size="md" py="xl">
    <Title order={1} mb="md">{t('cookies.title', 'Cookie Settings')}</Title>
    <PrivacyChoices />
    <Text mt="lg">{t('cookies.requests', 'For account-wide privacy requests, contact privacy@chatforia.com. These browser controls do not delete previously collected data or change native app settings.')}</Text>
  </Container>;
}
