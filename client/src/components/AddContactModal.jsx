import { useState } from 'react';
import { Modal, Stack, TextInput, Group, Button, Text } from '@mantine/core';
import axiosClient from '@/api/axiosClient';

export default function AddContactModal({ opened, onClose, currentUserId, onAdded }) {
  const [value, setValue] = useState(''); // phone or username
  const [alias, setAlias] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    const v = value.trim();
    if (!v) {
      setErr('Enter a phone number or username.');
      return;
    }

    setErr('');
    setLoading(true);
    try {
      // ✅ You may need to adjust this endpoint/payload to match your server route
      await axiosClient.post('/contacts', {
        ownerId: currentUserId,
        value: v,          // phone or username
        alias: alias.trim() || null,
      });

      setValue('');
      setAlias('');
      onClose?.();
      onAdded?.();
    } catch (e) {
      console.error('[AddContactModal] add failed', e);
      setErr(e?.response?.data?.error || 'Failed to add contact.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Add contact" radius="lg" centered>
      <Stack gap="sm">
        <TextInput
          label="Phone or username"
          placeholder="e.g. +13018019227 or juliannorton"
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
        />
        <TextInput
          label="Alias (optional)"
          placeholder="e.g. Work, Mom, Mike – Europe"
          value={alias}
          onChange={(e) => setAlias(e.currentTarget.value)}
        />

        {err && <Text c="red" size="sm">{err}</Text>}

        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={submit} loading={loading}>Add</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
