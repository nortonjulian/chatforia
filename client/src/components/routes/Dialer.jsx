import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box,
  Group,
  Button,
  TextInput,
  Stack,
  Text,
  Divider,
  Loader,
  Card,
  ThemeIcon,
  Badge,
  ActionIcon,
} from '@mantine/core';
import {
  PhoneOutgoing,
  PhoneIncoming,
  PhoneMissed,
  Voicemail,
  Phone,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import axiosClient from '@/api/axiosClient';
import { getCallHistory } from '@/api/calls';
import { useUser } from '@/context/UserContext';
import { usePstnCall } from '@/hooks/usePstnCall';
import { useTwilioVoice } from '@/hooks/useTwilioVoice';

// keep digits and a leading +
function normalizePhone(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.replace(/[^\d+]/g, '');
}

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

function statusIcon(status, isOutgoing) {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'MISSED') return PhoneMissed;
  return isOutgoing ? PhoneOutgoing : PhoneIncoming;
}

function statusColor(status) {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'MISSED' || normalized === 'DECLINED' || normalized === 'FAILED') {
    return 'red';
  }
  return 'yellow';
}

function formatCallError(e) {
  const status = e?.response?.status;
  const message = e?.response?.data?.message || e?.response?.data?.error;

  if (status === 412 && message === 'No Chatforia number assigned') {
    return 'You need a Chatforia number before placing phone calls.';
  }

  return message || e?.message || 'Could not place call.';
}

