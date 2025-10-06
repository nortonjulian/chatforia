import { Container, Title, Text, List } from '@mantine/core';

export default function PrivacyPolicy() {
  return (
    <Container size="md" py="xl">
      <Title order={2} mb="sm">Privacy Policy</Title>
      <Text c="dimmed" mb="md">Last updated: {new Date().toLocaleDateString()}</Text>

      <Text mb="md">
        This Privacy Policy explains how <b>Chatforia</b> (“we”, “us”) collects, uses, and shares
        information when you use our apps and services. We design Chatforia to minimize the data we can access.
      </Text>

      <Title order={4} mt="md" mb="xs">Information we collect</Title>
      <List>
        <List.Item><b>Account info</b> (e.g., email/phone) to create and secure your account.</List.Item>
        <List.Item><b>Encrypted content</b> (messages/calls) is end-to-end encrypted; we can’t read it.</List.Item>
        <List.Item><b>Diagnostic/usage</b> like crash logs, device type, or coarse analytics to improve performance.</List.Item>
      </List>

      <Title order={4} mt="md" mb="xs">How we use information</Title>
      <List>
        <List.Item>Provide and secure the service (auth, spam/abuse detection).</List.Item>
        <List.Item>Improve features (translation quality, reliability).</List.Item>
        <List.Item>Comply with legal obligations.</List.Item>
      </List>

      <Title order={4} mt="md" mb="xs">Sharing</Title>
      <Text>We don’t sell personal data. We may share limited data with processors (e.g., push notifications, analytics) under strict contracts.</Text>

      <Title order={4} mt="md" mb="xs">Your rights</Title>
      <Text>Depending on your region (e.g., GDPR/UK GDPR/CPRA), you may request access, correction, deletion, or opt-out of certain processing. Contact: privacy@chatforia.com.</Text>

      <Title order={4} mt="md" mb="xs">Data retention & security</Title>
      <Text>We retain only what’s needed to operate the service and apply industry-standard security. E2E content can’t be decrypted by us.</Text>

      <Title order={4} mt="md" mb="xs">Children</Title>
      <Text>Chatforia isn’t directed to children under 13 (or as required by your local law).</Text>

      <Title order={4} mt="md" mb="xs">Changes</Title>
      <Text>We’ll post updates here and revise the “Last updated” date.</Text>

      <Title order={4} mt="md" mb="xs">Contact</Title>
      <Text>privacy@chatforia.com • [Company legal name], [Address]</Text>
    </Container>
  );
}
