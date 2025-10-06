import { Container, Title, Accordion, Text } from '@mantine/core';

export default function HelpCenter() {
  return (
    <Container size="md" py="xl">
      <Title order={2} mb="md">Help Center</Title>
      <Accordion multiple radius="md" variant="separated">
        <Accordion.Item value="account">
          <Accordion.Control>How do I create or recover my account?</Accordion.Control>
          <Accordion.Panel>
            <Text>Download the app or use web, tap “Create account”, verify your email/phone. To recover, use “Forgot password”.</Text>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="privacy">
          <Accordion.Control>Are messages end-to-end encrypted?</Accordion.Control>
          <Accordion.Panel>
            <Text>Yes. Messages and calls are end-to-end encrypted by default. Only you and the recipient can read them.</Text>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="translate">
          <Accordion.Control>How does instant translation work?</Accordion.Control>
          <Accordion.Panel>
            <Text>Enable “Auto-translate” in Settings → Appearance & Language. We translate on-device where supported, otherwise through secure APIs with minimal metadata.</Text>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="contact">
          <Accordion.Control>Contact support</Accordion.Control>
          <Accordion.Panel>
            <Text>Reach us at <a href="mailto:support@chatforia.com">support@chatforia.com</a>. Include screenshots and your app version.</Text>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Container>
  );
}
