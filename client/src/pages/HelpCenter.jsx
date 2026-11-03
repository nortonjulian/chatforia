import { Container, Title, Accordion, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';

export default function HelpCenter() {
  const { t } = useTranslation();

  return (
    <Container size="md" py="xl">
      <Title order={1} mb="md">
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
                'helpCenter.faq.privacy.transportAnswer',
                'Chatforia supports end-to-end encrypted in-app messaging. SMS/MMS and calls to ordinary phone numbers are not end-to-end encrypted. Optional translation and AI features require processing the text you submit.'
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
                'helpCenter.faq.translate.serviceAnswer',
                'Choose your preferred language and enable Auto-translate in your settings. Translation uses an external service to process message text. Strict end-to-end encryption mode disables translation and AI features.'
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
