import { useEffect } from 'react';
import {
  Button,
  Container,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import {
  Link,
  useSearchParams,
} from 'react-router-dom';

export default function MobileEsimCheckoutReturn({
  status,
}) {
  const [searchParams] = useSearchParams();

  const completed = status === 'complete';
  const sessionId =
    searchParams.get('session_id') || '';

  const appURL = new URL(
    completed
      ? 'chatforia://checkout/esim/complete'
      : 'chatforia://checkout/esim/canceled'
  );

  if (sessionId) {
    appURL.searchParams.set(
      'session_id',
      sessionId
    );
  }

  const appURLString = appURL.toString();

  useEffect(() => {
    const userAgent =
      window.navigator.userAgent || '';

    const isIOS =
      /iPad|iPhone|iPod/i.test(userAgent) ||
      (
        window.navigator.platform ===
          'MacIntel' &&
        window.navigator.maxTouchPoints > 1
      );

    const isAndroid =
      /Android/i.test(userAgent);

    if (!isIOS && !isAndroid) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      window.location.assign(appURLString);
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [appURLString]);

  return (
    <Container size="xs" py={80}>
      <Paper
        withBorder
        radius="xl"
        p="xl"
        shadow="sm"
      >
        <Stack gap="lg">
          <Title order={2}>
            {completed
              ? 'Your data pack was added'
              : 'Checkout canceled'}
          </Title>

          <Text c="dimmed">
            {completed
              ? 'Return to Chatforia to see your updated eSIM balance.'
              : 'No new data pack was added.'}
          </Text>

          <Button
            component="a"
            href={appURLString}
            size="lg"
            fullWidth
          >
            Open Chatforia
          </Button>

          <Button
            component={Link}
            to="/"
            variant="subtle"
            fullWidth
          >
            Continue on the website
          </Button>
        </Stack>
      </Paper>
    </Container>
  );
}
