import { Container, Title, Text, Group, Image, Anchor, Paper } from '@mantine/core';

const APP_IOS = 'https://go.chatforia.com/ios';
const APP_ANDROID = 'https://go.chatforia.com/android';

export default function Downloads() {
  return (
    <Container size="md" py="xl">
      <Title order={2} mb="md">Get the app</Title>
      <Text c="dimmed" mb="lg">Use the same account on web and mobile. Your messages stay in sync.</Text>

      <Paper withBorder p="lg" radius="lg">
        <Group align="center" justify="space-between">
          <Group gap="md" align="center">
            <Image src="/qr-chatforia.png" alt="Scan to get Chatforia" h={120} w={120} radius="md" />
            <Text size="sm">Scan with your phone to open the download link.</Text>
          </Group>
          <Group gap="sm">
            <Anchor href={APP_IOS} target="_blank" rel="noopener">
              <Image src="/badges/app-store-badge.png" h={56} alt="Download on the App Store" />
            </Anchor>
            <Anchor href={APP_ANDROID} target="_blank" rel="noopener">
              <Image src="/badges/google-play-badge.png" h={56} alt="Get it on Google Play" />
            </Anchor>
          </Group>
        </Group>
      </Paper>
    </Container>
  );
}
