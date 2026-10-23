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
  const [phone, setPhone] = useState(contact.externalPhone || '');
  const [favorite, setFavorite] = useState(Boolean(contact.favorite));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const userId = contact.userId ?? contact.user?.id;
  const isChatforia = userId != null;
  const existingPhone = (contact.externalPhone || '').trim();

  async function save() {
    if (saving) return;

    setSaving(true);
    setError('');

    try {
      const enteredPhone = phone.trim();
      const phoneChanged = enteredPhone !== existingPhone;

      if (isChatforia && phoneChanged && !enteredPhone) {
        throw new Error(
          'Removing a linked phone number is not supported here.'
        );
      }

      let response;

      if (isChatforia && phoneChanged) {
        // The backend verifies that this number belongs to this account.
        response = await axiosClient.post('/contacts', {
          userId,
          externalPhone: enteredPhone,
          alias: alias.trim(),
          favorite,
        });
      } else {
        response = await axiosClient.patch('/contacts', {
          ...(isChatforia
            ? { userId }
            : { externalPhone: existingPhone }),
          alias: alias.trim(),
          favorite,
          ...(!isChatforia
            ? { externalName: name.trim() }
            : {}),
        });
      }

      if (response.data?.id == null) {
        throw new Error('Server did not confirm the contact update.');
      }

      await onSaved(response.data);
    } catch (err) {
      setError(
        err?.response?.data?.error ||
        err?.message ||
        'Could not save contact.'
      );
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
        {isChatforia && (
          <Text size="sm" c="dimmed">
            Chatforia: @{contact.user?.username || userId}
          </Text>
        )}

        {!isChatforia && (
          <TextInput
            label="Name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
        )}

        <TextInput
          label="Phone number"
          placeholder="+1 555 123 4567"
          value={phone}
          onChange={(e) => setPhone(e.currentTarget.value)}
          readOnly={!isChatforia}
          inputMode="tel"
        />

        <Text size="xs" c="dimmed">
          {isChatforia
            ? 'Only a number verified as belonging to this Chatforia account can be linked. Save other numbers as separate Phone contacts.'
            : 'This is the saved phone-contact identity. Add another Phone contact to save a different number.'}
        </Text>

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

        {error && (
          <Text role="alert" c="red" size="sm">
            {error}
          </Text>
        )}

        <Group justify="flex-end">
          <Button
            variant="subtle"
            disabled={saving}
            onClick={onClose}
          >
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
