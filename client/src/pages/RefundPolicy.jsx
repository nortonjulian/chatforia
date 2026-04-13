import { Container, Title, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';

export default function RefundPolicy() {
  const { t } = useTranslation();

  return (
    <Container size="md" py="xl" pt="3.5rem">
      <Title order={2}>
        {t('refund.title', 'Refund Policy')}
      </Title>

      <Text c="dimmed" mb="md">
        {t('refund.lastUpdated', 'Last updated:')} April 13, 2026
      </Text>

      <Text mb="md">
        {t(
          'refund.intro',
          'At Chatforia, we strive to provide a high-quality service to all users. This Refund Policy outlines when refunds may be issued.'
        )}
      </Text>

      <Title order={4} mt="md" mb="xs">
        {t('refund.subscriptions.title', 'Subscriptions')}
      </Title>
      <Text mb="md">
        {t(
          'refund.subscriptions.body',
          'Subscriptions are billed in advance on a recurring basis. You may cancel at any time through your account settings or the platform used to purchase.'
        )}
      </Text>

      <Title order={4} mt="md" mb="xs">
        {t('refund.eligibility.title', 'Refund Eligibility')}
      </Title>
      <Text mb="md">
        {t(
          'refund.eligibility.body',
          'Refunds may be granted for duplicate charges, billing errors, or technical issues preventing access to paid features. All requests are reviewed case-by-case.'
        )}
      </Text>

      <Title order={4} mt="md" mb="xs">
        {t('refund.nonRefundable.title', 'Non-Refundable')}
      </Title>
      <Text mb="md">
        {t(
          'refund.nonRefundable.body',
          'We generally do not provide refunds for unused time, partial subscription periods, or failure to cancel before renewal.'
        )}
      </Text>

      <Title order={4} mt="md" mb="xs">
        {t('refund.thirdParty.title', 'Third-Party Purchases')}
      </Title>
      <Text mb="md">
        {t(
          'refund.thirdParty.body',
          'If purchased through third-party platforms such as the Apple App Store, refunds must be requested directly through those platforms.'
        )}
      </Text>

      <Title order={4} mt="md" mb="xs">
        {t('refund.contact.title', 'Contact')}
      </Title>
      <Text>
        {t(
          'refund.contact.body',
          'support@chatforia.com • Chatforia LLC, 30 N Gould Street STE N, Sheridan, WY 82801, USA'
        )}
      </Text>
    </Container>
  );
}