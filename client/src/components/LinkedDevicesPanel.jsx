import { useEffect, useRef, useState } from 'react';
import axiosClient from '../api/axiosClient';
import { Card, Group, Text, Button, Stack, Skeleton, Badge, ActionIcon, Tooltip } from '@mantine/core';
import { IconRefresh, IconPencil, IconTrash } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';

// Safe toast shim (so we don't crash if your toast util isn't wired)
const toast = {
  ok: (m) => console.log(m),
  err: (m) => console.error(m),
  info: (m) => console.info(m),
};

export default function LinkedDevicesPanel() {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const didRun = useRef(false); // guard StrictMode double-mount in dev

  async function fetchDevices() {
    try {
      setLoading(true);
      const { data } = await axiosClient.get('/devices');
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      // If route is missing you might get 404; avoid spamming the user
      if (e?.response?.status !== 404) {
        toast.err(t('common.refresh', 'Failed to load devices'));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;
    fetchDevices();
  }, []);

  async function rename(id, currentName) {
    // using native prompt to keep UX identical
    const next = window.prompt(t('linkedDevicesPanel.renamePrompt', 'Rename device'), currentName || '');
    if (!next || !next.trim()) return;
    try {
      await axiosClient.post(`/devices/rename/${id}`, { name: next.trim() });
      setItems((prev) => prev.map((d) => (d.id === id ? { ...d, name: next.trim() } : d)));
      toast.ok(t('linkedDevicesPanel.renamed', 'Device renamed'));
    } catch (e) {
      toast.err(t('linkedDevicesPanel.renameFailed', 'Could not rename device'));
    }
  }

  async function revoke(id) {
    try {
      await axiosClient.post(`/devices/revoke/${id}`);
      // Mark as revoked in-place (or filter out if you prefer)
      setItems((prev) =>
        prev.map((d) => (d.id === id ? { ...d, revokedAt: new Date().toISOString() } : d))
      );
      toast.ok(t('linkedDevicesPanel.revoked', 'Device revoked'));
    } catch (e) {
      toast.err(t('linkedDevicesPanel.revokeFailed', 'Could not revoke device'));
    }
  }

  // Localized date formatter using current i18n language
  const fmt = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(i18n.language || undefined);
    } catch {
      return new Date(iso).toLocaleString();
    }
  };

  return (
    <Card withBorder radius="lg" p="lg">
      <Group justify="space-between" mb="md">
        <Text fw={700} size="lg">
          {t('linkedDevicesPanel.title', 'Linked Devices')}
        </Text>
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          onClick={fetchDevices}
        >
          {t('linkedDevicesPanel.refresh', 'Refresh')}
        </Button>
      </Group>

      {loading ? (
        <Stack>
          <Skeleton h={56} />
          <Skeleton h={56} />
        </Stack>
      ) : items.length === 0 ? (
        <Text c="dimmed">{t('linkedDevicesPanel.noneFound', 'No linked devices found.')}</Text>
      ) : (
        <Stack>
          {items.map((d) => {
            const isRevoked = !!d.revokedAt;
            return (
              <Group key={d.id} justify="space-between" align="center">
                <div>
                  <Group gap="xs" align="center">
                    <Text fw={600}>
                      {d.name || t('linkedDevicesPanel.unnamed', 'Unnamed device')}
                    </Text>
                    {d.isPrimary ? (
                      <Badge color="green" variant="light">
                        {t('linkedDevicesPanel.primary', 'Primary')}
                      </Badge>
                    ) : null}
                    {d.platform ? <Badge variant="light">{d.platform}</Badge> : null}
                    {isRevoked ? (
                      <Badge color="red" variant="light">
                        {t('linkedDevicesPanel.revokedBadge', 'Revoked')}
                      </Badge>
                    ) : null}
                  </Group>
                  <Text size="sm" c="dimmed">
                    {t('linkedDevicesPanel.added', 'Added')}{' '}
                    {d.createdAt ? fmt(d.createdAt) : '—'}
                    {d.lastSeenAt
                      ? ` · ${t('linkedDevicesPanel.lastSeen', 'Last seen')} ${fmt(d.lastSeenAt)}`
                      : ''}
                  </Text>
                </div>

                <Group gap="xs">
                  <Tooltip label={t('linkedDevicesPanel.rename', 'Rename')}>
                    <ActionIcon
                      variant="subtle"
                      onClick={() => rename(d.id, d.name)}
                      disabled={isRevoked}
                      aria-label={t('linkedDevicesPanel.rename', 'Rename device')}
                    >
                      <IconPencil size={16} />
                    </ActionIcon>
                  </Tooltip>

                  <Tooltip
                    label={
                      isRevoked
                        ? t('linkedDevicesPanel.alreadyRevoked', 'Already revoked')
                        : t('linkedDevicesPanel.revoke', 'Revoke')
                    }
                  >
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      onClick={() => revoke(d.id)}
                      disabled={isRevoked}
                      aria-label={t('linkedDevicesPanel.revoke', 'Revoke device')}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>
            );
          })}
        </Stack>
      )}
    </Card>
  );
}
