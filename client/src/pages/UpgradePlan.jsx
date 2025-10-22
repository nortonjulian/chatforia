import { useState } from 'react';
import {
  Card,
  Title,
  Text,
  Button,
  Group,
  Stack,
  Badge,
  Alert,
  SimpleGrid,
} from '@mantine/core';
import axiosClient from '../api/axiosClient';
import { useUser } from '../context/UserContext';
import { Link, useNavigate } from 'react-router-dom';

function PlanCard({
  title,
  price,
  features = [],
  cta,
  onClick,
  highlight = false,
  disabled = false,
  loading = false,
  badge,
}) {
  return (
    <Card withBorder radius="xl" shadow={highlight ? 'md' : 'sm'} p="lg">
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Title order={3}>{title}</Title>
          {badge && <Badge color="yellow">{badge}</Badge>}
        </Group>

        <Title order={2}>{price}</Title>

        <Stack gap={4}>
          {features.map((f) => (
            <Text key={f} size="sm">• {f}</Text>
          ))}
        </Stack>

        <Button
          mt="sm"
          onClick={onClick}
          disabled={disabled || loading}
          loading={loading}
          aria-busy={loading ? 'true' : 'false'}
        >
          {cta}
        </Button>
      </Stack>
    </Card>
  );
}

export default function UpgradePage({ variant = 'account' }) {
  const { currentUser } = useUser();
  const navigate = useNavigate();
  const [loadingCheckout, setLoadingCheckout] = useState(false);
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [loadingKeep, setLoadingKeep] = useState(false);

  const isAuthed = !!currentUser;
  const planName = (currentUser?.plan || 'FREE').toUpperCase();
  const isFree = planName === 'FREE';
  const isPlus = planName === 'PLUS';
  const isPremium = planName === 'PREMIUM';
  const isPaid = isPlus || isPremium;

  const cancelAt = currentUser?.planExpiresAt ? new Date(currentUser.planExpiresAt) : null;
  const hasScheduledDowngrade =
    Boolean(isAuthed && isPaid && cancelAt && !Number.isNaN(cancelAt.getTime()) && cancelAt > new Date());

  const startCheckout = async (plan) => {
    if (!isAuthed) return navigate('/login?next=/upgrade');
    try {
      setLoadingCheckout(true);
      const { data } = await axiosClient.post('/billing/checkout', { plan });
      const url = data?.checkoutUrl || data?.url;
      if (url) window.location.href = url;
    } catch (e) {
      console.error('Checkout error', e);
    } finally {
      setLoadingCheckout(false);
    }
  };

  const openBillingPortal = async () => {
    if (!isAuthed) return navigate('/login?next=/upgrade');
    try {
      setLoadingPortal(true);
      const { data } = await axiosClient.post('/billing/portal', {});
      const url = data?.portalUrl || data?.url;
      if (url) window.location.href = url;
    } catch (e) {
      console.error('Portal error', e);
    } finally {
      setLoadingPortal(false);
    }
  };

  const refreshMe = async () => {
    try {
      const { data } = await axiosClient.get('/auth/me');
      if (!data?.user) return;
      window.location.reload();
    } catch {}
  };

  const unCancel = async () => {
    if (!isAuthed) return;
    try {
      setLoadingKeep(true);
      await axiosClient.post('/billing/uncancel');
      await refreshMe();
    } catch (e) {
      console.error('Uncancel error', e);
    } finally {
      setLoadingKeep(false);
    }
  };

  return (
    <Stack gap="lg" maw={900} mx="auto" p="md">
      <Title order={2}>Upgrade</Title>
      <Text c="dimmed">
        Unlock the right plan for you: go ad-free with Plus, or get our full power features with Premium.
      </Text>

      {/* Scheduled downgrade banner */}
      {hasScheduledDowngrade && (
        <Alert color="orange" variant="light" title="Subscription will end">
          You’ll revert to Free on <strong>{cancelAt.toLocaleDateString()}</strong>.
          <Button
            size="xs"
            ml="sm"
            variant="filled"
            onClick={unCancel}
            loading={loadingKeep}
            aria-busy={loadingKeep ? 'true' : 'false'}
          >
            Keep {isPlus ? 'Plus' : 'Premium'}
          </Button>
          <Button
            size="xs"
            ml="xs"
            variant="light"
            onClick={openBillingPortal}
            disabled={loadingPortal}
            loading={loadingPortal}
            aria-busy={loadingPortal ? 'true' : 'false'}
          >
            Manage billing
          </Button>
        </Alert>
      )}

      {/* 2×2 grid: Free / Plus on the top row, Premium Monthly / Premium Annual on the bottom row */}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        {/* Free */}
        <PlanCard
          title="Free"
          price="$0"
          features={[
            '1:1 and group messaging',
            'Basic AI replies',
            'Standard attachments',
          ]}
          cta={isFree ? 'Current Plan' : 'Switch to Free (not available)'}
          onClick={() => {}}
          disabled={!isPaid}
        />

        {/* Plus (Ad-free) */}
        <PlanCard
          title="Plus"
          price="$4.99 / mo"
          features={[
            'Remove all ads',
            '1:1 and group messaging',
            'Larger attachments',
            'Basic AI replies',
          ]}
          badge={!isPremium && !isPlus ? 'Popular' : undefined}
          cta={
            isAuthed
              ? (isPlus || isPremium
                  ? (loadingPortal ? 'Opening…' : 'Manage Billing')
                  : (loadingCheckout ? 'Redirecting…' : 'Go Ad-Free'))
              : 'Continue'
          }
          onClick={() =>
            isAuthed
              ? (isPlus || isPremium ? openBillingPortal() : startCheckout('PLUS_MONTHLY'))
              : navigate('/login?next=/upgrade')
          }
          loading={isAuthed ? (isPlus || isPremium ? loadingPortal : loadingCheckout) : false}
        />

        {/* Premium — Monthly */}
        <PlanCard
          title="Premium (Monthly)"
          price="$24.99 / mo"
          features={[
            'Everything in Plus',
            'Custom ringtones & message tones',
            'Power AI features',
            'Priority updates',
            'Backups & device syncing',
          ]}
          highlight
          badge="Best value"
          cta={
            isAuthed
              ? (isPremium
                  ? (loadingPortal ? 'Opening…' : 'Manage Billing')
                  : (loadingCheckout ? 'Redirecting…' : 'Upgrade (Monthly)'))
            : 'Continue'
          }
          onClick={() =>
            isAuthed
              ? (isPremium ? openBillingPortal() : startCheckout('PREMIUM_MONTHLY'))
              : navigate('/login?next=/upgrade')
          }
          loading={isAuthed ? (isPremium ? loadingPortal : loadingCheckout) : false}
        />

        {/* Premium — Annual */}
        <PlanCard
          title="Premium (Annual)"
          price="$225 / year"
          features={[
            'Everything in Premium',
            'Billed annually',
            'Save ~25% vs monthly',
            'Same features as Monthly',
          ]}
          badge="Save 25%"
          cta={
            isAuthed
              ? (isPremium
                  ? (loadingPortal ? 'Opening…' : 'Manage Billing')
                  : (loadingCheckout ? 'Redirecting…' : 'Upgrade (Annual)'))
              : 'Continue'
          }
          onClick={() =>
            isAuthed
              ? startCheckout('PREMIUM_ANNUAL')
              : navigate('/login?next=/upgrade')
          }
          loading={isAuthed ? loadingCheckout : false}
        />
      </SimpleGrid>

      {!isAuthed && (
        <Group mt="xs" gap="sm">
          <Button component={Link} to="/register?next=/upgrade" variant="light">
            Create account
          </Button>
          <Button component={Link} to="/login?next=/upgrade" variant="subtle">
            Sign in
          </Button>
        </Group>
      )}
    </Stack>
  );
}
