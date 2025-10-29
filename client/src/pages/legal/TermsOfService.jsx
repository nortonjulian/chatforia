import { Container, Title, Text, List } from '@mantine/core';
import { useTranslation } from 'react-i18next';

export default function TermsOfService() {
  const { t } = useTranslation();

  return (
    <Container size="md" py="xl">
      <Title order={2}>
        {t('terms.title', 'Terms of Service')}
      </Title>

      <Text c="dimmed" mb="md">
        {t('terms.lastUpdated', 'Last updated:')}{' '}
        {new Date().toLocaleDateString()}
      </Text>

      <Text mb="md">
        {t(
          'terms.intro.body',
          'By using Chatforia you agree to these Terms. If you do not agree, don’t use the service.'
        )}
      </Text>

      <Title order={4} mt="md" mb="xs">
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

      <Title order={4} mt="md" mb="xs">
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

      <Title order={4} mt="md" mb="xs">
        {t('terms.yourContent.title', 'Your content')}
      </Title>
      <Text>
        {t(
          'terms.yourContent.body',
          'You retain rights to your content. You grant us necessary rights to operate the service (e.g., routing, storage, translation).'
        )}
      </Text>

      <Title order={4} mt="md" mb="xs">
        {t('terms.disclaimer.title', 'Disclaimers & liability')}
      </Title>
      <Text>
        {t(
          'terms.disclaimer.body',
          'Service is provided “as is” without warranties. To the fullest extent permitted by law, Chatforia isn’t liable for indirect or consequential damages.'
        )}
      </Text>

      <Title order={4} mt="md" mb="xs">
        {t('terms.changes.title', 'Changes')}
      </Title>
      <Text>
        {t(
          'terms.changes.body',
          'We may update these terms; continued use after changes means acceptance.'
        )}
      </Text>

      <Title order={4} mt="md" mb="xs">
        {t('terms.contact.title', 'Contact')}
      </Title>
      <Text>
        {t(
          'terms.contact.body',
          'support@chatforia.com • [Company legal name], [Address]'
        )}
      </Text>
    </Container>
  );
}
