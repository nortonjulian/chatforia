import { useCallback, useState } from 'react';
import {
  Modal,
  Button,
  Group,
  Stack,
  Text,
  Alert,
} from '@mantine/core';
import RecipientSelector from '@/components/RecipientSelector';
import axiosClient from '@/api/axiosClient';

export default function AddCallParticipantModal({
  opened,
  onClose,
  currentUser,
  existingParticipantIds = [],
  onAdd,
}) {
  const [selected, setSelected] = useState([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const fetchSuggestions = useCallback(
    async (query) => {
      const res = await axiosClient.get(
        `/users/search?query=${encodeURIComponent(query)}`
      );

      return (res.data || [])
        .filter((user) => user.id !== currentUser?.id)
        .filter((user) => !existingParticipantIds.includes(user.id))
        .map((user) => ({
          id: user.id,
          display: user.displayName || user.name || user.username || `User ${user.id}`,
          type: 'user',
          avatarUrl: user.avatarUrl,
          username: user.username,
        }));
    },
    [currentUser?.id, existingParticipantIds]
  );

  const handleAdd = async () => {
    const person = selected[0];
    if (!person) return;

    setAdding(true);
    setError('');

    try {
      await onAdd?.(Number(person.id));
      setSelected([]);
      onClose?.();
    } catch (err) {
      setError(
        err?.response?.data?.error ||
          err?.message ||
          'Could not add this person to the call.'
      );
    } finally {
      setAdding(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Add person to call" centered>
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          You can add one more person to this audio call.
        </Text>

        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}

        <RecipientSelector
          value={selected}
          onChange={setSelected}
          fetchSuggestions={fetchSuggestions}
          maxRecipients={1}
          allowRaw={false}
          placeholder="Search for a person…"
        />

        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleAdd} loading={adding} disabled={!selected.length}>
            Add person
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}