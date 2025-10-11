import { useState } from 'react';
import { Card, Title, Text, Button, Group, Stack, Badge } from '@mantine/core';
import axiosClient from '../api/axiosClient';
import { useUser } from '../context/UserContext';
// import { toast } from '../utils/toast';

function PlanCard({
  title,
  price,
  features = [],
  cta,
  onClick,
  highlight = false,
  disabled = false,
  loading = false,
}) {
  return (
    <Card withBorder radius="xl" shadow={highlight ? 'md' : 'sm'} p="lg">
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Title order={3}>{title}</Title>
          {highlight && <Badge color="yellow">Popular</Badge>}
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

export default function UpgradePage() {
  const { currentUser } = useUser();
  const [loadingCheckout, setLoadingCheckout] = useState(false);
  const [loadingPortal, setLoadingPortal] = useState(false);

  const isPremium = (currentUser?.plan || '').toUpperCase() !== 'FREE';

  const startCheckout = async (plan = 'PREMIUM_MONTHLY') => {
    try {
      setLoadingCheckout(true);
      const { data } = await axiosClient.post('/billing/checkout', { plan });
      const url = data?.checkoutUrl || data?.url;
      if (url) {
        toast.info('Redirecting to secure checkout…');
        window.location.href = url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (e) {
      console.error('Checkout error', e);
      // Common causes: missing Stripe envs, network error, 4xx from server
      const msg =
        e?.response?.data?.message ||
        e?.message ||
        'Could not start checkout. Try again.';
      toast.err(msg);
    } finally {
      setLoadingCheckout(false);
    }
  };

  const openBillingPortal = async () => {
    try {
      setLoadingPortal(true);
      const { data } = await axiosClient.post('/billing/portal', {});
      const url = data?.portalUrl || data?.url;
      if (url) {
        toast.info('Opening billing portal…');
        window.location.href = url;
      } else {
        throw new Error('No billing portal URL returned');
      }
    } catch (e) {
      console.error('Portal error', e);
      const msg =
        e?.response?.data?.message ||
        e?.message ||
        'Could not open billing portal. Try again.';
      toast.err(msg);
    } finally {
      setLoadingPortal(false);
    }
  };

  return (
    <Stack gap="lg" maw={900} mx="auto" p="md">
      <Title order={2}>Upgrade</Title>
      <Text c="dimmed">
        Unlock premium features like advanced AI, custom ringtones, backups, and more.
      </Text>

      <Group grow align="stretch">
        <PlanCard
          title="Free"
          price="$0"
          features={[
            '1:1 and group messaging',
            'Basic AI replies',
            'Standard attachments',
          ]}
          cta={isPremium ? 'Switch to Free (not available)' : 'Current Plan'}
          onClick={() => {
            if (!isPremium) return;
            toast.info('Downgrading to Free from here is not available yet.');
          }}
          disabled={!isPremium}
        />

        <PlanCard
          title="Premium"
          price="$24.99 / mo"
          features={[
            'All Free features',
            'Custom ringtones & message tones',
            'AI power features',
            'Priority updates',
            'Backups & device syncing',
          ]}
          highlight
          cta={
            isPremium
              ? (loadingPortal ? 'Opening…' : 'Manage Billing')
              : (loadingCheckout ? 'Redirecting…' : 'Upgrade')
          }
          onClick={() =>
            isPremium ? openBillingPortal() : startCheckout('PREMIUM_MONTHLY')
          }
          loading={isPremium ? loadingPortal : loadingCheckout}
        />
      </Group>
    </Stack>
  );
}
