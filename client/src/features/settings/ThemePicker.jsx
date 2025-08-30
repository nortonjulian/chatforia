import { useEffect, useMemo, useState } from 'react';
import { Group, Select, Button, Stack, Text, Alert } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import axiosClient from '@/api/axiosClient';
import useEntitlements from '@/hooks/useEntitlements';
import PremiumGuard from '@/components/PremiumGuard';

export default function ThemePicker() {
  const nav = useNavigate();
  const { entitlements, loading } = useEntitlements();
  const [current, setCurrent] = useState('light');
  const [opts, setOpts] = useState([]);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const { data } = await axiosClient.get('/features/themes');
        if (ignore) return;
        const { current: cur, catalog, canUsePremium } = data || {};
        setCurrent(cur?.theme || 'light');

        const free = (catalog || []).filter((x) => !x.premium).map((x) => ({ label: x.id, value: x.id }));
        const prem = (catalog || []).filter((x) => x.premium).map((x) => ({
          label: `⭐ ${x.id}`,
          value: x.id,
          disabled: !canUsePremium,
        }));
        const grouped = [
          { group: 'Free', items: free },
          { group: 'Premium', items: prem },
        ];
        setOpts(grouped);
      } catch {
        // ignore
      }
    })();
    return () => { ignore = true; };
  }, []);

  const canUsePremium = useMemo(() => {
    if (!entitlements) return false;
    return String(entitlements?.plan || 'FREE').toUpperCase() === 'PREMIUM';
  }, [entitlements]);

  async function saveTheme(v) {
    try {
      await axiosClient.patch('/features/theme', { theme: v });
      setCurrent(v);
    } catch (e) {
      const status = e?.response?.status;
      if (status === 402 || e?.response?.data?.code === 'PREMIUM_REQUIRED') {
        nav('/settings/upgrade');
      } else if (status === 409) {
        alert('Theme field not found on server. Add `theme String @default("light")` to User and migrate.');
      } else {
        alert('Failed to update theme.');
      }
    }
  }

  if (loading) return null;

  return (
    <Stack gap="sm">
      <Text fw={600}>Appearance</Text>
      {!canUsePremium && (
        <Alert variant="light" color="blue">Premium themes are locked. <a href="/settings/upgrade">Upgrade</a> to use them.</Alert>
      )}
      <Group grow align="end">
        <Select
          label="Theme"
          data={opts}
          value={current}
          onChange={(v) => {
            if (!v) return;
            const isPrem = v && v !== 'light' && v !== 'dark';
            if (isPrem && !canUsePremium) return nav('/settings/upgrade');
            saveTheme(v);
          }}
          searchable
        />
        <PremiumGuard variant="inline" silent>
          <Text size="sm">Unlock premium themes.</Text>
        </PremiumGuard>
      </Group>
    </Stack>
  );
}
