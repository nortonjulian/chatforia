import { useState } from 'react';
import {
  Modal, Stack, TextInput, Switch, Text,
  Group, Button
} from '@mantine/core';
import axiosClient from '../api/axiosClient';

export default function EditSavedContactModal({
  contact,
  onClose,
  onSaved,
}) {
  const [alias, setAlias] = useState(contact.alias || '');
  const [name, setName] = useState(contact.externalName || '');
  const [favorite, setFavorite] = useState(Boolean(contact.favorite));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const userId = contact.userId ?? contact.user?.id;
  const isChatforia = userId != null;

  async function save() {
    if (saving) return;

    setSaving(true);
    setError('');

    try {
      const identity = isChatforia
        ? { userId }
        : { externalPhone: contact.externalPhone };

      if (!isChatforia && !contact.externalPhone) {
        throw new Error('Contact has no saved phone number.');
      }

      const payload = {
        ...identity,
        alias: alias.trim(),
        favorite,
        ...(!isChatforia ? { externalName: name.trim() } : {}),
      };

      const { data } = await axiosClient.patch('/contacts', payload);

      if (data?.id == null) {
        throw new Error('Server did not confirm the contact update.');
      }

      await onSaved(data);
    } catch (err) {
      setError(err?.response?.data?.error || err.message ||
        'Could not save contact.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      opened
      centered
      radius="lg"
      title="Edit contact"
      onClose={() => { if (!saving) onClose(); }}
    >
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          {isChatforia
            ? `Chatforia: @${contact.user?.username || userId}`
            : `Phone: ${contact.externalPhone}`}
        </Text>

        {!isChatforia && (
          <TextInput
            label="Name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
        )}

        <TextInput
          label="Alias"
          value={alias}
          onChange={(e) => setAlias(e.currentTarget.value)}
        />

        <Switch
          label="Favorite"
          checked={favorite}
          onChange={(e) => setFavorite(e.currentTarget.checked)}
        />

        {error && <Text role="alert" c="red" size="sm">{error}</Text>}

        <Group justify="flex-end">
          <Button variant="subtle" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} onClick={save}>
            Save Changes
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
