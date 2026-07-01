import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Card,
  Stack,
  Text,
  Group,
  Badge,
  Loader,
  Alert,
  ThemeIcon,
  Button,
} from '@mantine/core';
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Voicemail,
  Video,
} from 'lucide-react';
import { getCallHistoryPage } from '@/api/calls';
import { useUser } from '@/context/UserContext';
import { useTranslation } from 'react-i18next';

function formatTimestamp(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

function formatDuration(durationSec) {
  if (!durationSec || durationSec <= 0) return null;

  const hours = Math.floor(durationSec / 3600);
  const minutes = Math.floor((durationSec % 3600) / 60);
  const seconds = durationSec % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function statusLabel(status, isOutgoing, t) {
  switch (String(status || '').toUpperCase()) {
    case 'MISSED':
      return t('callHistory.missed', 'Missed');
    case 'DECLINED':
      return t('callHistory.declined', 'Declined');
    case 'FAILED':
      return t('callHistory.failed', 'Failed');
    case 'ENDED':
      return t('callHistory.completed', 'Completed');
    default:
      return isOutgoing
        ? t('callHistory.outgoing', 'Outgoing')
        : t('callHistory.incoming', 'Incoming');
  }
}

function statusIcon(item, isOutgoing) {
  const status = String(item?.status || '').toUpperCase();
  const mode = String(item?.mode || '').toUpperCase();

  if (mode === 'VIDEO') return Video;
  if (status === 'MISSED') return PhoneMissed;

  return isOutgoing ? PhoneOutgoing : PhoneIncoming;
}

const CALL_HISTORY_PAGE_SIZE = 50;

export default function CallHistory() {
  const { t } = useTranslation();
  const { currentUser } = useUser();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setError('');

        const data = await getCallHistoryPage({
          limit: CALL_HISTORY_PAGE_SIZE,
        });

        if (!alive) return;

        setItems(data.items);
        setNextCursor(data.nextCursor);
      } catch (err) {
        if (!alive) return;

        setError(
          err?.response?.data?.error ||
            err?.message ||
            t('callHistory.loadFailed', 'Could not load call history.')
        );
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [t]);

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;

    try {
      setLoadingMore(true);
      setError('');

      const data = await getCallHistoryPage({
        limit: CALL_HISTORY_PAGE_SIZE,
        cursor: nextCursor,
      });

      setItems((prev) => [...prev, ...data.items]);
      setNextCursor(data.nextCursor);
    } catch (err) {
      setError(
        err?.response?.data?.error ||
          err?.message ||
          t('callHistory.loadFailed', 'Could not load call history.')
      );
    } finally {
      setLoadingMore(false);
    }
  };

  const content = useMemo(() => {
    if (loading) {
      return (
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      );
    }

    if (error) {
      return (
        <Alert color="red" title={t('callHistory.loadFailedTitle', 'Couldn’t load call history')}>
          {error}
        </Alert>
      );
    }

    if (!items.length) {
      return (
        <Card withBorder radius="lg" p="lg">
          <Stack align="center" gap="xs">
            <ThemeIcon size={42} radius="xl" variant="light" color="yellow">
              <Phone size={20} />
            </ThemeIcon>
            <Text fw={600}>
              {t('callHistory.emptyTitle', 'No calls yet')}
            </Text>
            <Text size="sm" c="dimmed">
              {t('callHistory.emptySubtitle', 'Your recent calls will show up here.')}
            </Text>
          </Stack>
        </Card>
      );
    }

    return (
      <Stack gap="sm">
        {items.map((item) => {
          const isOutgoing = Number(item.callerId) === Number(currentUser?.id);
          const otherParty = isOutgoing ? item.callee : item.caller;

          const otherPartyName =
            item.displayName ||
            item.otherDisplayName ||
            item.otherUsername ||
            otherParty?.displayName ||
            otherParty?.username ||
            item.phoneNumber ||
            (isOutgoing
              ? t('callHistory.outgoingCall', 'Outgoing Call')
              : t('callHistory.incomingCall', 'Incoming Call'));

          const isVideoCall = String(item.mode || '').toUpperCase() === 'VIDEO';
          const callTypeLabel = isVideoCall
            ? t('callHistory.video', 'Video')
            : t('callHistory.audio', 'Audio');

          const Icon = statusIcon(item, isOutgoing);

          const directionLabel = isOutgoing
            ? t('callHistory.outgoing', 'Outgoing')
            : t('callHistory.incoming', 'Incoming');

          const label = statusLabel(item.status, isOutgoing, t);
          const showStatusLabel = label && label !== directionLabel;

          const duration = formatDuration(item.durationSec);
          const timestamp = formatTimestamp(item.endedAt || item.startedAt || item.createdAt);

          return (
            <Card key={item.id} withBorder radius="lg" p="md">
              <Group align="flex-start" wrap="nowrap">
                <ThemeIcon radius="xl" size={40} variant="light" color="yellow">
                  <Icon size={18} />
                </ThemeIcon>

                <Box style={{ flex: 1 }}>
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Box>
                      <Text fw={600}>{otherPartyName}</Text>
                      <Group gap={8} mt={4}>
                      <Text size="sm" c="dimmed">
                        {callTypeLabel}
                      </Text>

                      <Text size="sm" c="dimmed">•</Text>

                      <Text size="sm" c="dimmed">
                        {directionLabel}
                      </Text>

                        {showStatusLabel ? (
                          <>
                            <Text size="sm" c="dimmed">•</Text>
                            <Text size="sm" c="dimmed">{label}</Text>
                          </>
                        ) : null}
                        {duration ? (
                          <>
                            <Text size="sm" c="dimmed">•</Text>
                            <Text size="sm" c="dimmed">{duration}</Text>
                          </>
                        ) : null}
                      </Group>
                    </Box>

                    <Stack gap={6} align="flex-end">
                      {!!timestamp && (
                        <Text size="xs" c="dimmed">
                          {timestamp}
                        </Text>
                      )}
                      {item.hasVoicemail ? (
                        <Badge leftSection={<Voicemail size={12} />} color="grape" variant="light">
                          {t('callHistory.voicemail', 'Voicemail')}
                        </Badge>
                      ) : null}
                    </Stack>
                  </Group>
                </Box>
              </Group>
            </Card>
          );
        })}
      </Stack>
    );
  }, [items, loading, error, currentUser?.id, t]);

  return (
    <Box
      p="md"
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        paddingBottom: 120,
      }}
    >
      <Stack gap="md">
        <Text fw={700} size="xl">
         {t('callHistory.title', 'Calls')}
        </Text>
        <Text size="sm" c="dimmed">
          {t('callHistory.subtitle', 'Your recent incoming and outgoing calls.')}
        </Text>
        {content}

        {!loading && !error && nextCursor ? (
          <Group justify="center">
            <Button variant="light" loading={loadingMore} onClick={handleLoadMore}>
              {t('callHistory.loadMore', 'Load more')}
            </Button>
          </Group>
        ) : null}
      </Stack>
    </Box>
  );
}