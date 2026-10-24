import { useCallback, useEffect, useState } from 'react';
import { Button, Group, Modal, Paper, Stack, Text, TextInput } from '@mantine/core';
import axiosClient from '../../api/axiosClient';

function apiError(error, fallback) {
  return error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    fallback;
}

export default function BlockedNumbersPanel() {
  const [items, setItems] = useState([]);
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [unblockingId, setUnblockingId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingUnblock, setPendingUnblock] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const { data } = await axiosClient.get('/sms/blocked-numbers');
      if (!Array.isArray(data?.items)) {
        throw new Error('Invalid blocked-number response.');
      }
      setItems(data.items);
    } catch (err) {
      setError(apiError(err, 'Could not load blocked numbers.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function blockNumber(event) {
    event.preventDefault();
    const value = phone.trim();

    if (!value || saving) return;

    setSaving(true);
    setError('');
    setNotice('');

    try {
      const { data } = await axiosClient.post(
        '/sms/blocked-numbers',
        { phone: value }
      );

      if (!data?.success || !data?.item?.id) {
        throw new Error('Server did not confirm blocking.');
      }

      setItems((previous) => [
        data.item,
        ...previous.filter((item) => item.id !== data.item.id),
      ]);
      setPhone('');
      setNotice('Number blocked successfully.');
    } catch (err) {
      setError(apiError(err, 'Could not block number.'));
    } finally {
      setSaving(false);
    }
  }

  async function unblockNumber(item) {
    if (!item || unblockingId !== null) return;
    setUnblockingId(item.id);
    setError('');
    setNotice('');

    try {
      const { data } = await axiosClient.delete(
        `/sms/blocked-numbers/${item.id}`
      );

      if (!data?.success) {
        throw new Error('Server did not confirm unblocking.');
      }

      setItems((previous) =>
        previous.filter((entry) => entry.id !== item.id)
      );
      setPendingUnblock(null);
      setNotice('Number unblocked successfully.');
    } catch (err) {
      setError(apiError(err, 'Could not unblock number.'));
    } finally {
      setUnblockingId(null);
    }
  }

  return (
    <Paper withBorder radius="lg" p="md">
      <Stack gap="sm">
        <Group justify="space-between" align="center">
          <Text fw={600}>Blocked phone numbers</Text>
          <Button
            size="xs"
            variant="subtle"
            onClick={refresh}
            disabled={loading || saving || unblockingId !== null}
          >
            Refresh
          </Button>
        </Group>

        <Text size="sm" c="dimmed">
          These numbers cannot send SMS or MMS to your Chatforia number.
          Chatforia account blocking is managed separately.
        </Text>

        <form onSubmit={blockNumber}>
          <Group align="end" wrap="wrap" gap="sm">
            <TextInput
              label="Phone number to block"
              placeholder="+15551234567"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.currentTarget.value)}
              disabled={saving}
              style={{ flex: '1 1 190px' }}
            />
            <Button type="submit" loading={saving} disabled={!phone.trim()}>
              Block number
            </Button>
          </Group>
        </form>

        {loading ? (
          <Text size="sm">Loading blocked numbers…</Text>
        ) : items.length === 0 ? (
          <Text size="sm" c="dimmed">No blocked numbers.</Text>
        ) : (
          <Stack gap="xs">
            {items.map((item) => (
              <Group key={item.id} justify="space-between" wrap="wrap">
                <Text size="sm">{item.phone}</Text>
                <Button
                  size="xs"
                  variant="light"
                  color="red"
                  loading={unblockingId === item.id}
                  disabled={unblockingId !== null}
                  onClick={() => { setError(''); setPendingUnblock(item); }}
                  aria-label={`Unblock ${item.phone}`}
                >
                  Unblock
                </Button>
              </Group>
            ))}
          </Stack>
        )}

        {!pendingUnblock && error && <Text role="alert" size="sm" c="red">{error}</Text>}
        {notice && <Text role="status" size="sm">{notice}</Text>}
      </Stack>
      <Modal
        opened={Boolean(pendingUnblock)}
        onClose={() => {
          if (unblockingId === null) { setPendingUnblock(null); setError(''); }
        }}
        title="Unblock phone number?"
        centered
        size="sm"
        radius="lg"
        closeOnClickOutside={unblockingId === null}
        closeOnEscape={unblockingId === null}
        withCloseButton={unblockingId === null}
      >
        <Stack gap="md">
          <Text size="sm">
            Remove the block on <strong>{pendingUnblock?.phone}</strong>?
          </Text>
          <Text size="sm" c="dimmed">
            SMS and MMS from this number may be delivered again. Chatforia account blocking is unchanged.
          </Text>
          {error && <Text role="alert" size="sm" c="red">{error}</Text>}
          <Group justify="flex-end" gap="sm">
            <Button variant="default" disabled={unblockingId !== null} onClick={() => { setPendingUnblock(null); setError(''); }}>
              Cancel
            </Button>
            <Button loading={unblockingId !== null} disabled={!pendingUnblock} onClick={() => void unblockNumber(pendingUnblock)}>
              Unblock number
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
  );
}