export default function Dialer() {
  const { t } = useTranslation();
  const { currentUser } = useUser();
  const [params] = useSearchParams();

  const qpTo = params.get('to');
  const qpUserId = params.get('userId');

  const [digits, setDigits] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState('');

  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');

  const { placeCall, loading: pstnLoading, error: pstnError } = usePstnCall();

  const {
    startBrowserCall,
    ready: voiceReady,
    calling: browserCalling,
    error: voiceError,
  } = useTwilioVoice();

  useEffect(() => {
    let mounted = true;

    async function loadHistory() {
      try {
        setHistoryLoading(true);
        setHistoryError('');

        const items = await getCallHistory({ limit: 25 });
        if (!mounted) return;

        const sorted = [...items].sort((a, b) => {
          const aTime = new Date(a.endedAt || a.startedAt || a.createdAt).getTime();
          const bTime = new Date(b.endedAt || b.startedAt || b.createdAt).getTime();
          return bTime - aTime;
        });

        setHistory(sorted);
      } catch (e) {
        if (!mounted) return;
        setHistoryError(
          e?.response?.data?.error || e?.message || 'Could not load recent calls.'
        );
      } finally {
        if (mounted) setHistoryLoading(false);
      }
    }

    loadHistory();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function run() {
      setResolveError('');

      if (qpTo) {
        const next = normalizePhone(qpTo);
        if (mounted) setDigits(next);
        return;
      }

      if (qpUserId) {
        const userId = String(qpUserId || '').trim();
        if (!userId) return;

        setResolving(true);
        try {
          const { data } = await axiosClient.get(
            `/users/${encodeURIComponent(userId)}/call-target`
          );

          const to = normalizePhone(data?.to || '');
          if (!to) {
            throw new Error(
              data?.error || 'No callable target for this user (missing phone number).'
            );
          }

          if (mounted) setDigits(to);
        } catch (e) {
          console.error('Dialer: failed to resolve call target', e);
          if (mounted) {
            setResolveError(
              e?.response?.data?.error ||
                e?.message ||
                t('dialer.resolveFailed', 'Could not resolve call target.')
            );
          }
        } finally {
          if (mounted) setResolving(false);
        }
      }
    }

    run();
    return () => {
      mounted = false;
    };
  }, [qpTo, qpUserId, t]);

  const press = (d) => setDigits((s) => (s + d).slice(0, 32));
  const backspace = () => setDigits((s) => s.slice(0, -1));

  const toNumber = useMemo(() => digits.trim(), [digits]);
  const disabledNumber = !toNumber;

  const handlePstnCall = async () => {
  if (!toNumber) return;

  try {
    await placeCall(toNumber);
  } catch (e) {
    setResolveError(formatCallError(e));
  }
};

  const handleBrowserCall = async () => {
    if (!toNumber || !voiceReady) return;
    await startBrowserCall(toNumber);
  };

  const handleRedial = async (item) => {
    const phone = normalizePhone(item.externalPhone || '');
    if (!phone) return;

    setDigits(phone);

    try {
      await placeCall(phone);
    } catch (e) {
      setResolveError(formatCallError(e));
    }
  };

  const handleDelete = async (callId) => {
    if (
      !window.confirm(
        t('dialer.deleteConfirm', 'Delete this call from recents?')
      )
    )
      return;

    try {
      await axiosClient.delete(`/calls/${callId}`);
      setHistory((prev) => prev.filter((item) => item.id !== callId));
    } catch (e) {
      console.error(t('dialer.deleteFailedLog', 'Failed to delete call'), e);
      setHistoryError(
        e?.response?.data?.error ||
          e?.message ||
          t('dialer.deleteFailed', 'Could not delete call.')
      );
    }
  };

  const anyError = resolveError || pstnError || voiceError;

  return (
    <Box p="md">
      <Text fw={700} mb="xs">
        {t('dialer.title', 'Calls')}
      </Text>

      <Text c="dimmed" size="sm" mb="md">
        {t(
          'dialer.subtitle',
          'Keypad & recents. (If you don’t use PSTN, start calls from a conversation header.)'
        )}
      </Text>

      <TextInput
        value={digits}
        onChange={(e) => setDigits(e.currentTarget.value)}
        placeholder={t('dialer.enterNumber', 'Enter number')}
        size="lg"
        mb="xs"
        aria-label={t('dialer.enterNumberAria', 'Enter number')}
        disabled={resolving}
      />

      {(resolving || anyError) && (
        <Text c={anyError ? 'red' : 'dimmed'} size="xs" mb="sm">
          {resolving ? t('dialer.resolving', 'Resolving call target…') : anyError}
        </Text>
      )}

      <Stack gap={6} w={260}>
        {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['*', '0', '#']].map(
          (row, i) => (
            <Group key={i} gap={6}>
              {row.map((d) => (
                <Button
                  key={d}
                  variant="light"
                  onClick={() => press(d)}
                  style={{ width: 80 }}
                  disabled={resolving}
                >
                  {d}
                </Button>
              ))}
            </Group>
          )
        )}

        <Group gap={6}>
          <Button
            color="green"
            onClick={handlePstnCall}
            style={{ flex: 1 }}
            loading={pstnLoading}
            disabled={disabledNumber || pstnLoading || resolving}
          >
            {t('dialer.call', 'Call')}
          </Button>
          <Button
            variant="default"
            onClick={backspace}
            title={t('dialer.backspace', 'Backspace')}
            disabled={resolving}
          >
            ⌫
          </Button>
        </Group>

        <Button
          variant="outline"
          onClick={handleBrowserCall}
          disabled={disabledNumber || !voiceReady || browserCalling || resolving}
        >
          {t('dialer.callBrowser', 'Call via browser')}
        </Button>
      </Stack>

      <Divider my="lg" />

      <Text fw={600} mb={6}>
        {t('dialer.recents', 'Recents')}
      </Text>

      {historyLoading ? (
        <Group justify="center" py="md">
          <Loader size="sm" />
        </Group>
      ) : historyError ? (
        <Text c="red" size="sm">{historyError}</Text>
      ) : history.length === 0 ? (
        <Text c="dimmed" size="sm">
          {t('dialer.noRecents', 'No recent calls yet.')}
        </Text>
      ) : (
        <Stack gap="sm">
          {history.map((item) => {
            const isOutgoing = item.callerId === currentUser?.id;
            const otherParty = isOutgoing ? item.callee : item.caller;
            const otherPartyName =
              otherParty?.displayName ||
              otherParty?.username ||
              item.externalPhone ||
              (isOutgoing ? 'Outgoing Call' : 'Incoming Call');

            const Icon = statusIcon(item.status, isOutgoing);

            const directionLabel = isOutgoing
              ? t('callHistory.outgoing', 'Outgoing')
              : t('callHistory.incoming', 'Incoming');

            const label = statusLabel(item.status, isOutgoing, t);
            const showStatusLabel = label && label !== directionLabel;

            const duration = formatDuration(item.durationSec);
            const timestamp = formatTimestamp(item.endedAt || item.startedAt || item.createdAt);
            const color = statusColor(item.status);
            const canRedial = Boolean(normalizePhone(item.externalPhone || ''));

            return (
              <Card key={item.id} withBorder radius="lg" p="md">
                <Group align="flex-start" wrap="nowrap">
                  <ThemeIcon radius="xl" size={40} variant="light" color={color}>
                    <Icon size={18} />
                  </ThemeIcon>

                  <Box style={{ flex: 1 }}>
                    <Group justify="space-between" align="flex-start" wrap="nowrap">
                      <Box>
                        <Text
                          fw={item.status?.toUpperCase() === 'MISSED' ? 700 : 600}
                          c={item.status?.toUpperCase() === 'MISSED' ? 'red' : undefined}
                        >
                          {otherPartyName}
                        </Text>

                        <Group gap={8} mt={4}>
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

                        {!!timestamp && (
                          <Text size="xs" c="dimmed" mt={6}>
                            {timestamp}
                          </Text>
                        )}
                      </Box>

                      <Stack gap={6} align="flex-end">
                        {item.hasVoicemail ? (
                          <Badge
                            leftSection={<Voicemail size={12} />}
                            color="grape"
                            variant="light"
                          >
                            Voicemail
                          </Badge>
                        ) : null}

                        <ActionIcon
                          variant="filled"
                          color="yellow"
                          radius="xl"
                          size={38}
                          onClick={() => handleRedial(item)}
                          disabled={!canRedial || pstnLoading}
                          aria-label={`Call ${otherPartyName}`}
                        >
                          <Phone size={18} />
                        </ActionIcon>

                        <ActionIcon
                          variant="subtle"
                          color="red"
                          radius="xl"
                          size={34}
                          onClick={() => handleDelete(item.id)}
                          aria-label={`Delete call with ${otherPartyName}`}
                        >
                          <Trash2 size={16} />
                        </ActionIcon>
                      </Stack>
                    </Group>
                  </Box>
                </Group>
              </Card>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}