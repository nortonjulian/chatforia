import { Container, Title, Text, List, Anchor } from '@mantine/core';

export default function AccountDeletion() {
  return (
    <Container size="md" py="xl" pt="3.5rem">
      <Title order={2} mb="md">
        Chatforia — Account & Data Deletion
      </Title>

      <Text c="dimmed" mb="lg">
        Last updated: June 17, 2026
      </Text>

      <Text mb="md">
        Chatforia users can request deletion of their account and associated personal data.
      </Text>

      <Title order={4} mt="lg" mb="xs">
        How to request account deletion
      </Title>

      <Text mb="md">
        To request account deletion, email us from the email address associated with your
        Chatforia account.
      </Text>

      <Text mb="md">
        Contact:{' '}
        <Anchor href="mailto:admin@chatforia.com">
          admin@chatforia.com
        </Anchor>
      </Text>

      <Text mb="xs">
        Please include:
      </Text>

      <List mb="md">
        <List.Item>Your Chatforia account email address</List.Item>
        <List.Item>Your username, if applicable</List.Item>
        <List.Item>A clear request to delete your account</List.Item>
      </List>

      <Title order={4} mt="lg" mb="xs">
        What data is deleted
      </Title>

      <Text mb="md">
        When your account deletion request is completed, Chatforia will delete or
        anonymize account data associated with your account, including profile information
        and account-related personal data.
      </Text>

      <Title order={4} mt="lg" mb="xs">
        Data we may retain
      </Title>

      <Text mb="md">
        Some information may be retained for a limited period when required for legal,
        security, fraud prevention, tax, accounting, dispute resolution, or compliance
        purposes. Backup copies may also remain for a limited time before being deleted
        through normal backup rotation.
      </Text>

      <Title order={4} mt="lg" mb="xs">
        Processing time
      </Title>

      <Text mb="md">
        We will process verified deletion requests within a reasonable period after
        confirming the request.
      </Text>

      <Title order={4} mt="lg" mb="xs">
        Contact
      </Title>

      <Text>
        For account deletion or privacy questions, contact{' '}
        <Anchor href="mailto:admin@chatforia.com">
          admin@chatforia.com
        </Anchor>.
      </Text>
    </Container>
  );
}