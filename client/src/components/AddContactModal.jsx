import { useEffect, useMemo, useState } from 'react';
import { Avatar, Button, Group, Modal, Paper, Stack, Text, TextInput } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import axiosClient from '@/api/axiosClient';

export default function AddContactModal({ opened, onClose, currentUserId, onAdded }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [alias, setAlias] = useState('');
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState('');
  const [results, setResults] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);

  const trimmed = value.trim();
  const looksLikePhone = useMemo(
    () => trimmed.startsWith('+') || /^[\d\s().-]+$/.test(trimmed),
    [trimmed]
  );

  useEffect(() => {
    if (!opened || looksLikePhone || trimmed.length < 3 || selectedUser) {
      setResults([]);
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setErr('');
      try {
        const { data } = await axiosClient.get('/search/people', {
          params: { q: trimmed, limit: 12 },
        });
        if (cancelled) return;

        const users = (data?.items || []).filter(
          (item) =>
            item.kind === 'user' &&
            item.userId &&
            Number(item.userId) !== Number(currentUserId)
        );
        setResults(users);
      } catch (e) {
        if (!cancelled) {
          setResults([]);
          setErr(
            e?.response?.data?.error ||
              t('addContactModal.searchFailed', 'Could not search for people.')
          );
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [opened, trimmed, looksLikePhone, selectedUser, currentUserId, t]);

  const reset = () => {
    setValue('');
    setAlias('');
    setErr('');
    setResults([]);
    setSelectedUser(null);
    setSearching(false);
  };

  const close = () => {
    reset();
    onClose?.();
  };

  const submit = async () => {
    if (!trimmed) {
      setErr(t('addContactModal.enterPhoneOrUsername', 'Enter a phone number, name, or username.'));
      return;
    }

    if (!looksLikePhone && !selectedUser?.userId) {
      setErr(t('addContactModal.selectPerson', 'Select the person you want to save.'));
      return;
    }

    setErr('');
    setLoading(true);

    try {
      const payload = { alias: alias.trim() || null };

      if (looksLikePhone) {
        payload.externalPhone = trimmed;
      } else {
        payload.userId = Number(selectedUser.userId);
      }

      await axiosClient.post('/contacts', payload);
      reset();
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

  const canSubmit =
    !loading &&
    !!trimmed &&
    (looksLikePhone || !!selectedUser?.userId);

  return (
    <Modal
      opened={opened}
      onClose={close}
      title={t('addContactModal.title', 'Add contact')}
      radius="lg"
      centered
    >
      <Stack gap="sm">
        {!selectedUser ? (
          <>
            <TextInput
              label={t('addContactModal.phoneNameOrUsername', 'Phone, name, or username')}
              placeholder={t(
                'addContactModal.phoneNameOrUsernamePlaceholder',
                'Search by name or username, or enter a phone number'
              )}
              value={value}
              onChange={(e) => {
                setValue(e.currentTarget.value);
                setErr('');
              }}
            />

            {!looksLikePhone && trimmed.length > 0 && trimmed.length < 3 ? (
              <Text size="xs" c="dimmed">
                {t('addContactModal.searchMinChars', 'Enter at least 3 characters to search people.')}
              </Text>
            ) : null}

            {searching ? (
              <Text size="sm" c="dimmed">
                {t('common.searching', 'Searching…')}
              </Text>
            ) : null}

            {results.map((person) => (
              <Paper
                key={`user:${person.userId}`}
                withBorder
                radius="md"
                p="sm"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  setSelectedUser(person);
                  setResults([]);
                  setErr('');
                }}
              >
                <Group wrap="nowrap">
                  <Avatar src={person.avatarUrl || undefined} radius="xl">
                    {(person.displayName || person.username || '?').slice(0, 1).toUpperCase()}
                  </Avatar>
                  <div style={{ minWidth: 0 }}>
                    <Text fw={600} truncate>
                      {person.displayName || person.label || person.username}
                    </Text>
                    <Text size="sm" c="dimmed" truncate>
                      @{person.username}
                    </Text>
                  </div>
                </Group>
              </Paper>
            ))}
          </>
        ) : (
          <Paper withBorder radius="md" p="md">
            <Group wrap="nowrap" align="center">
              <Avatar src={selectedUser.avatarUrl || undefined} radius="xl" size="lg">
                {(selectedUser.displayName || selectedUser.username || '?').slice(0, 1).toUpperCase()}
              </Avatar>
              <div style={{ minWidth: 0, flex: 1 }}>
                <Text fw={700} truncate>
                  {selectedUser.displayName || selectedUser.label || selectedUser.username}
                </Text>
                <Text size="sm" c="dimmed" truncate>
                  @{selectedUser.username}
                </Text>
              </div>
              <Button
                variant="subtle"
                size="xs"
                onClick={() => {
                  setSelectedUser(null);
                  setValue('');
                }}
              >
                {t('common.change', 'Change')}
              </Button>
            </Group>
          </Paper>
        )}

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
          <Button variant="subtle" onClick={close} disabled={loading}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button onClick={submit} loading={loading} disabled={!canSubmit}>
            {t('addContactModal.add', 'Add')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
