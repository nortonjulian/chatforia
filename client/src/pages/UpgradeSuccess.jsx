import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Title, Text, Button, Stack, Paper, Alert, Loader, Group } from '@mantine/core';
import axios from '@/api/axiosClient';
import { useUser } from '@/context/UserContext';

export default function UpgradeSuccess() {
  const { setCurrentUser } = useUser();
  const [status, setStatus] = useState('checking'); // checking | active | pending | error

  useEffect(() => {
    let mounted = true;

    async function refreshBilling() {
      try {
        const me = await axios.get('/auth/me');
        if (mounted && me?.data?.user) {
          setCurrentUser((u) => ({ ...u, ...me.data.user }));
        }

        const planRes = await axios.get('/billing/my-plan');
        const plan = planRes?.data?.plan;

        if (!mounted) return;

        if (plan && !plan.isFree && plan.status === 'ACTIVE') {
          setStatus('active');
        } else {
          setStatus('pending');
        }
      } catch {
        if (mounted) setStatus('error');
      }
    }

    refreshBilling();

    return () => {
      mounted = false;
    };
  }, [setCurrentUser]);

  return (
    <Paper withBorder radius="xl" p="lg" maw={560} mx="auto">
      <Stack gap="xs">
        <Title order={2}>Subscription status</Title>

        {status === 'checking' && (
          <Group>
            <Loader size="sm" />
            <Text c="dimmed">Refreshing your subscription…</Text>
          </Group>
        )}

        {status === 'active' && (
          <>
            <Text c="dimmed">Your subscription is active. Enjoy the new features.</Text>
            <Button component={Link} to="/" color="orange">
              Continue to Chat
            </Button>
          </>
        )}

        {status === 'pending' && (
          <Alert color="yellow" title="Still syncing">
            Your payment was received, but your plan has not updated yet. This can take a moment.
            Try refreshing your plan from the billing page.
            <Button component={Link} to="/account/plan" mt="sm" variant="light">
              View My Plan
            </Button>
          </Alert>
        )}

        {status === 'error' && (
          <Alert color="red" title="Could not refresh subscription">
            We could not confirm your subscription yet. Please check My Plan or contact support.
            <Button component={Link} to="/account/plan" mt="sm" variant="light">
              View My Plan
            </Button>
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}