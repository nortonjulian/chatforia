import { useEffect, useState } from 'react';
import { Button, Paper, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import axiosClient from '../api/axiosClient';

const meters = [
  ['riaActions', 'Shared AI actions', 1],
  ['translationChars', 'Translation characters', 1],
  ['smsMessages', 'SMS and MMS messages', 1],
  ['pstnSeconds', 'Phone-call minutes', 60],
  ['forwardingSeconds', 'Forwarding minutes', 60],
  ['voiceNoteTranscriptionSeconds', 'Voice-note transcription minutes', 60],
  ['voicemailTranscriptionSeconds', 'Voicemail transcription minutes', 60],
];

function validUsage(value) {
  return value && ['used', 'limit', 'remaining'].every(key =>
    Number.isSafeInteger(value[key]) && value[key] >= 0);
}

export default function PlanUsage() {
  const { t } = useTranslation();
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(false); setSnapshot(null);
    axiosClient.get('/premium/usage').then(({ data }) => {
      if (!data?.resetAt || !Number.isFinite(Date.parse(data.resetAt)) ||
          !meters.every(([key]) => validUsage(data.usage?.[key]))) throw new Error('Invalid usage');
      if (active) setSnapshot(data);
    }).catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  const number = value => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
  return <Paper withBorder radius="xl" p="xl"><Stack gap="sm">
    <Title order={3}>{t('usage.title', 'Monthly usage')}</Title>
    <div role="status" aria-live="polite">
      {loading && <Text>{t('usage.loading', 'Loading usage…')}</Text>}
      {error && <Text c="red">{t('usage.error', 'Usage is unavailable. Please retry.')}</Text>}
      {snapshot && meters.map(([key, label, divisor]) => {
        const meter = snapshot.usage[key];
        const remaining = Math.max(0, Math.min(meter.remaining, meter.limit - meter.used));
        return <Text key={key} c={remaining === 0 && meter.limit > 0 ? 'red' : undefined}>
          {t(`usage.${key}`, label)}: {t('usage.balance', '{{remaining}} of {{limit}} remaining', {
            remaining: number(Math.floor(remaining / divisor * 10) / 10), limit: number(meter.limit / divisor),
          })}
        </Text>;
      })}
      {snapshot && <Text size="sm">{t('usage.reset', 'Resets {{date}} at 00:00 UTC.', {
        date: new Date(snapshot.resetAt).toLocaleDateString(undefined, { timeZone: 'UTC' }),
      })}</Text>}
    </div>
    <Text size="sm">{t('usage.explanation', 'AI tools share one action allowance. Translation counts processed characters. Voice-note transcription and live captions share recorded usage; voicemail is separate. A zero limit means no included allowance. Feature eligibility still depends on your plan.')}</Text>
    <Text size="sm">{t('usage.exhaustion', 'Reaching a limit pauses that feature until reset. It does not stop ordinary in-app text chat. Usage updates after processing; refresh for the latest balance.')}</Text>
    <Button variant="default" loading={loading} onClick={() => setRevision(value => value + 1)}>
      {t('usage.refresh', 'Refresh usage')}
    </Button>
  </Stack></Paper>;
}
