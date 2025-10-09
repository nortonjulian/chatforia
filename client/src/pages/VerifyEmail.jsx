import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Button, Center, Loader, Paper, Stack, Text, Title } from '@mantine/core';

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const uid = params.get('uid');
  const token = params.get('token');
  const [state, setState] = useState('loading'); // loading | ok | error

  useEffect(() => {
    const run = async () => {
      try {
        const resp = await fetch(`/auth/email/verify?uid=${uid}&token=${token}`);
        const json = await resp.json();
        setState(json.ok ? 'ok' : 'error');
      } catch {
        setState('error');
      }
    };
    if (uid && token) run();
    else setState('error');
  }, [uid, token]);

  return (
    <Center mih={320}>
      <Paper withBorder p="lg" radius="md" maw={520} w="100%">
        <Stack gap="sm" align="center">
          <Title order={3}>Email verification</Title>

          {state === 'loading' && (
            <>
              <Loader />
              <Text size="sm" c="dimmed">Checking your verification link…</Text>
            </>
          )}

          {state === 'ok' && (
            <>
              <Text>Your email is verified. You’re all set!</Text>
              <Button component={Link} to="/login" radius="xl">Continue to login</Button>
            </>
          )}

          {state === 'error' && (
            <>
              <Text c="red">That link is invalid or expired.</Text>
              <Button component={Link} to="/resend" variant="light" radius="xl">
                Resend verification email
              </Button>
            </>
          )}
        </Stack>
      </Paper>
    </Center>
  );
}
