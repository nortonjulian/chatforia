import { useEffect, useState } from 'react';
import {
  Stack,
  Title,
  Text,
  Card,
  Group,
  Button,
  Alert,
  Progress,
  Loader,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useUser } from '../context/UserContext';
import { fetchWirelessStatus } from '../api/wireless';
import {
  createEsimCheckoutSession,
  createFamilyCheckoutSession,
} from '../api/billing';

function formatGb(mb) {
  if (!mb || mb <= 0) return '0 GB';
  return `${(mb / 1024).toFixed(1)} GB`;
}

export default function WirelessDashboard() {
  const { t } = useTranslation();
  const { currentUser } = useUser();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  useEffect(() => {
    if (!currentUser) {
      navigate('/login?next=/wireless');
      return;
    }

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchWirelessStatus();
        setStatus(data);
      } catch (e) {
        console.error('Failed to load wireless status', e);
        setError(t('family.error.load', 'Failed to load family details.'));
      } finally {
        setLoading(false);
      }
    })();
  }, [currentUser, navigate, t]);

  const handleBuyPack = async () => {
    try {
      setCheckoutLoading(true);
      setError(null);

      // If they have a family pool, default to a Family pack top-up (MEDIUM)
      if (status?.mode === 'FAMILY') {
        const { url } = await createFamilyCheckoutSession('MEDIUM');
        if (url) window.location.href = url;
        return;
      }

      // Otherwise, treat as individual eSIM pack (STARTER by default)
      const { url } = await createEsimCheckoutSession('STARTER');
      if (url) window.location.href = url;
    } catch (e) {
      console.error('Failed to start checkout for data pack', e);
      setError(
        t(
          'family.error.checkout',
          'We could not start checkout for a Family plan. Please try again.',
        ),
      );
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (loading) {
    return (
      <Stack maw={800} mx="auto" p="md" gap="sm">
        <Title order={2}>{t('family.title', 'Family')}</Title>
        <Group gap="xs">
          <Loader size="sm" />
          <Text c="dimmed">
            {t('family.loading', 'Loading your family details…')}
          </Text>
        </Group>
      </Stack>
    );
  }

  if (!status || status.mode === 'NONE') {
    return (
      <Stack maw={800} mx="auto" p="md" gap="lg">
        <Title order={2}>{t('family.title', 'Family')}</Title>

        {error && (
          <Alert color="red" variant="light" icon={<Info size={16} />}>
            {error}
          </Alert>
        )}

        <Card radius="xl" withBorder>
          <Stack gap="sm">
            <Title order={3}>
              {t('family.none.title', 'No family set up yet')}
            </Title>
            <Text c="dimmed" size="sm">
              {t(
                'family.none.body',
                'To create a Chatforia Family and shared data pool, start a Family plan.',
              )}
            </Text>
            <Group>
              <Button onClick={handleBuyPack} loading={checkoutLoading}>
                {t('wireless.buyPack', 'Buy data pack')}
              </Button>
            </Group>
          </Stack>
        </Card>
      </Stack>
    );
  }

  const src = status.source || {};
  const total = src.totalDataMb || 0;
  const remaining =
    src.remainingDataMb ?? src.remainingDataMb === 0
      ? src.remainingDataMb
      : total - (src.usedDataMb || 0);
  const pct = total > 0 ? Math.min(100, (remaining / total) * 100) : 0;

  const isLow = status.state === 'LOW';
  const isExhausted = status.state === 'EXHAUSTED' || status.exhausted;
  const isExpired = status.state === 'EXPIRED' || status.expired;

  return (
    <Stack maw={800} mx="auto" p="md" gap="lg">
      <Title order={2}>{t('family.title', 'Family')}</Title>

      {error && (
        <Alert color="red" variant="light" icon={<Info size={16} />}>
          {error}
        </Alert>
      )}

      <Card radius="xl" withBorder>
        <Stack gap="sm">
          <Group justify="space-between">
            <Stack gap={2}>
              <Title order={3}>
                {status.mode === 'FAMILY'
                  ? src.name ||
                    t('family.group.defaultName', 'My Chatforia Family')
                  : t('profile.esim.title', 'Chatforia eSIM (Teal)')}
              </Title>
              <Text size="sm" c="dimmed">
                {status.mode === 'FAMILY'
                  ? t('family.data.heading', 'Shared data pool')
                  : t(
                      'profile.esim.desc',
                      'Get mobile data for Chatforia when you’re away from Wi-Fi.',
                    )}
              </Text>
            </Stack>

            {status.mode === 'INDIVIDUAL' && (
              <Text size="sm" c="dimmed">
                {src.addonKind ||
                  t('wireless.esimPackLabel', 'eSIM pack')}
              </Text>
            )}
          </Group>

          <Stack gap={4} mt="sm">
            <Group justify="space-between">
              <Text size="sm" fw={500}>
                {t('family.data.heading', 'Shared data pool')}
              </Text>
              <Text size="sm">
                {formatGb(total)} / {formatGb(remaining)}
              </Text>
            </Group>
            <Progress value={pct} />
            <Text size="xs" c="dimmed">
              {t(
                'family.data.caption',
                'All members share this pool. We’ll warn you as you approach your limit.',
              )}
            </Text>
          </Stack>

          {(isLow || isExhausted || isExpired) && (
            <Alert
              color={isExhausted || isExpired ? 'red' : 'yellow'}
              variant="light"
              icon={<Info size={16} />}
            >
              {isExhausted || isExpired ? (
                <Text>
                  {t(
                    'wireless.exhausted',
                    'Your data has run out. Buy a new pack to continue using mobile data.',
                  )}
                </Text>
              ) : (
                <Text>
                  {t('wireless.dataLow', 'Your data is running low.')}
                </Text>
              )}

              {src.daysRemaining != null && (
                <Text size="xs" c="dimmed" mt={4}>
                  {t('wireless.expiresIn', 'Expires in {{days}} days', {
                    days: src.daysRemaining,
                  })}
                </Text>
              )}

              <Button
                mt="sm"
                size="xs"
                variant="light"
                onClick={handleBuyPack}
                loading={checkoutLoading}
              >
                {t('wireless.topUp', 'Top up now')}
              </Button>
            </Alert>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
