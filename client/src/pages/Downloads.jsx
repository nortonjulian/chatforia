import { Container, Title, Text, Group, Anchor, Paper } from '@mantine/core';

const APP_GENERIC = 'https://go.chatforia.com/app';
const APP_IOS = 'https://go.chatforia.com/ios';
const APP_ANDROID = 'https://go.chatforia.com/android';
const badgeStyle = { display: 'block', width: 'auto', maxWidth: '100%' };

export default function Downloads() {
  return (
    <Container size="md" py="xl">
      <Title order={1} mb="md">Get the app</Title>
      <Text c="dimmed" mb="lg">Use the same account on web and mobile. Your messages stay in sync.</Text>

      <Paper withBorder p="lg" radius="lg">
        <Group align="center" justify="space-between" gap="lg" wrap="wrap">
          <Group gap="md" align="center" wrap="wrap" style={{ flex: '1 1 260px', minWidth: 0 }}>
            <Anchor
              href={APP_GENERIC}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open the Chatforia download link"
              style={{ display: 'inline-flex', flexShrink: 0 }}
            >
              <img
                src="/qr-chatforia.png"
                alt="Scan to get Chatforia"
                width={120}
                height={120}
                style={{ display: 'block', maxWidth: '100%' }}
              />
            </Anchor>
            <Text size="sm" style={{ flex: '1 1 160px' }}>
              Scan with your phone to open the download link.
            </Text>
          </Group>
          <Group gap="sm" align="center" justify="center" wrap="wrap" style={{ maxWidth: '100%' }}>
            <Anchor href={APP_IOS} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center' }}>
              <img src="/badges/AppStore.svg" alt="Download on the App Store" style={{ ...badgeStyle, height: 38 }} />
            </Anchor>
            <Anchor href={APP_ANDROID} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center' }}>
              <img src="/badges/GooglePlay.svg" alt="Get it on Google Play" style={{ ...badgeStyle, height: 57 }} />
            </Anchor>
          </Group>
        </Group>
      </Paper>
    </Container>
  );
}
