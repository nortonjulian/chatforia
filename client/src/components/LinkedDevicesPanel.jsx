import { useEffect, useState } from 'react';
import axiosClient from '@/api/axiosClient';
import {
  Card,
  Group,
  Text,
  Button,
  Stack,
  Skeleton,
  Badge,
  ActionIcon,
  Tooltip,
} from '@mantine/core';
import {
  IconRefresh,
  IconPencil,
  IconTrash,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';

// Runtime helpers: always read global.toast *when called*
function toastOk(message) {
  if (typeof globalThis !== 'undefined' && globalThis.toast?.ok) {
    globalThis.toast.ok(message);
  }
}

function toastErr(message) {
  if (typeof globalThis !== 'undefined' && globalThis.toast?.err) {
    globalThis.toast.err(message);
  }
}

function formatDate(iso, t) {
  if (!iso) return t('linkedDevicesPanel.unknown', 'Unknown');
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return t('linkedDevicesPanel.unknown', 'Unknown');
  }
}

export default function LinkedDevicesPanel() {
  const { t } = useTranslation();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [initialLoaded, setInitialLoaded] = useState(false);

  async function fetchDevices() {
    try {
      setLoading(true);
      const { data } = await axiosClient.get('/devices');
      const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
      setDevices(list);
      setInitialLoaded(true);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404) {
        // No linked devices yet — empty state, no error toast
        setDevices([]);
        setInitialLoaded(true);
      } else {
        console.error('Failed to load linked devices', err);
        toastErr(t('linkedDevicesPanel.loadFailed', 'Failed to load linked devices'));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRename = async (id) => {
    const raw = window.prompt(t('linkedDevicesPanel.renamePrompt', 'Enter a new name for this device'));
    const name = raw?.trim();
    if (!name) return; // cancel / empty => no POST

    try {
      await axiosClient.post(`/devices/rename/${id}`, { name });
      setDevices((prev) =>
        prev.map((d) => (d.id === id ? { ...d, name } : d))
      );
      toastOk(t('linkedDevicesPanel.renamed', 'Device renamed'));
    } catch (err) {
      console.error('Failed to rename device', err);
      toastErr(t('linkedDevicesPanel.renameFailed', 'Could not rename device'));
    }
  };

  const handleRevoke = async (id) => {
    try {
      await axiosClient.post(`/devices/revoke/${id}`);
      setDevices((prev) =>
        prev.map((d) =>
          d.id === id ? { ...d, revoked: true } : d
        )
      );
      toastOk(t('linkedDevicesPanel.revoked', 'Device revoked'));
    } catch (err) {
      console.error('Failed to revoke device', err);
      toastErr(t('linkedDevicesPanel.revokeFailed', 'Could not revoke device'));
    }
  };

  const showSkeletons = loading && !initialLoaded;

  return (
    <Stack>
      <Group justify="space-between" align="center">
        <Text fw={600}>{t('linkedDevicesPanel.title', 'Linked devices')}</Text>
        <Button
          leftSection={<IconRefresh size={16} />}
          onClick={fetchDevices}
          aria-label={t('linkedDevicesPanel.refresh', 'Refresh')}
        >
          {t('linkedDevicesPanel.refresh', 'Refresh')}
        </Button>
      </Group>

      {showSkeletons ? (
        <>
          <Skeleton h={60} />
          <Skeleton h={60} />
        </>
      ) : devices.length === 0 ? (
        <Text c="dimmed">{t('linkedDevicesPanel.noneFound', 'No linked devices found.')}</Text>
      ) : (
        <Stack>
          {devices.map((dev) => {
            const {
              id,
              name,
              isPrimary,
              platform,
              createdAt,
              lastSeenAt,
              revoked,
            } = dev;

            const disabled = !!revoked;
            const displayName =
              name && name.trim().length > 0
                ? name
                : t('linkedDevicesPanel.unnamedDevice', 'Unnamed device');

            return (
              <Card key={id} shadow="sm" p="md">
                <Group justify="space-between" align="flex-start">
                  <Stack gap="xs">
                    <Text fw={500}>{displayName}</Text>
                    <Group gap="xs">
                      {isPrimary && <Badge>{t('linkedDevicesPanel.primary', 'Primary')}</Badge>}
                      {platform && <Badge>{platform}</Badge>}
                      {revoked && <Badge>{t('linkedDevicesPanel.revokedStatus', 'Revoked')}</Badge>}
                    </Group>
                    <Text size="xs" c="dimmed">
                      {t('linkedDevicesPanel.addedLastSeen', 'Added {{created}} • Last seen {{lastSeen}}', {
                        created: formatDate(createdAt, t),
                        lastSeen: formatDate(lastSeenAt, t),
                      })}
                    </Text>
                  </Stack>

                  <Group gap="xs">
                    <Tooltip label={t('linkedDevicesPanel.renameDevice', 'Rename device')}>
                      <ActionIcon
                        aria-label={t('linkedDevicesPanel.renameDevice', 'Rename device')}
                        onClick={() => handleRename(id)}
                        disabled={disabled}
                      >
                        <IconPencil size={16} />
                      </ActionIcon>
                    </Tooltip>

                    <Tooltip label={t('linkedDevicesPanel.revokeDevice', 'Revoke device')}>
                      <ActionIcon
                        aria-label={t('linkedDevicesPanel.revokeDevice', 'Revoke device')}
                        onClick={() => handleRevoke(id)}
                        disabled={disabled}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Group>
              </Card>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
