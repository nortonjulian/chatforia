import { useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Title, Text, Button, Stack, Paper } from '@mantine/core';
import axios from '@/api/axiosClient';
import { useUser } from '@/context/UserContext';

export default function UpgradeSuccess() {
  const [params] = useSearchParams();
  const sessionId = params.get('session_id');
  const { setCurrentUser } = useUser();

  useEffect(() => {
    (async () => {
      try {
        // Optional: await axios.get(`/billing/session-status?session_id=${sessionId}`);
        const { data } = await axios.get('/auth/me'); // refresh entitlements
        if (data?.user) setCurrentUser((u) => ({ ...u, ...data.user }));
      } catch {}
    })();
  }, [sessionId, setCurrentUser]);

  return (
    <Paper withBorder radius="xl" p="lg" maw={560} mx="auto">
      <Stack gap="xs">
        <Title order={2}>You're all set 🎉</Title>
        <Text c="dimmed">Your subscription is active. Enjoy the new features.</Text>
        <div>
          <Button component={Link} to="/" color="orange">Continue to Chat</Button>
        </div>
      </Stack>
    </Paper>
  );
}
