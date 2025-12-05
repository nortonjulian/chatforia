import { useEffect, useState } from 'react';
import { Box, Card, Group, TextInput, Button, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useCall } from '@/context/CallContext';
import axiosClient from '@/api/axiosClient';

export default function DirectVideo({
  currentUser,
  showHeader = true,
  navigateToJoin,
}) {
  const { t } = useTranslation();
  const { startCall } = useCall();

  // phone flow
  const [phone, setPhone] = useState('');
  const [calling, setCalling] = useState(false);

  // user search flow
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // reserved for future prefill logic (/video?peerId=...)
  }, []);

  async function callByPhone() {
    if (!phone.trim() || !currentUser) return;
    setCalling(true);
    try {
      // Backend should return either { calleeId } or { inviteCode }
      const { data } = await axiosClient.post('/calls/start-by-phone', {
        phone: phone.trim(),
        mode: 'VIDEO',
      });

      if (data?.calleeId) {
        await startCall({ calleeId: data.calleeId, mode: 'VIDEO' });
      } else if (data?.inviteCode) {
        // For join links, use injectable navigation for tests,
        // and fall back to window.location in the app.
        if (navigateToJoin) {
          navigateToJoin(data.inviteCode);
        } else if (typeof window !== 'undefined') {
          window.location.href = `/join/${data.inviteCode}`;
        }
      }
    } finally {
      setCalling(false);
    }
  }

  async function searchUsers() {
    if (!q.trim()) return;
    setLoading(true);
    try {
      const res = await axiosClient.get('/people', { params: { q } });
      setResults(Array.isArray(res.data) ? res.data : res.data?.results || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box p="md">
      {showHeader && (
        <>
          <Title order={2} mb={4}>
            {t('video.direct.title', 'Direct Video')}
          </Title>
          <Text c="dimmed" mb="lg">
            {t(
              'video.direct.subtitle',
              'Start a 1:1 video call using a phone number or Chatforia username.'
            )}
          </Text>
        </>
      )}

      {/* Call by phone */}
      <Card withBorder radius="lg" p="lg" mb="lg">
        <Stack gap="xs">
          <Text fw={600}>{t('video.direct.callByPhone.title', 'Call by phone')}</Text>
          <Group align="end" wrap="nowrap">
            <TextInput
              style={{ flex: 1 }}
              value={phone}
              onChange={(e) => setPhone(e.currentTarget.value)}
              // no label to avoid “Call by phone” + “Phone number” duplication
              placeholder={t(
                'video.direct.phone.placeholder',
                'Enter phone (e.g., +1-555-123-4567)'
              )}
              aria-label={t('video.direct.phone.aria', 'Phone to call')}
            />
            <Button
              onClick={callByPhone}
              loading={calling}
              disabled={!currentUser || !phone.trim()}
            >
              {t('video.direct.callBtn', 'Call')}
            </Button>
          </Group>
          <Text c="dimmed" size="xs">
            {t(
              'video.direct.tipInvite',
              'Tip: Paste a number and call without saving a contact. We’ll invite non-users by link.'
            )}
          </Text>
        </Stack>
      </Card>

      {/* Find a user */}
      <Card withBorder radius="lg" p="lg">
        <Stack gap="sm">
          <Text fw={600}>{t('video.direct.findUser.title', 'Find a user')}</Text>
          <Group align="end" wrap="nowrap">
            <TextInput
              style={{ flex: 1 }}
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
              // no label to avoid “Find a user” + “Search users” duplication
              placeholder={t('video.direct.search.placeholder', 'Search by name or username')}
              aria-label={t('video.direct.search.aria', 'Search by name or username')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') searchUsers();
              }}
            />
            <Button onClick={searchUsers} loading={loading} disabled={!currentUser}>
              {t('video.direct.search.btn', 'Search')}
            </Button>
          </Group>

          {results.length > 0 && (
            <Stack gap="xs" mt="xs">
              {results.map((u) => (
                <Group
                  key={u.id}
                  justify="space-between"
                  p="xs"
                  style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: 10 }}
                >
                  <div>
                    <Text fw={600}>{u.name || u.username || `User ${u.id}`}</Text>
                    {u.username && (
                      <Text size="sm" c="dimmed">
                        @{u.username}
                      </Text>
                    )}
                  </div>
                  <Button
                    variant="light"
                    onClick={() => startCall({ calleeId: u.id, mode: 'VIDEO' })}
                  >
                    {t('video.direct.callBtn', 'Call')}
                  </Button>
                </Group>
              ))}
            </Stack>
          )}
        </Stack>
      </Card>
    </Box>
  );
}
