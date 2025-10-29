import { Container, Title, Accordion, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';

export default function HelpCenter() {
  const { t } = useTranslation();

  return (
    <Container size="md" py="xl">
      <Title order={2} mb="md">
        {t('helpCenter.title', 'Help Center')}
      </Title>

      <Accordion multiple radius="md" variant="separated">
        {/* Account / recovery */}
        <Accordion.Item value="account">
          <Accordion.Control>
            {t(
              'helpCenter.faq.account.q',
              'How do I create or recover my account?'
            )}
          </Accordion.Control>
          <Accordion.Panel>
            <Text>
              {t(
                'helpCenter.faq.account.a',
                'Download the app or use web, tap “Create account”, verify your email/phone. To recover, use “Forgot password”.'
              )}
            </Text>
          </Accordion.Panel>
        </Accordion.Item>

        {/* Privacy / encryption */}
        <Accordion.Item value="privacy">
          <Accordion.Control>
            {t(
              'helpCenter.faq.privacy.q',
              'Are messages end-to-end encrypted?'
            )}
          </Accordion.Control>
          <Accordion.Panel>
            <Text>
              {t(
                'helpCenter.faq.privacy.a',
                'Yes. Messages and calls are end-to-end encrypted by default. Only you and the recipient can read them.'
              )}
            </Text>
          </Accordion.Panel>
        </Accordion.Item>

        {/* Translation */}
        <Accordion.Item value="translate">
          <Accordion.Control>
            {t(
              'helpCenter.faq.translate.q',
              'How does instant translation work?'
            )}
          </Accordion.Control>
          <Accordion.Panel>
            <Text>
              {t(
                'helpCenter.faq.translate.a',
                'Enable “Auto-translate” in Settings → Appearance & Language. We translate on-device where supported, otherwise through secure APIs with minimal metadata.'
              )}
            </Text>
          </Accordion.Panel>
        </Accordion.Item>

        {/* Contact */}
        <Accordion.Item value="contact">
          <Accordion.Control>
            {t('helpCenter.faq.contact.q', 'Contact support')}
          </Accordion.Control>
          <Accordion.Panel>
            <Text>
              {t(
                'helpCenter.faq.contact.a',
                'Reach us at support@chatforia.com. Include screenshots and your app version.'
              )}
            </Text>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Container>
  );
}
