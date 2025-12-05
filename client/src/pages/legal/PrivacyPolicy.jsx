import { Container, Title, Text, List } from '@mantine/core';
import { useTranslation } from 'react-i18next';

export default function PrivacyPolicy() {
  const { t } = useTranslation();

  return (
    <Container size="md" py="xl">
      <Title order={2} mb="sm">
        {t('privacyPolicy.title', 'Privacy Policy')}
      </Title>

      <Text c="dimmed" mb="md">
        {t('privacyPolicy.lastUpdated', 'Last updated:')}{' '}
        {new Date().toLocaleDateString()}
      </Text>

      <Text mb="md">
        {t(
          'privacyPolicy.intro.body',
          'This Privacy Policy explains how Chatforia (“we”, “us”) collects, uses, and shares information when you use our apps and services. We design Chatforia to minimize the data we can access.'
        )}
      </Text>

      <Title order={4} mt="md" mb="xs">
        {t(
          'privacyPolicy.infoWeCollect.title',
          'Information we collect'
        )}
      </Title>
      <List>
        <List.Item>
          {t(
            'privacyPolicy.infoWeCollect.account',
            'Account info (e.g., email/phone) to create and secure your account.'
          )}
        </List.Item>
        <List.Item>
          {t(
            'privacyPolicy.infoWeCollect.encrypted',
            'Encrypted content (messages/calls) is end-to-end encrypted; we can’t read it.'
          )}
        </List.Item>
        <List.Item>
          {t(
            'privacyPolicy.infoWeCollect.diagnostics',
            'Diagnostic/usage like crash logs, device type, or coarse analytics to improve performance.'
          )}
        </List.Item>
      </List>

      {/* 🔹 New: Mobile phone numbers and SMS */}
      <Title order={4} mt="md" mb="xs">
        {t(
          'privacyPolicy.sms.title',
          'Mobile phone numbers and SMS'
        )}
      </Title>
      <Text mb="md">
        {t(
          'privacyPolicy.sms.body',
          'If you choose to provide a mobile phone number, we use it to enable features such as account verification, login alerts, and user-to-user messaging via SMS where supported. We may send transactional SMS messages related to your account and activity on Chatforia. You can opt out of receiving SMS messages at any time by replying with a supported opt-out keyword (such as “STOP”) or by changing your notification preferences in the app. We do not sell your phone number or use it for unrelated marketing.'
        )}
      </Text>

      <Title order={4} mt="md" mb="xs">
        {t(
          'privacyPolicy.howWeUse.title',
          'How we use information'
        )}
      </Title>
      <List>
        <List.Item>
          {t(
            'privacyPolicy.howWeUse.provide',
            'Provide and secure the service (auth, spam/abuse detection).'
          )}
        </List.Item>
        <List.Item>
          {t(
            'privacyPolicy.howWeUse.improve',
            'Improve features (translation quality, reliability).'
          )}
        </List.Item>
        <List.Item>
          {t(
            'privacyPolicy.howWeUse.legal',
            'Comply with legal obligations.'
          )}
        </List.Item>
      </List>

      <Title order={4} mt="md" mb="xs">
        {t('privacyPolicy.sharing.title', 'Sharing')}
      </Title>
      <Text>
        {t(
          'privacyPolicy.sharing.body',
          'We don’t sell personal data. We may share limited data with processors (e.g., push notifications, analytics) under strict contracts.'
        )}
      </Text>

      <Title order={4} mt="md" mb="xs">
        {t('privacyPolicy.rights.title', 'Your rights')}
      </Title>
      <Text>
        {t(
          'privacyPolicy.rights.body',
          'Depending on your region (e.g., GDPR/UK GDPR/CPRA), you may request access, correction, deletion, or opt-out of certain processing. Contact: privacy@chatforia.com.'
        )}
      </Text>

      <Title order={4} mt="md" mb="xs">
        {t(
          'privacyPolicy.retention.title',
          'Data retention & security'
        )}
      </Title>
      <Text>
        {t(
          'privacyPolicy.retention.body',
          'We retain only what’s needed to operate the service and apply industry-standard security. E2E content can’t be decrypted by us.'
        )}
      </Text>

      <Title order={4} mt="md" mb="xs">
        {t('privacyPolicy.children.title', 'Children')}
      </Title>
      <Text>
        {t(
          'privacyPolicy.children.body',
          'Chatforia isn’t directed to children under 13 (or as required by your local law).'
        )}
      </Text>

      <Title order={4} mt="md" mb="xs">
        {t('privacyPolicy.changes.title', 'Changes')}
      </Title>
      <Text>
        {t(
          'privacyPolicy.changes.body',
          'We’ll post updates here and revise the “Last updated” date.'
        )}
      </Text>

      <Title order={4} mt="md" mb="xs">
        {t('privacyPolicy.contact.title', 'Contact')}
      </Title>
      <Text>
        {t(
          'privacyPolicy.contact.body',
          'privacy@chatforia.com • Chatforia LLC, 30 N Gould Street STE N, Sheridan, WY 82801, USA'
        )}
      </Text>
    </Container>
  );
}
