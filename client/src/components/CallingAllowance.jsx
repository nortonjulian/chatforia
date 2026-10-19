import { useEffect, useState } from 'react';
import { Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axiosClient from '../api/axiosClient';
import { callingAllowance } from '../utils/callAllowance';

export default function CallingAllowance() {
  const { t } = useTranslation();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ loading: true, allowance: null, error: false });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, allowance: null, error: false });
    async function load() {
      try {
        const { data } = await axiosClient.get('/premium/entitlements');
        const allowance = callingAllowance(data);
        if (!allowance) throw new Error('Invalid calling usage');
        if (!cancelled) setState({ loading: false, allowance, error: false });
      } catch {
        if (!cancelled) setState({ loading: false, allowance: null, error: true });
      }
    }
    load();
    return () => { cancelled = true; };
  }, [revision]);

  const { allowance, loading, error } = state;
  return (
    <Paper withBorder radius="xl" p="xl">
      <Stack gap="sm">
        <Title order={3}>{t('billing.callingAllowanceTitle', 'App voice and video calls')}</Title>
        <div role="status" aria-live="polite">
          {loading && <Text>{t('billing.callingUsageLoading', 'Loading calling allowance…')}</Text>}
          {error && <Text c="red">{t('billing.callingUsageError', 'Calling usage is unavailable. Try again.')}</Text>}
          {allowance && <>
            <Text fw={600}>
              {allowance.unlimited
                ? t('billing.callingUnlimited', 'Unlimited participant-minutes')
                : t('billing.callingRemaining', '{{remaining}} of {{limit}} participant-minutes remaining', {
                    remaining: allowance.remaining, limit: allowance.limit,
                  })}
            </Text>
            {!allowance.unlimited && <Text size="sm">
              {t('billing.callingTwoPerson', 'About {{minutes}} minutes of two-person calling remaining.', {
                minutes: allowance.twoPersonMinutes,
              })}
            </Text>}
            {allowance.exhausted && <Text c="red" size="sm">
              {t('billing.callingExhausted', 'Your monthly app-calling allowance has been used up.')}
            </Text>}
            {allowance.resetLabel && <Text size="sm">
              {t('billing.callingReset', 'Resets {{date}} at 00:00 UTC.', { date: allowance.resetLabel })}
            </Text>}
          </>}
        </div>
        <Text size="sm" c="dimmed">
          {t('billing.callingCountExplanation', 'Each connected person uses one participant-minute per minute. The person who starts the call covers everyone: a two-person call uses two participant-minutes per minute. Calls to phone numbers have a separate allowance.')}
        </Text>
        <Text size="sm" c="dimmed">
          {t('billing.callingUsageTiming', 'Usage updates after calls end. Refresh usage to see the latest total.')}
        </Text>
        <Group>
          <Button variant="default" loading={loading} onClick={() => setRevision(value => value + 1)}>
            {t('billing.refreshCallingUsage', 'Refresh usage')}
          </Button>
          <Button component={Link} to="/upgrade" variant="subtle">
            {t('billing.viewCallingPlans', 'View plan options')}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
