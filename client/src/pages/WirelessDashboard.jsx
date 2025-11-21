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

import { useUser } from '@/context/UserContext';
import { fetchWirelessStatus } from '@/api/wireless';

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
        setError(
          t(
            'wireless.error.load',
            'Failed to load wireless details. Please try again.',
          ),
        );
      } finally {
        setLoading(false);
      }
    })();
    // IMPORTANT: don't depend on `t`, because the test's mock
    // returns a new function every render and would cause re-fetch loops.
  }, [currentUser, navigate]);

  // Central: always go to the Upgrade / plans page
  const goToPlans = () => {
    // later you can do /upgrade?tab=wireless if you add a wireless tab
    navigate('/upgrade');
  };

  const isNone = !status || status.mode === 'NONE';
  const isFamily = status?.mode === 'FAMILY';

  // When we *do* have a plan status, compute data stats
  let planContent = null;

  if (!isNone && status) {
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

    planContent = (
      <Card radius="xl" withBorder>
        <Stack gap="sm">
          <Group justify="space-between">
            <Stack gap={2}>
              <Title order={3}>
                {isFamily
                  ? src.name ||
                    t('family.group.defaultName', 'My Chatforia Family')
                  : t('profile.esim.title', 'Chatforia eSIM (Teal)')}
              </Title>
              <Text size="sm" c="dimmed">
                {isFamily
                  ? t('wireless.data.familyHeading', 'Shared data pool')
                  : t(
                      'profile.esim.desc',
                      'Get mobile data for Chatforia when you’re away from Wi-Fi.',
                    )}
              </Text>
            </Stack>

            {!isFamily && (
              <Text size="sm" c="dimmed">
                {src.addonKind ||
                  t('wireless.esimPackLabel', 'eSIM data pack')}
              </Text>
            )}
          </Group>

          <Stack gap={4} mt="sm">
            <Group justify="space-between">
              <Text size="sm" fw={500}>
                {isFamily
                  ? t('wireless.data.familyLabel', 'Family data pool')
                  : t('wireless.data.yourData', 'Your data')}
              </Text>
              <Text size="sm">
                {formatGb(total)} / {formatGb(remaining)}
              </Text>
            </Group>
            <Progress value={pct} />
            <Text size="xs" c="dimmed">
              {isFamily
                ? t(
                    'wireless.data.familyCaption',
                    'All members share this pool. We’ll warn you as you approach your limit.',
                  )
                : t(
                    'wireless.data.caption',
                    'We’ll warn you as you approach your limit.',
                  )}
            </Text>
          </Stack>

          {(status.state === 'LOW' ||
            status.state === 'EXHAUSTED' ||
            status.state === 'EXPIRED' ||
            status.exhausted ||
            status.expired) && (
            <Alert
              color={
                status.state === 'EXHAUSTED' ||
                status.state === 'EXPIRED' ||
                status.exhausted ||
                status.expired
                  ? 'red'
                  : 'yellow'
              }
              variant="light"
              icon={<Info size={16} />}
            >
              {status.state === 'EXHAUSTED' ||
              status.state === 'EXPIRED' ||
              status.exhausted ||
              status.expired ? (
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
                  {t(
                    'wireless.expiresIn',
                    'Expires in {{days}} days',
                    // our i18n mock in tests returns the default string
                    { days: src.daysRemaining },
                  )}
                </Text>
              )}

              <Button
                mt="sm"
                size="xs"
                variant="light"
                onClick={goToPlans}
              >
                {t('wireless.topUp', 'Top up / change plan')}
              </Button>
            </Alert>
          )}
        </Stack>
      </Card>
    );
  }

  // NONE / no-status content
  const noneContent = (
    <Card radius="xl" withBorder data-testid="card">
      <Stack gap="sm">
        <Title order={3}>
          {t('wireless.none.title', 'No wireless plan yet')}
        </Title>
        <Text c="dimmed" size="sm">
          {t(
            'wireless.none.body',
            'You can buy mobile data to use Chatforia away from Wi-Fi, either just for you or for a Family group.',
          )}
        </Text>
        <Group>
          <Button onClick={goToPlans}>
            {t('wireless.viewPlans', 'View plans')}
          </Button>
        </Group>
      </Stack>
    </Card>
  );

  return (
    <Stack maw={800} mx="auto" p="md" gap="lg">
      <Title order={2}>{t('wireless.title', 'Wireless')}</Title>

      {loading && (
        <Group gap="xs">
          <Loader size="sm" data-testid="loader" />
          <Text c="dimmed">
            {t('wireless.loading', 'Loading your wireless details…')}
          </Text>
        </Group>
      )}

      {error && (
        <Alert color="red" variant="light" icon={<Info size={16} />}>
          {error}
        </Alert>
      )}

      {isNone ? noneContent : planContent}
    </Stack>
  );
}
