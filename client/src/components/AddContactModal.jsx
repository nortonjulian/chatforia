import { useState } from 'react';
import { Modal, Stack, TextInput, Group, Button, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import axiosClient from '@/api/axiosClient';

export default function AddContactModal({ opened, onClose, currentUserId, onAdded }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [alias, setAlias] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    const vRaw = value.trim();
    if (!vRaw) {
      setErr(t('addContactModal.enterPhoneOrUsername', 'Enter a phone number or username.'));
      return;
    }

    const looksLikePhone =
      vRaw.startsWith('+') || /^[\d\s().-]+$/.test(vRaw);

    setErr('');
    setLoading(true);

    try {
      const payload = {
        alias: alias.trim() || null,
      };

      if (looksLikePhone) {
        payload.externalPhone = vRaw;
      } else {
        const { data } = await axiosClient.get('/users/lookup', {
          params: { username: vRaw },
        });

        if (!data?.userId) {
          throw new Error(t('addContactModal.userLookupFailed', 'User lookup failed.'));
        }

        if (currentUserId && Number(data.userId) === Number(currentUserId)) {
          setErr(t('addContactModal.cannotAddSelf', 'You cannot add yourself as a contact.'));
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
      setErr(
        e?.response?.data?.error ||
          e?.message ||
          t('addContactModal.failedToAdd', 'Failed to add contact.')
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t('addContactModal.title', 'Add contact')}
      radius="lg"
      centered
    >
      <Stack gap="sm">
        <TextInput
          label={t('addContactModal.phoneOrUsername', 'Phone or username')}
          placeholder={t(
            'addContactModal.phoneOrUsernamePlaceholder',
            'e.g. +13018019227 or juliannorton'
          )}
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
        />

        <TextInput
          label={t('addContactModal.alias', 'Alias (optional)')}
          placeholder={t(
            'addContactModal.aliasPlaceholder',
            'e.g. Work, Mom, Mike – Europe'
          )}
          value={alias}
          onChange={(e) => setAlias(e.currentTarget.value)}
        />

        {err && (
          <Text c="red" size="sm">
            {err}
          </Text>
        )}

        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" onClick={onClose} disabled={loading}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button onClick={submit} loading={loading}>
            {t('addContactModal.add', 'Add')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}