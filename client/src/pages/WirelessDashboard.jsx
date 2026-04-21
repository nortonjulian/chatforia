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

  const subscriber = currentUser?.subscriber;

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

  // ------------------------
  // 🔥 NEW: eSIM CARD
  // ------------------------
  const esimCard = (
    <Card radius="xl" withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <Title order={4}>
            {t('wireless.esim.title', 'Your eSIM')}
          </Title>

          {subscriber?.status && (
            <Badge
              color={
                subscriber.status === 'ACTIVE'
                  ? 'green'
                  : subscriber.status === 'PENDING'
                  ? 'yellow'
                  : 'gray'
              }
            >
              {subscriber.status}
            </Badge>
          )}
        </Group>

        {subscriber ? (
          <>
            {subscriber.msisdn && (
              <Text size="sm">
                {t('wireless.phoneNumber', 'Phone number')}: {subscriber.msisdn}
              </Text>
            )}

            {subscriber.iccid && (
              <Text size="xs" c="dimmed">
                ICCID: {subscriber.iccid}
              </Text>
            )}

            <Group mt="xs">
              <Button size="sm" onClick={goToEsim}>
                {t('wireless.viewQr', 'View QR / Install eSIM')}
              </Button>
            </Group>
          </>
        ) : (
          <>
            <Text size="sm" c="dimmed">
              {t(
                'wireless.noEsim',
                'You don’t have an eSIM yet. Set one up to use mobile data.',
              )}
            </Text>

            <Group mt="xs">
              <Button size="sm" onClick={goToEsim}>
                {t('wireless.setupEsim', 'Set up eSIM')}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Card>
  );

  // ------------------------
  // Existing Plan UI
  // ------------------------
  let planContent = null;

  if (!isNone && status) {
    const src = status.source || {};
    const total = src.totalDataMb || 0;
    const remaining =
      src.remainingDataMb ?? src.remainingDataMb === 0
        ? src.remainingDataMb
        : total - (src.usedDataMb || 0);
    const pct = total > 0 ? Math.min(100, (remaining / total) * 100) : 0;

    planContent = (
      <Card radius="xl" withBorder>
        <Stack gap="sm">
          <Group justify="space-between">
            <Title order={3}>
              {isFamily
                ? src.name || 'My Chatforia Family'
                : 'Chatforia eSIM'}
            </Title>

            {!isFamily && (
              <Text size="sm" c="dimmed">
                {src.addonKind || 'eSIM data pack'}
              </Text>
            )}
          </Group>

          <Group justify="space-between">
            <Text size="sm" fw={500}>
              {isFamily ? 'Family data pool' : 'Your data'}
            </Text>
            <Text size="sm">
              {formatGb(total)} / {formatGb(remaining)}
            </Text>
          </Group>

          <Progress value={pct} />

          <Button mt="sm" size="xs" variant="light" onClick={goToPlans}>
            Top up / change plan
          </Button>
        </Stack>
      </Card>
    );
  }

  const noneContent = (
    <Card radius="xl" withBorder>
      <Stack gap="sm">
        <Title order={3}>No wireless plan yet</Title>
        <Text c="dimmed" size="sm">
          Buy mobile data to use Chatforia away from Wi-Fi.
        </Text>
        <Button onClick={goToPlans}>View plans</Button>
      </Stack>
    </Card>
  );

  return (
    <Stack maw={800} mx="auto" p="md" gap="lg">
      <Title order={2}>{t('wireless.title', 'Wireless')}</Title>

      {loading && (
        <Group gap="xs">
          <Loader size="sm" />
          <Text c="dimmed">Loading your wireless details…</Text>
        </Group>
      )}

      {error && (
        <Alert color="red" variant="light" icon={<Info size={16} />}>
          {error}
        </Alert>
      )}

      {/* 🔥 NEW: eSIM section */}
      {esimCard}

      {/* Existing plan UI */}
      {isNone ? noneContent : planContent}
    </Stack>
  );
}