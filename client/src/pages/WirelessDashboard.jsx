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
  Badge,
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

  const subscriber = currentUser?.subscriber || null;
  const hasEsim = Boolean(
    subscriber?.iccid ||
      subscriber?.qrPayload ||
      subscriber?.activationCode ||
      subscriber?.status
  );

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
  }, [currentUser, navigate, t]);

  const goToPlans = () => navigate('/upgrade');
  const goToEsim = () => navigate('/account/esim');

  const isNone = !status || status.mode === 'NONE';
  const isFamily = status?.mode === 'FAMILY';

  const statusBadgeColor = !subscriber?.status
    ? 'gray'
    : subscriber.status === 'ACTIVE'
      ? 'green'
      : subscriber.status === 'PENDING' || subscriber.status === 'PROVISIONING'
        ? 'yellow'
        : subscriber.status === 'SUSPENDED'
          ? 'orange'
          : 'gray';

  const statusBadgeLabel = subscriber?.status
    ? t(
        `wireless.subscriberStatus.${String(subscriber.status).toLowerCase()}`,
        subscriber.status
      )
    : null;

  const esimCard = (
    <Card radius="xl" withBorder>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Title order={3}>
              {t('wireless.esim.title', 'Set up your eSIM')}
            </Title>
            <Text size="sm" c="dimmed">
              {hasEsim
                ? t(
                    'wireless.esim.readyBody',
                    'Your Chatforia eSIM is ready. Open it to install, re-scan your QR code, or review your activation details.'
                  )
                : t(
                    'wireless.esim.body',
                    'Install your Chatforia eSIM to enable mobile connectivity on your device.'
                  )}
            </Text>
          </Stack>

          {statusBadgeLabel && (
            <Badge color={statusBadgeColor} variant="light">
              {statusBadgeLabel}
            </Badge>
          )}
        </Group>

        {subscriber?.msisdn && (
          <Text size="sm">
            {t('wireless.phoneNumber', 'Phone number')}: {subscriber.msisdn}
          </Text>
        )}

        {subscriber?.iccid && (
          <Text size="xs" c="dimmed">
            ICCID: {subscriber.iccid}
          </Text>
        )}

        <Group mt="xs">
          <Button size="sm" onClick={goToEsim}>
            {hasEsim
              ? t('wireless.esim.openCta', 'Open eSIM setup')
              : t('wireless.esim.setupCta', 'Set up eSIM')}
          </Button>
        </Group>
      </Stack>
    </Card>
  );

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
          <Group justify="space-between" align="flex-start">
            <Stack gap={2}>
              <Title order={3}>
                {isFamily
                  ? src.name || t('family.group.defaultName', 'My Chatforia Family')
                  : t('wireless.plan.title', 'Your data plan')}
              </Title>
              <Text size="sm" c="dimmed">
                {isFamily
                  ? t(
                      'wireless.plan.familyBody',
                      'This shared pool powers Chatforia for your family members.'
                    )
                  : t(
                      'wireless.plan.bodyActive',
                      'Your mobile data plan keeps Chatforia working when you’re away from Wi-Fi.'
                    )}
              </Text>
            </Stack>

            <Text size="sm" c="dimmed">
              {isFamily
                ? t('wireless.plan.familyLabel', 'Shared plan')
                : src.addonKind || t('wireless.esimPackLabel', 'eSIM data pack')}
            </Text>
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
                    'All members share this pool. We’ll warn you as you approach your limit.'
                  )
                : t(
                    'wireless.data.caption',
                    'We’ll warn you as you approach your limit.'
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
                    'Your data has run out. Buy a new pack to continue using mobile data.'
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

              <Button mt="sm" size="xs" variant="light" onClick={goToPlans}>
                {t('wireless.topUp', 'Top up / change plan')}
              </Button>
            </Alert>
          )}

          {!isLow && !isExhausted && !isExpired && (
            <Group mt="xs">
              <Button size="xs" variant="light" onClick={goToPlans}>
                {t('wireless.plan.manageCta', 'Change plan / top up')}
              </Button>
            </Group>
          )}
        </Stack>
      </Card>
    );
  }

  const noneContent = (
    <Card radius="xl" withBorder>
      <Stack gap="sm">
        <Title order={3}>
          {t('wireless.plan.noneTitle', 'Get a data plan')}
        </Title>

        <Text c="dimmed" size="sm">
          {hasEsim
            ? t(
                'wireless.plan.noneBodyReady',
                'Your eSIM setup is ready. Choose a mobile data plan to start using Chatforia away from Wi-Fi.'
              )
            : t(
                'wireless.plan.noneBody',
                'Once your eSIM is installed, choose a data plan to use Chatforia on mobile.'
              )}
        </Text>

        <Group>
          <Button onClick={goToPlans}>
            {hasEsim
              ? t('wireless.viewPlans', 'View plans')
              : t('wireless.plan.setupFirstCta', 'View plans')}
          </Button>
        </Group>
      </Stack>
    </Card>
  );

  return (
    <Stack maw={800} mx="auto" p="md" gap="lg">
      <Stack gap={4}>
        <Title order={2}>
          {t('wireless.title', 'Chatforia Wireless')}
        </Title>
        <Text c="dimmed" size="sm">
          {t(
            'wireless.dashboardIntro',
            'Set up your eSIM, choose a data plan, and manage your mobile service.'
          )}
        </Text>
      </Stack>

      {loading && (
        <Group gap="xs">
          <Loader size="sm" />
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

      {esimCard}

      {isNone ? noneContent : planContent}
    </Stack>
  );
}