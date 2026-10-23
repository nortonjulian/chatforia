import { useCallback, useEffect, useState } from 'react';
import { Button, Group, Paper, Stack, Text } from '@mantine/core';
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
    const title = item.displayName || item.username || `User #${item.userId}`;
    if (!window.confirm(t('profile.unblockAccountConfirm', `Unblock ${title}?`))) return;
    setBusyId(item.userId);
    setError('');
    setNotice('');
    try {
      const { data } = await axiosClient.delete(`/blocks/${item.userId}`);
      if (!data?.success) throw new Error('Unblock was not confirmed by server');
      setItems((previous) => previous.filter((x) => x.userId !== item.userId));
      setNotice(t('profile.accountUnblocked', 'Account unblocked.'));
    } catch (err) {
      setError(errorText(err, 'Could not unblock account.'));
    } finally {
      setBusyId(null);
    }
  }

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
                loading={busyId === item.userId} onClick={() => unblock(item)}>
                {t('common.unblock', 'Unblock')}
              </Button>
            </Group>
          ))}</Stack>}
        {error && <Text role="alert" size="sm" c="red">{error}</Text>}
        {notice && <Text role="status" size="sm">{notice}</Text>}
      </Stack>
    </Paper>
  );
}
