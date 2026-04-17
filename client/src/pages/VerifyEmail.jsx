import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Button, Center, Loader, Paper, Stack, Text, Title } from '@mantine/core';
import axiosClient from '@/api/axiosClient';

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const uid = params.get('uid');
  const token = params.get('token');
  const [state, setState] = useState('loading');

  useEffect(() => {
    console.log('[VerifyEmail] mounted', { uid, token, href: window.location.href });

    const run = async () => {
      try {
        console.log('[VerifyEmail] calling verify endpoint');
        const { data } = await axiosClient.get('/auth/email/verify', {
          params: { uid, token },
        });
        console.log('[VerifyEmail] verify response', data);
        setState(data?.ok ? 'ok' : 'error');
      } catch (err) {
        console.error('[VerifyEmail] verify failed', err?.response?.status, err?.response?.data, err);
        setState('error');
      }
    };

    if (uid && token) run();
    else {
      console.warn('[VerifyEmail] missing uid or token');
      setState('error');
    }
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
              <Button component={Link} to="/" radius="xl">
                Continue to login
              </Button>
            </>
          )}

          {state === 'error' && (
            <>
              <Text c="red">That link is invalid or expired.</Text>
              <Button component={Link} to="/" variant="light" radius="xl">
                Back to login
              </Button>
            </>
          )}
        </Stack>
      </Paper>
    </Center>
  );
}