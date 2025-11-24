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

export default function MyPlan() {
  const { t } = useTranslation();
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function fetchPlan() {
      try {
        setLoading(true);
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
                  {!plan.isFree && (
                    <Badge variant="light" radius="xl">
                      {plan.status}
                    </Badge>
                  )}
                </Group>

                {!plan.isFree && (
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
              </div>

              <Stack gap="xs">
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

                {/* if you already have a billing-portal route, link to it here */}
                <Button
                  component={Link}
                  to="/billing-portal"
                  variant="subtle"
                  radius="xl"
                >
                  {t('billing.manageBilling', 'Manage billing')}
                </Button>
              </Stack>
            </Group>
          </Paper>
        )}
      </Stack>
    </Container>
  );
}
