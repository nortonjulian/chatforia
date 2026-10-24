import { useCallback, useEffect, useState } from 'react';
import { Button, Group, Modal, Paper, Stack, Text } from '@mantine/core';
import axiosClient from '../../api/axiosClient';
import { useTranslation } from 'react-i18next';

function errorText(error, fallback) {
  return error?.response?.data?.message || error?.response?.data?.error || error?.message || fallback;
}

export default function BlockedAccountsPanel() {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingUnblock, setPendingUnblock] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await axiosClient.get('/blocks');
      if (!Array.isArray(data?.items)) throw new Error('Invalid blocked accounts response');
      setItems(data.items);
    } catch (err) {
      setError(errorText(err, 'Could not load blocked accounts.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function unblock(item) {
    if (!item || busyId !== null) return;
    setBusyId(item.userId);
    setError('');
    setNotice('');
    try {
      const { data } = await axiosClient.delete(`/blocks/${item.userId}`);
      if (!data?.success) throw new Error('Unblock was not confirmed by server');
      setItems((previous) => previous.filter((x) => x.userId !== item.userId));
      setPendingUnblock(null);
      setNotice(t('profile.accountUnblocked', 'Account unblocked.'));
    } catch (err) {
      setError(errorText(err, 'Could not unblock account.'));
    } finally {
      setBusyId(null);
    }
  }

  const pendingName = pendingUnblock?.displayName || pendingUnblock?.username ||
    (pendingUnblock ? `User #${pendingUnblock.userId}` : '');

  return (
    <Paper withBorder radius="lg" p="md">
      <Stack gap="sm">
        <Group justify="space-between" align="center">
          <Text fw={600}>{t('profile.blockedChatforiaAccounts', 'Blocked Chatforia accounts')}</Text>
          <Button size="xs" variant="subtle" onClick={refresh} disabled={loading || busyId !== null}>
            {t('common.refresh', 'Refresh')}
          </Button>
        </Group>
        <Text size="sm" c="dimmed">
          {t('profile.blockedAccountsInfo', 'You can unblock accounts here. Blocking does not erase your message history.')}
        </Text>
        {loading ? <Text size="sm">{t('common.loading', 'Loading…')}</Text>
          : items.length === 0 ? <Text size="sm" c="dimmed">{t('profile.noBlockedAccounts', 'No blocked accounts.')}</Text>
          : <Stack gap="xs">{items.map((item) => (
            <Group key={item.userId} justify="space-between" wrap="wrap">
              <Text size="sm">{item.displayName || item.username || `User #${item.userId}`}{item.username ? ` (@${item.username})` : ''}</Text>
              <Button size="xs" color="red" variant="light" disabled={busyId !== null}
                loading={busyId === item.userId} onClick={() => { setError(''); setPendingUnblock(item); }}>
                {t('common.unblock', 'Unblock')}
              </Button>
            </Group>
          ))}</Stack>}
        {!pendingUnblock && error && <Text role="alert" size="sm" c="red">{error}</Text>}
        {notice && <Text role="status" size="sm">{notice}</Text>}
      </Stack>
      <Modal
        opened={Boolean(pendingUnblock)}
        onClose={() => {
          if (busyId === null) { setPendingUnblock(null); setError(''); }
        }}
        title={t('profile.unblockAccountDialogTitle', 'Unblock Chatforia account?')}
        centered
        size="sm"
        radius="lg"
        closeOnClickOutside={busyId === null}
        closeOnEscape={busyId === null}
        withCloseButton={busyId === null}
      >
        <Stack gap="md">
          <Text size="sm">
            {t('profile.unblockAccountPrompt', 'Remove your block on')}{' '}
            <strong>{pendingName}</strong>?
          </Text>
          <Text size="sm" c="dimmed">
            {t('profile.unblockAccountConsequences',
              'They may be able to message and call you again if they have not blocked you. Your message history will remain.')}
          </Text>
          {error && <Text role="alert" size="sm" c="red">{error}</Text>}
          <Group justify="flex-end" gap="sm">
            <Button variant="default" disabled={busyId !== null} onClick={() => { setPendingUnblock(null); setError(''); }}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button loading={busyId !== null} disabled={!pendingUnblock} onClick={() => void unblock(pendingUnblock)}>
              {t('profile.unblockAccountAction', 'Unblock account')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
  );
}
