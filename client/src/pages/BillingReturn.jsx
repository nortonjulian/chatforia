import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { Paper, Title, Text, Button, Group, Stack, Alert, Loader, Badge } from '@mantine/core';
import { IconInfoCircle, IconCheck, IconAlertTriangle } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';

import axiosClient from '@/api/axiosClient';
import { useUser } from '@/context/UserContext';

export default function BillingReturn() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser, setCurrentUser } = useUser();
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  // Parse any query flags if you want (not required for Stripe Portal)
  const params = new URLSearchParams(location.search);
  const canceled = params.get('canceled') === '1';

  // Refresh the authed user so plan/period end is up to date
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!currentUser) {
        // Not logged in? Send to login then back here.
        navigate('/login?next=/billing/return', { replace: true });
        return;
      }
      try {
        const { data } = await axiosClient.get('/auth/me');
        if (mounted && data?.user) {
          setCurrentUser((prev) => ({ ...prev, ...data.user }));
        }
      } catch (e) {
        // If /auth/me fails, keep going—UI will still render with existing state
        // Optionally, redirect to login on 401
        if (e?.response?.status === 401) {
          navigate('/login?next=/billing/return', { replace: true });
          return;
        }
      } finally {
        mounted && setLoading(false);
      }
    })();
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const planName = (currentUser?.plan || 'FREE').toUpperCase();
  const isPaid = planName === 'PLUS' || planName === 'PREMIUM';

  // We store planExpiresAt when the user hits "cancel at period end"
  const scheduledCancel = useMemo(() => {
    if (!isPaid) return false;
    const dt = currentUser?.planExpiresAt ? new Date(currentUser.planExpiresAt) : null;
    return dt && Number.isFinite(dt.getTime()) && dt.getTime() > Date.now();
  }, [currentUser?.planExpiresAt, isPaid]);

  const endDateLabel = useMemo(() => {
    if (!scheduledCancel) return '';
    try {
      const d = new Date(currentUser.planExpiresAt);
      return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return '';
    }
  }, [scheduledCancel, currentUser?.planExpiresAt]);

  const openBillingPortal = async () => {
    try {
      setWorking(true);
      const { data } = await axiosClient.post('/billing/portal', {});
      const url = data?.portalUrl || data?.url;
      if (url) window.location.href = url;
    } catch (e) {
      notifications.show({ color: 'red', message: 'Could not open billing portal.' });
    } finally {
      setWorking(false);
    }
  };

  const uncancel = async () => {
    try {
      setWorking(true);
      const { data } = await axiosClient.post('/billing/uncancel', {});
      // Refresh user to clear planExpiresAt
      const me = await axiosClient.get('/auth/me');
      if (me?.data?.user) {
        setCurrentUser((prev) => ({ ...prev, ...me.data.user }));
      }
      notifications.show({ color: 'green', message: 'Your subscription will continue next period.' });
    } catch (e) {
      notifications.show({ color: 'red', message: 'Could not keep your subscription active.' });
    } finally {
      setWorking(false);
    }
  };

  if (loading) {
    return (
      <Group justify="center" align="center" mih={200}>
        <Loader />
      </Group>
    );
  }

  return (
    <Paper withBorder radius="xl" shadow="sm" p="lg" maw={720} mx="auto" mt="md">
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Group gap="xs" align="center">
            <Title order={3}>Billing</Title>
            {isPaid ? (
              <Badge color="green" variant="light">{planName}</Badge>
            ) : (
              <Badge color="gray" variant="light">FREE</Badge>
            )}
          </Group>
          <Button variant="light" onClick={() => navigate('/upgrade')}>Back to Plans</Button>
        </Group>

        {!canceled ? (
          <Alert
            icon={<IconCheck size={18} />}
            color="teal"
            title="You're back from Billing"
          >
            If you updated your payment method or plan, it may take a few seconds to reflect.
          </Alert>
        ) : (
          <Alert
            icon={<IconInfoCircle size={18} />}
            color="blue"
            title="Checkout canceled"
          >
            No changes were made. You can resume any time.
          </Alert>
        )}

        {scheduledCancel && (
          <Alert
            icon={<IconAlertTriangle size={18} />}
            color="orange"
            title={`Scheduled to revert to Free on ${endDateLabel}`}
          >
            You’ve turned on “cancel at period end.” If you change your mind, keep your {planName} benefits going.
            <Group mt="sm">
              <Button loading={working} onClick={uncancel}>
                Keep {planName}
              </Button>
              <Button variant="light" loading={working} onClick={openBillingPortal}>
                Manage in Billing Portal
              </Button>
            </Group>
          </Alert>
        )}

        {!scheduledCancel && isPaid && (
          <Alert
            icon={<IconInfoCircle size={18} />}
            color="gray"
            title="Subscription active"
          >
            Your {planName} subscription is active. You can manage payment and receipts in the Billing Portal.
          </Alert>
        )}

        {!isPaid && (
          <Alert
            icon={<IconInfoCircle size={18} />}
            color="gray"
            title="No active subscription"
          >
            You're on the Free plan. Upgrade to remove ads and unlock more features.
          </Alert>
        )}

        <Group justify="flex-end" mt="xs">
          <Button variant="light" component={Link} to="/upgrade">
            View Plans
          </Button>
          <Button loading={working} onClick={openBillingPortal}>
            Open Billing Portal
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
