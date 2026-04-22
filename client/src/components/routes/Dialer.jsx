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
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import axiosClient from '@/api/axiosClient';
import { usePstnCall } from '@/hooks/usePstnCall';
import { useTwilioVoice } from '@/hooks/useTwilioVoice';

// keep digits and a leading +
function normalizePhone(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.replace(/[^\d+]/g, '');
}

export default function Dialer() {
  const { t } = useTranslation();
  const [params] = useSearchParams();

  const qpTo = params.get('to');         // /dialer?to=+1301...
  const qpUserId = params.get('userId'); // /dialer?userId=123

  const [digits, setDigits] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState('');

  const { currentUser } = useUser();

  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');

  // PSTN (alias call via Twilio → real phone network)
  const { placeCall, loading: pstnLoading, error: pstnError } = usePstnCall();

  // Browser-based Twilio Voice call
  const {
    startBrowserCall,
    ready: voiceReady,
    calling: browserCalling,
    error: voiceError,
  } = useTwilioVoice();

  // ✅ Prefill from query params
  useEffect(() => {
    let mounted = true;

    async function run() {
      setResolveError('');

      // 1) If explicit ?to=, prefer it
      if (qpTo) {
        const next = normalizePhone(qpTo);
        if (mounted) setDigits(next);
        return;
      }

      // 2) If ?userId=, resolve to a callable target
      if (qpUserId) {
        const userId = String(qpUserId || '').trim();
        if (!userId) return;

        setResolving(true);
        try {
          /**
           * Recommended backend:
           * GET /users/:id/call-target  -> { to: "+1555..." } OR { to: "client:user:123" }
           */
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

  useEffect(() => {
  let mounted = true;

  async function loadHistory() {
    try {
      setHistoryLoading(true);
      setHistoryError('');

      const items = await getCallHistory();

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
        e?.response?.data?.error || e?.message || 'Failed to load recents'
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

  const press = (d) => setDigits((s) => (s + d).slice(0, 32));
  const backspace = () => setDigits((s) => s.slice(0, -1));

  const toNumber = useMemo(() => digits.trim(), [digits]);
  const disabledNumber = !toNumber;

  const handlePstnCall = async () => {
    if (!toNumber) return;
    await placeCall(toNumber);
  };

  const handleBrowserCall = async () => {
    if (!toNumber || !voiceReady) return;
    await startBrowserCall(toNumber);
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

      {/* Display */}
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

      {/* Keypad + actions */}
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

        {/* PSTN: Chatforia number → phone network */}
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

        {/* Browser-based Twilio Voice call */}
        <Button
          variant="outline"
          onClick={handleBrowserCall}
          disabled={disabledNumber || !voiceReady || browserCalling || resolving}
        >
          {t('dialer.callBrowser', 'Call via browser')}
        </Button>
      </Stack>

      <Divider my="lg" />

      {/* Recents placeholder */}
      <Text fw={600} mb={6}>
        {t('dialer.recents', 'Recents')}
      </Text>

      {historyLoading ? (
        <Loader size="sm" />
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

            const name =
              otherParty?.displayName ||
              otherParty?.username ||
              item.externalPhone ||
              (isOutgoing ? 'Outgoing Call' : 'Incoming Call');

            const timestamp = new Date(
              item.endedAt || item.startedAt || item.createdAt
            ).toLocaleString();

            return (
              <Card key={item.id} withBorder radius="lg" p="md">
                <Text fw={600}>{name}</Text>

                <Group gap={6} mt={4}>
                  <Text size="sm" c="dimmed">
                    {isOutgoing ? 'Outgoing' : 'Incoming'}
                  </Text>
                  <Text size="sm" c="dimmed">•</Text>
                  <Text size="sm" c="dimmed">
                    {item.status === 'ENDED' ? 'Completed' : item.status}
                  </Text>
                </Group>

                <Text size="xs" c="dimmed" mt={4}>
                  {timestamp}
                </Text>
              </Card>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}