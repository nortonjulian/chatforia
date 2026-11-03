import { Container, Title, Text, Anchor } from '@mantine/core';
import { useTranslation } from 'react-i18next';

const LAST_UPDATED = 'November 3, 2026';

export default function RefundPolicy() {
  const { t } = useTranslation();

  return (
    <Container size="md" py="xl">
      <Title order={1}>
        {t('refund.title', 'Refund Policy')}
      </Title>

      <Text c="dimmed" mb="md">
        {t('refund.lastUpdated', 'Last updated:')} {LAST_UPDATED}
      </Text>

      <Text mb="md">
        {t(
          'refund.intro',
          'At Chatforia, we strive to provide a high-quality service to all users. This Refund Policy outlines when refunds may be issued.'
        )}
      </Text>

      <Title order={2} mt="md" mb="xs">
        {t('refund.subscriptions.title', 'Subscriptions')}
      </Title>
      <Text mb="md">
        {t(
          "refund.subscriptions.bodyAudit20261103",
          "Subscriptions renew according to the terms shown at purchase. Cancel through the billing settings or store where you subscribed. Cancellation stops future renewal; it does not itself request a refund of an earlier charge."
        )}
      </Text>

      <Title order={2} mt="md" mb="xs">
        {t('refund.eligibility.title', 'Refund Eligibility')}
      </Title>
      <Text mb="md">
        {t(
          'refund.eligibility.body',
          'Refunds may be granted for duplicate charges, billing errors, or technical issues preventing access to paid features. All requests are reviewed case-by-case.'
        )}
      </Text>

      <Title order={2} mt="md" mb="xs">
        {t('refund.nonRefundable.title', 'Non-Refundable')}
      </Title>
      <Text mb="md">
        {t(
          "refund.nonRefundable.bodyAudit20261103",
          "We generally do not provide refunds for unused time, partial subscription periods, or failure to cancel before renewal, except where required by applicable law or the purchase platform policy. This policy does not limit your statutory consumer rights."
        )}
      </Text>

      <Title order={2} mt="md" mb="xs">
        {t('refund.thirdParty.title', 'Third-Party Purchases')}
      </Title>
      <Text mb="md">
        {t(
          "refund.thirdParty.bodyAudit20261103",
          "For Apple App Store purchases, request a refund through Apple at reportaproblem.apple.com. For Google Play purchases, use Google Play refund support or contact us with your order details. Eligibility and processing depend on the purchase platform and applicable law."
        )}
      </Text>

      <Text mb="md"><Anchor href="https://reportaproblem.apple.com/">Apple refund requests</Anchor>{' · '}<Anchor href="https://support.google.com/googleplay/answer/2479637">Google Play refund help</Anchor></Text>
      <Title order={2} mt="md" mb="xs">
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