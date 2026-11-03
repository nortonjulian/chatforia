import { Container, Title, Text, List } from '@mantine/core';
import { useTranslation } from 'react-i18next';

const LAST_UPDATED = 'November 3, 2026';

export default function TermsOfService() {
  const { t } = useTranslation();

  return (
    <Container size="md" py="xl">
      <Title order={1}>
        {t('terms.title', 'Terms of Service')}
      </Title>

      <Text c="dimmed" mb="md">
        {t('terms.lastUpdated', 'Last updated:')} {LAST_UPDATED}
      </Text>

      <Text mb="md">
        {t(
          'terms.intro.body',
          'By using Chatforia you agree to these Terms. If you do not agree, don’t use the service.'
        )}
      </Text>

      <Title order={2} mt="md" mb="xs">
        {t('terms.accounts.title', 'Accounts')}
      </Title>
      <List>
        <List.Item>
          {t(
            'terms.accounts.itemAccurateInfo',
            'Provide accurate info and keep credentials secure.'
          )}
        </List.Item>
        <List.Item>
          {t(
            'terms.accounts.itemResponsibility',
            'You’re responsible for activity on your account.'
          )}
        </List.Item>
      </List>

      <Title order={2} mt="md" mb="xs">
        {t('terms.acceptableUse.title', 'Acceptable use')}
      </Title>
      <List>
        <List.Item>
          {t(
            'terms.acceptableUse.itemNoAbuse',
            'No illegal, abusive, or infringing content; no spam or automated abuse.'
          )}
        </List.Item>
        <List.Item>
          {t(
            'terms.acceptableUse.itemSuspend',
            'We may suspend/terminate for violations.'
          )}
        </List.Item>
      </List>

      <Title order={2} mt="md" mb="xs">
        {t('terms.sms.title', 'SMS communications')}
      </Title>
      <Text mb="md">
        {t(
          "terms.sms.bodyAudit20261103",
          "Where you opt in, Chatforia may send account-related SMS such as verification codes and notifications. Providing a phone number alone does not authorize promotional messages. Message frequency varies; message and data rates may apply. Reply STOP to the sending number to opt out, or HELP for assistance. In-app notification settings do not replace SMS opt-out. Users sending SMS/MMS through Chatforia must have the recipient consent required for their messages and respect opt-outs."
        )}
      </Text>

      <Title order={2} mt="md" mb="xs">
        {t('terms.yourContent.title', 'Your content')}
      </Title>
      <Text>
        {t(
          'terms.yourContent.body',
          'You retain rights to your content. You grant us necessary rights to operate the service (e.g., routing, storage, translation).'
        )}
      </Text>

      <Title order={2} mt="md" mb="xs">
        {t('terms.disclaimer.title', 'Disclaimers & liability')}
      </Title>
      <Text>
        {t(
          'terms.disclaimer.body',
          'Service is provided “as is” without warranties. To the fullest extent permitted by law, Chatforia isn’t liable for indirect or consequential damages.'
        )}
      </Text>

      <Title order={2} mt="md" mb="xs">
        {t('terms.changes.title', 'Changes')}
      </Title>
      <Text>
        {t(
          'terms.changes.body',
          'We may update these terms; continued use after changes means acceptance.'
        )}
      </Text>

      <Title order={2} mt="md" mb="xs">
        {t('terms.contact.title', 'Contact')}
      </Title>
      <Text>
        {t(
          'terms.contact.registeredAddress',
          'support@chatforia.com • Chatforia LLC, 30 N Gould Street STE N, Sheridan, WY 82801, USA'
        )}
      </Text>
    </Container>
  );
}