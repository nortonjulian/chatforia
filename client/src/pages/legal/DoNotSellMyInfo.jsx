import { Container, Title, Text, Button, Anchor } from '@mantine/core';
import { useTranslation } from 'react-i18next';

export default function DoNotSellMyInfo() {
  const { t } = useTranslation();

  return (
    <Container size="md" py="xl">
      <Title order={1}>
        {t(
          'doNotSell.title',
          'Do Not Sell or Share My Personal Information'
        )}
      </Title>

      <Text c="dimmed" mb="md">
        {t(
          "doNotSell.bodyAudit20261103",
          "Use this page to request an opt-out of the sale or sharing of your personal information, including sharing for cross-context behavioral advertising where applicable. Advertising integrations may process identifiers and online activity. The button below opens your email app; send the message to submit your request. Clicking the button alone does not change advertising settings. You do not need a Chatforia account to email a request."
        )}
      </Text>

      <Text mb="md"><Anchor href="/legal/cookies">{t('doNotSell.browserChoices', 'Turn off third-party advertising for this browser in Cookie Settings')}</Anchor></Text>

      <Button
        radius="xl"
        component="a"
        href="mailto:privacy@chatforia.com?subject=CPRA%20Request"
      >
        {t(
          'doNotSell.cta',
          'Submit a request'
        )}
      </Button>
    </Container>
  );
}
