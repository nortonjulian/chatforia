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

function formatDate(iso) {
  if (!iso) return 'Unknown';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return 'Unknown';
  }
}

export default function LinkedDevicesPanel() {
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
        toastErr('Failed to load linked devices');
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
    const raw = window.prompt('Enter a new name for this device');
    const name = raw?.trim();
    if (!name) return; // cancel / empty => no POST

    try {
      await axiosClient.post(`/devices/rename/${id}`, { name });
      setDevices((prev) =>
        prev.map((d) => (d.id === id ? { ...d, name } : d))
      );
      toastOk('Device renamed');
    } catch (err) {
      console.error('Failed to rename device', err);
      toastErr('Could not rename device');
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
      toastOk('Device revoked');
    } catch (err) {
      console.error('Failed to revoke device', err);
      toastErr('Could not revoke device');
    }
  };

  const showSkeletons = loading && !initialLoaded;

  return (
    <Stack>
      <Group justify="space-between" align="center">
        <Text fw={600}>Linked devices</Text>
        <Button
          leftSection={<IconRefresh size={16} />}
          onClick={fetchDevices}
          aria-label="Refresh"
        >
          Refresh
        </Button>
      </Group>

      {showSkeletons ? (
        <>
          <Skeleton h={60} />
          <Skeleton h={60} />
        </>
      ) : devices.length === 0 ? (
        <Text c="dimmed">No linked devices found.</Text>
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
              name && name.trim().length > 0 ? name : 'Unnamed device';

            return (
              <Card key={id} shadow="sm" p="md">
                <Group justify="space-between" align="flex-start">
                  <Stack gap="xs">
                    <Text fw={500}>{displayName}</Text>
                    <Group gap="xs">
                      {isPrimary && <Badge>Primary</Badge>}
                      {platform && <Badge>{platform}</Badge>}
                      {revoked && <Badge>Revoked</Badge>}
                    </Group>
                    <Text size="xs" c="dimmed">
                      Added {formatDate(createdAt)} • Last seen {formatDate(lastSeenAt)}
                    </Text>
                  </Stack>

                  <Group gap="xs">
                    <Tooltip label="Rename device">
                      <ActionIcon
                        aria-label="Rename device"
                        onClick={() => handleRename(id)}
                        disabled={disabled}
                      >
                        <IconPencil size={16} />
                      </ActionIcon>
                    </Tooltip>

                    <Tooltip label="Revoke device">
                      <ActionIcon
                        aria-label="Revoke device"
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
