import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Container,
  Title,
  Text,
  Paper,
  Group,
  Badge,
  Button,
  Stack,
  Loader,
} from '@mantine/core';
import { Link } from 'react-router-dom';
import axiosClient from '../api/axiosClient';

export default function MyPlan() {
  const { t } = useTranslation();
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [loadingPortal, setLoadingPortal] = useState(false);
  const [loadingCancelNow, setLoadingCancelNow] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchPlan() {
      try {
        setLoading(true);
        setError('');
        const res = await fetch('/api/billing/my-plan', {
          credentials: 'include',
        });

        if (!res.ok) {
          throw new Error(`Request failed with ${res.status}`);
        }

        const data = await res.json();
        if (!cancelled) {
          setPlan(data.plan);
        }
      } catch (err) {
        if (!cancelled) {
          setError(t('billing.myPlanError', 'Unable to load your plan.'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchPlan();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const openBillingPortal = async () => {
    try {
      setError('');
      setLoadingPortal(true);
      const { data } = await axiosClient.post('/billing/portal', {});
      const url = data?.portalUrl || data?.url;
      if (url) {
        window.location.href = url;
      } else {
        setError(
          t(
            'billing.portalError',
            'Unable to open the billing portal right now.'
          )
        );
      }
    } catch (err) {
      console.error('Billing portal error', err);
      setError(
        t(
          'billing.portalError',
          'Unable to open the billing portal right now.'
        )
      );
    } finally {
      setLoadingPortal(false);
    }
  };

  const cancelNow = async () => {
    if (!plan || plan.isFree) return;

    const confirmed = window.confirm(
      t(
        'billing.cancelNowConfirm',
        'Are you sure you want to cancel your plan immediately? This cannot be undone.'
      )
    );
    if (!confirmed) return;

    try {
      setError('');
      setLoadingCancelNow(true);
      await axiosClient.post('/billing/cancel-now', {});
      // Reload to reflect new plan status (will come back as Free)
      window.location.reload();
    } catch (err) {
      console.error('Immediate cancel failed', err);
      setError(
        t(
          'billing.cancelNowError',
          'Unable to cancel your plan right now. Please try again or use Manage billing.'
        )
      );
    } finally {
      setLoadingCancelNow(false);
    }
  };

  const hasPaidPlan = !!plan && !plan.isFree;

  return (
    <Container size="sm" py="xl">
      <Stack gap="md">
        <Title order={2}>{t('billing.myPlanTitle', 'My plan')}</Title>

        {loading && (
          <Group>
            <Loader size="sm" />
            <Text size="sm">
              {t('billing.myPlanLoading', 'Loading your plan…')}
            </Text>
          </Group>
        )}

        {error && !loading && (
          <Text c="red" size="sm">
            {error}
          </Text>
        )}

        {!loading && plan && (
          <Paper withBorder radius="lg" p="lg">
            <Group justify="space-between" align="flex-start">
              <div>
                <Text size="sm" c="dimmed">
                  {t('billing.currentPlan', 'Current plan')}
                </Text>

                <Group gap="xs" mt={4}>
                  <Title order={3}>{plan.label}</Title>
                  {!plan.isFree && plan.status && (
                    <Badge variant="light" radius="xl">
                      {plan.status}
                    </Badge>
                  )}
                </Group>

                {!plan.isFree && plan.amountFormatted && plan.currency && (
                  <Text mt="xs" size="sm">
                    {plan.amountFormatted}{' '}
                    {plan.currency?.toUpperCase()}/
                    {plan.interval ?? 'month'}
                  </Text>
                )}

                {plan.renewsAt && (
                  <Text mt="xs" size="sm" c="dimmed">
                    {t('billing.renewsAt', 'Renews on')}{' '}
                    {new Date(plan.renewsAt).toLocaleDateString()}
                  </Text>
                )}

                {plan.isFree && (
                  <Text mt="xs" size="sm" c="dimmed">
                    {t(
                      'billing.freePlanCopy',
                      'You’re on the free plan. Upgrade to unlock more features.'
                    )}
                  </Text>
                )}

                {hasPaidPlan && (
                  <Text mt="xs" size="xs" c="dimmed">
                    {t(
                      'billing.cancelNowHelp',
                      'You can manage or cancel your subscription in the billing portal, or cancel immediately below.'
                    )}
                  </Text>
                )}
              </div>

              <Stack gap="xs" align="flex-end">
                <Button
                  component={Link}
                  to="/upgrade"
                  variant={plan.isFree ? 'filled' : 'outline'}
                  radius="xl"
                >
                  {plan.isFree
                    ? t('billing.upgradeCta', 'Upgrade plan')
                    : t('billing.changePlanCta', 'Change plan')}
                </Button>

                {hasPaidPlan && (
                  <>
                    <Button
                      variant="subtle"
                      radius="xl"
                      onClick={openBillingPortal}
                      loading={loadingPortal}
                      aria-busy={loadingPortal ? 'true' : 'false'}
                    >
                      {t('billing.manageBilling', 'Manage billing')}
                    </Button>

                    <Button
                      variant="outline"
                      color="red"
                      radius="xl"
                      onClick={cancelNow}
                      loading={loadingCancelNow}
                      aria-busy={loadingCancelNow ? 'true' : 'false'}
                    >
                      {t('billing.cancelNow', 'Cancel now')}
                    </Button>
                  </>
                )}
              </Stack>
            </Group>
          </Paper>
        )}
      </Stack>
    </Container>
  );
}
