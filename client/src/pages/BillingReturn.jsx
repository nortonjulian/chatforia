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

  const [plan, setPlan] = useState(null);
  const [planStatus, setPlanStatus] = useState('checking'); 
  const [retryCount, setRetryCount] = useState(0);

  // Parse any query flags if you want (not required for Stripe Portal)
  const params = new URLSearchParams(location.search);
  const canceled = params.get('canceled') === '1';

  // Refresh the authed user so plan/period end is up to date
  useEffect(() => {
    let mounted = true;

    (async () => {
      if (!currentUser) {
        navigate('/login?next=/billing/return', { replace: true });
        return;
      }

      try {
        // Step 1: refresh user
        const { data } = await axiosClient.get('/auth/me');
        if (mounted && data?.user) {
          setCurrentUser((prev) => ({ ...prev, ...data.user }));
        }

        // 👇 Step 2: ADD THIS (billing check)
        const planRes = await axiosClient.get('/billing/my-plan');
        const nextPlan = planRes?.data?.plan || null;

        if (mounted) {
          setPlan(nextPlan);

          if (nextPlan && !nextPlan.isFree && nextPlan.status === 'ACTIVE') {
            setPlanStatus('active');
          } else {
            setPlanStatus('free');
          }
        }

      } catch (e) {
        if (e?.response?.status === 401) {
          navigate('/login?next=/billing/return', { replace: true });
          return;
        }

        if (mounted) {
          setPlanStatus('error');
        }

      } finally {
        mounted && setLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (planStatus !== 'free' || canceled) return;
    if (retryCount >= 3) return; // limit retries

    const timer = setTimeout(async () => {
      try {
        const res = await axiosClient.get('/billing/my-plan');
        const retryPlan = res?.data?.plan;

        if (retryPlan && !retryPlan.isFree && retryPlan.status === 'ACTIVE') {
          setPlan(retryPlan);
          setPlanStatus('active');
          return;
        }

        setRetryCount((c) => c + 1);
      } catch {
        setRetryCount((c) => c + 1);
      }
    }, 3000); // retry every 3s

    return () => clearTimeout(timer);
  }, [planStatus, retryCount, canceled]);

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

        {planStatus === 'checking' && (
          <Alert color="blue" title="Refreshing subscription">
            Checking your latest billing status…
          </Alert>
        )}

        {planStatus === 'free' && !canceled && (
          <Alert
            icon={<IconAlertTriangle size={18} />}
            color="yellow"
            title="Subscription still syncing"
          >
            If you just completed checkout, your plan may take a few seconds to update.
          </Alert>
        )}

        {plan && planStatus === 'active' && (
          <Text size="sm" c="dimmed">
            Status: {plan?.status}
          </Text>
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
