import React, { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import {
  IconLink,
  IconLogout,
  IconPencil,
  IconRefresh,
  IconShield,
} from '@tabler/icons-react';
import LinkFlowPrimaryModal from './LinkFlowPrimaryModal.jsx';
import { useDeviceEvents } from '../../hooks/useDeviceEvents.js';
import { useUser } from '../../context/UserContext.jsx';

export default function DeviceManagement() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [renameId, setRenameId] = useState(null);
  const [renameVal, setRenameVal] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const { user } = useUser();

  // Live updates from server (device:linked / device:revoked)
  useDeviceEvents({
    userId: user?.id,
    onLinked: () => setRefreshTick((t) => t + 1),
    onRevoked: () => setRefreshTick((t) => t + 1),
  });

  const fetchDevices = async () => {
    setLoading(true);
    try {
      const res = await fetch('/devices', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load devices');
      const data = await res.json();
      setDevices(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setDevices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    fetchDevices();
  }, [refreshTick, user?.id]);

  const onRevoke = async (id) => {
    await fetch(`/devices/revoke/${id}`, {
      method: 'POST',
      credentials: 'include',
    });
    setRefreshTick((t) => t + 1);
  };

  const onRename = async (e) => {
    e.preventDefault();
    await fetch(`/devices/rename/${renameId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      credentials: 'include',
      body: JSON.stringify({ name: renameVal }),
    });
    setRenameId(null);
    setRenameVal('');
    setRefreshTick((t) => t + 1);
  };

  const rows = useMemo(
    () =>
      devices.map((d) => (
        <Table.Tr key={d.id}>
          <Table.Td>
            <Group gap="xs">
              <Text fw={600}>{d.name}</Text>
              {d.isPrimary && (
                <Tooltip label="Primary device">
                  <Badge leftSection={<IconShield size={12} />}>Primary</Badge>
                </Tooltip>
              )}
            </Group>
            <Text size="sm" c="dimmed">
              {d.platform || 'Unknown platform'}
            </Text>
          </Table.Td>
          <Table.Td>
            <Text size="sm">{new Date(d.createdAt).toLocaleString()}</Text>
            <Text size="xs" c="dimmed">
              added
            </Text>
          </Table.Td>
          <Table.Td>
            <Text size="sm">
              {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : '—'}
            </Text>
            <Text size="xs" c="dimmed">
              last seen
            </Text>
          </Table.Td>
          <Table.Td>
            {d.revokedAt ? (
              <Badge color="red" variant="light">
                Revoked
              </Badge>
            ) : (
              <Group gap="xs">
                <Tooltip label="Rename">
                  <ActionIcon
                    onClick={() => {
                      setRenameId(d.id);
                      setRenameVal(d.name || '');
                    }}
                  >
                    <IconPencil size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Revoke access">
                  <ActionIcon color="red" onClick={() => onRevoke(d.id)}>
                    <IconLogout size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            )}
          </Table.Td>
        </Table.Tr>
      )),
    [devices]
  );

  return (
    <Card withBorder padding="lg" radius="md">
      <Group justify="space-between" align="center" mb="md">
        <Text fw={700} size="lg">
          Your devices
        </Text>
        <Group>
          <Button
            leftSection={<IconLink size={16} />}
            onClick={() => setLinkOpen(true)}
          >
            Link new device
          </Button>
          <ActionIcon onClick={() => setRefreshTick((t) => t + 1)}>
            <IconRefresh size={16} />
          </ActionIcon>
        </Group>
      </Group>

      {loading ? (
        <Group justify="center" p="xl">
          <Loader />
        </Group>
      ) : (
        <ScrollArea>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Device</Table.Th>
                <Table.Th>Added</Table.Th>
                <Table.Th>Activity</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>{rows}</Table.Tbody>
          </Table>
        </ScrollArea>
      )}

      <Modal
        opened={!!renameId}
        onClose={() => setRenameId(null)}
        title="Rename device"
        centered
      >
        <form onSubmit={onRename}>
          <TextInput
            label="Name"
            value={renameVal}
            onChange={(e) => setRenameVal(e.currentTarget.value)}
            required
            maxLength={64}
          />
          <Group justify="flex-end" mt="md">
            <Button type="submit">Save</Button>
          </Group>
        </form>
      </Modal>

      <LinkFlowPrimaryModal
        opened={linkOpen}
        onClose={() => {
          setLinkOpen(false);
          setRefreshTick((t) => t + 1);
        }}
      />
    </Card>
  );
}
