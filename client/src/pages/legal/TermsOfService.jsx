import { Container, Title, Text, List } from '@mantine/core';

export default function TermsOfService() {
  return (
    <Container size="md" py="xl">
      <Title order={2}>Terms of Service</Title>
      <Text c="dimmed" mb="md">Last updated: {new Date().toLocaleDateString()}</Text>

      <Text mb="md">
        By using Chatforia you agree to these Terms. If you do not agree, don’t use the service.
      </Text>

      <Title order={4} mt="md" mb="xs">Accounts</Title>
      <List>
        <List.Item>Provide accurate info and keep credentials secure.</List.Item>
        <List.Item>You’re responsible for activity on your account.</List.Item>
      </List>

      <Title order={4} mt="md" mb="xs">Acceptable use</Title>
      <List>
        <List.Item>No illegal, abusive, or infringing content; no spam or automated abuse.</List.Item>
        <List.Item>We may suspend/terminate for violations.</List.Item>
      </List>

      <Title order={4} mt="md" mb="xs">Your content</Title>
      <Text>You retain rights to your content. You grant us necessary rights to operate the service (e.g., routing, storage, translation).</Text>

      <Title order={4} mt="md" mb="xs">Disclaimers & liability</Title>
      <Text>Service is provided “as is” without warranties. To the fullest extent permitted by law, Chatforia isn’t liable for indirect or consequential damages.</Text>

      <Title order={4} mt="md" mb="xs">Changes</Title>
      <Text>We may update these terms; continued use after changes means acceptance.</Text>

      <Title order={4} mt="md" mb="xs">Contact</Title>
      <Text>support@chatforia.com • [Company legal name], [Address]</Text>
    </Container>
  );
}
