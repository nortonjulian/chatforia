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
import posthog from '@/utils/analytics';

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
        const { data } = await axiosClient.get('/billing/my-plan');

        if (!cancelled) {
          setPlan(data.plan);

          posthog.capture('my_plan_viewed', {
            plan: data?.plan?.label || 'FREE',
          });
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
        posthog.capture('billing_portal_opened', {
          source: 'my_plan',
        });

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

    posthog.capture('subscription_cancel_initiated', {
      plan: plan?.label,
    });

    try {
      setError('');
      setLoadingCancelNow(true);

      await axiosClient.post('/billing/cancel-now', {});

      posthog.capture('subscription_cancel_completed', {
        plan: plan?.label,
      });

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
    <Container size="md" py="xl">
      <Stack gap="lg" maw={720}>
        <Title order={2}>{t('billing.myPlanTitle', 'My plan')}</Title>

        {loading && (
          <Group>
            <Loader size="sm" />
            <Text size="sm">{t('billing.myPlanLoading', 'Loading your plan…')}</Text>
          </Group>
        )}

        {error && !loading && (
          <Text c="red" size="sm">{error}</Text>
        )}

        {!loading && plan && (
          <Paper withBorder radius="xl" p="xl" shadow="sm">
            <Stack gap="md">
              <Group justify="space-between" align="flex-start">
                <div>
                  <Text size="xs" fw={700} tt="uppercase" c="dimmed">
                    {t('billing.currentPlan', 'Current plan')}
                  </Text>

                  <Group gap="sm" mt={6}>
                    <Title order={3}>{plan.label}</Title>
                    {!plan.isFree && plan.status && (
                      <Badge variant="light" radius="xl">
                        {plan.status}
                      </Badge>
                    )}
                  </Group>

                  {!plan.isFree && (
                    <Text mt={6} size="sm" c="dimmed">
                      {plan.renewsAt
                        ? `${t(
                            plan.autoRenewEnabled === false
                              ? 'billing.activeThrough'
                              : 'billing.renewsAt',
                            plan.autoRenewEnabled === false
                              ? 'Active through'
                              : 'Renews on'
                          )} ${new Date(plan.renewsAt).toLocaleDateString()}`
                        : t('billing.activeSubscription', 'Your subscription is active.')}
                    </Text>
                  )}

                  {plan.isFree && (
                    <Text mt={6} size="sm" c="dimmed">
                      {t(
                        'billing.freePlanCopy',
                        'You’re on the free plan. Upgrade to unlock more features.'
                      )}
                    </Text>
                  )}
                </div>
              </Group>

              <Group gap="sm" mt="sm">
                {hasPaidPlan ? (
                  <>
                    <Button onClick={openBillingPortal} loading={loadingPortal}>
                      {t('billing.manageBilling', 'Manage billing')}
                    </Button>

                    <Button
                      component={Link}
                      to="/upgrade"
                      variant="outline"
                    >
                      {t('billing.changePlanCta', 'Change plan')}
                    </Button>

                    <Button
                      variant="light"
                      onClick={cancelNow}
                      loading={loadingCancelNow}
                    >
                      {t('billing.cancelNow', 'Cancel now')}
                    </Button>
                  </>
                ) : (
                  <Button component={Link} to="/upgrade">
                    {t('billing.upgradeCta', 'Upgrade plan')}
                  </Button>
                )}
              </Group>
            </Stack>
          </Paper>
        )}
      </Stack>
    </Container>
  );
}
