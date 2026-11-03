import { Container, Title, Text, List, Anchor } from '@mantine/core';
import { useTranslation } from 'react-i18next';

const LAST_UPDATED = 'November 3, 2026';

export default function PrivacyPolicy() {
  const { t } = useTranslation();

  return (
    <Container size="md" py="xl">
      <Title order={1} mb="sm">
        {t('privacyPolicy.title', 'Privacy Policy')}
      </Title>

      <Text c="dimmed" mb="md">
        {t('privacyPolicy.lastUpdated', 'Last updated:')} {LAST_UPDATED}
      </Text>

      <Text mb="md">
        {t(
          'privacyPolicy.intro.body',
          'This Privacy Policy explains how Chatforia (“we”, “us”) collects, uses, and shares information when you use our apps and services. We design Chatforia to minimize the data we can access.'
        )}
      </Text>

      <Title order={2} mt="md" mb="xs">
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
            "privacyPolicy.infoWeCollect.encryptedAudit20261103",
          "Chatforia supports end-to-end encrypted in-app messaging. SMS/MMS and calls to ordinary phone numbers are not end-to-end encrypted. Message routing records, SMS/MMS content, attachments, and call or voicemail records may be processed to provide the features you use."
          )}
        </List.Item>
        <List.Item>
          {t(
            "privacyPolicy.infoWeCollect.diagnosticsAudit20261103",
          "We process device and browser information, usage events, and diagnostic reports to operate, secure, and improve the service. Depending on the feature and configuration, this includes analytics and error-monitoring services."
          )}
        </List.Item>
        <List.Item>{t('privacyPolicy.recordsAudit20261103', 'Depending on the features you use, we also process profile and saved-contact details, device and verification records, subscription and transaction references, support requests, advertising inquiries, and eSIM provisioning or usage records.')}</List.Item>
      </List>

      {/* 🔹 New: Mobile phone numbers and SMS */}
      <Title order={2} mt="md" mb="xs">
        {t(
          'privacyPolicy.sms.title',
          'Mobile phone numbers and SMS'
        )}
      </Title>
      <Text mb="md">
        {t(
          "privacyPolicy.sms.bodyAudit20261103",
          "We use a phone number you provide for supported verification, account notifications, and messaging features. Consent is requested through the applicable SMS opt-in flow; providing a number alone is not consent to unrelated marketing. Reply STOP to the sending number to opt out of that SMS conversation or program, or contact support@chatforia.com for help. In-app notification preferences are separate from carrier SMS opt-out."
        )}
      </Text>

      <Title order={2} mt="md" mb="xs">
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
            "privacyPolicy.howWeUse.improveAudit20261103",
          "Provide optional translation and AI features. When you use these features, the submitted text is processed by external providers. Strict end-to-end encryption mode disables translation and AI features."
          )}
        </List.Item>
        <List.Item>
          {t(
            'privacyPolicy.howWeUse.legal',
            'Comply with legal obligations.'
          )}
        </List.Item>
      </List>

      <Title order={2} mt="md" mb="xs">
        {t('privacyPolicy.sharing.title', 'Sharing')}
      </Title>
      <Text>
        {t(
          "privacyPolicy.sharing.bodyAudit20261103",
          "We use service providers for hosting and storage, messaging and calls, payments, translation and AI, notifications, analytics, and error monitoring. Information needed for the feature is processed by the relevant provider. Advertising services may also collect device identifiers, online activity, and cookie data when ads are enabled. See Cookie Settings and Do Not Sell or Share My Personal Information for more information and privacy requests."
        )}
      </Text>

      <Title order={2} mt="md" mb="xs">
        {t('privacyPolicy.rights.title', 'Your rights')}
      </Title>
      <Text>
        {t(
          'privacyPolicy.rights.body',
          'Depending on your region (e.g., GDPR/UK GDPR/CPRA), you may request access, correction, deletion, or opt-out of certain processing. Contact: privacy@chatforia.com.'
        )}
      </Text>

      <Title order={2} mt="md" mb="xs">
        {t(
          'privacyPolicy.retention.title',
          'Data retention & security'
        )}
      </Title>
      <Text>
        {t(
          "privacyPolicy.retention.bodyAudit20261103",
          "Retention depends on the type of information and the feature involved, including account operation, billing, security, and legal obligations. Deleting a message or account may not remove copies held by recipients or records that must be retained. Do not include passwords, recovery keys, or other secrets in support requests."
        )}
      </Text>

      <Title order={2} mt="md" mb="xs">
        {t('privacyPolicy.children.title', 'Children')}
      </Title>
      <Text>
        {t(
          'privacyPolicy.children.body',
          'Chatforia isn’t directed to children under 13 (or as required by your local law).'
        )}
      </Text>

      <Title order={2} mt="md" mb="xs">
        {t('privacyPolicy.changes.title', 'Changes')}
      </Title>
      <Text>
        {t(
          'privacyPolicy.changes.body',
          'We’ll post updates here and revise the “Last updated” date.'
        )}
      </Text>

      <Title order={2} mt="md" mb="xs">
        {t('privacyPolicy.contact.title', 'Contact')}
      </Title>
      <Text>
        {t(
          'privacyPolicy.contact.body',
          'privacy@chatforia.com • Chatforia LLC, 30 N Gould Street STE N, Sheridan, WY 82801, USA'
        )}
      </Text>
      <Text mt="md"><Anchor href="/legal/cookies">Cookie Settings</Anchor>{' · '}<Anchor href="/legal/do-not-sell">Do Not Sell or Share My Personal Information</Anchor>{' · '}<Anchor href="/legal/account-deletion">Account deletion</Anchor></Text>
    </Container>
  );
}
