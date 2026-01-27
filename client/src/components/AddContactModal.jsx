import { useState } from 'react';
import { Modal, Stack, TextInput, Group, Button, Text } from '@mantine/core';
import axiosClient from '@/api/axiosClient';

export default function AddContactModal({ opened, onClose, currentUserId, onAdded }) {
  const [value, setValue] = useState(''); // phone or username
  const [alias, setAlias] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    const vRaw = value.trim();
    if (!vRaw) {
      setErr('Enter a phone number or username.');
      return;
    }

    // Treat as phone only if the input contains only phone-ish characters
    // (prevents usernames like "julian123" from being misread as phone numbers)
    const looksLikePhone =
      vRaw.startsWith('+') || /^[\d\s().-]+$/.test(vRaw);

    setErr('');
    setLoading(true);

    try {
      const payload = {
        alias: alias.trim() || null,
      };

      if (looksLikePhone) {
        // Allow users to type:
        //  - +13018019227 (E.164)
        //  - 3018019227 (US national)
        //  - (301) 801-9227
        //
        // Backend normalizes to E.164 using req.region || 'US' when there's no '+'.
        payload.externalPhone = vRaw;
      } else {
        // Resolve username -> userId, then send userId to /contacts
        const { data } = await axiosClient.get('/users/lookup', {
          params: { username: vRaw },
        });

        if (!data?.userId) {
          throw new Error('User lookup failed.');
        }

        // Optional: block adding yourself (backend also blocks too)
        if (currentUserId && Number(data.userId) === Number(currentUserId)) {
          setErr('You cannot add yourself as a contact.');
          setLoading(false);
          return;
        }

        payload.userId = data.userId;
      }

      await axiosClient.post('/contacts', payload);

      setValue('');
      setAlias('');
      onClose?.();
      onAdded?.();
    } catch (e) {
      console.error('[AddContactModal] add failed', e);
      setErr(e?.response?.data?.error || e?.message || 'Failed to add contact.');
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
          <Button variant="subtle" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={submit} loading={loading}>
            Add
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
