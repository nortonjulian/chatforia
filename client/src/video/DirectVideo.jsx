import { useEffect, useRef, useState } from 'react';
import { Box, Card, Group, TextInput, Button, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useCall } from '@/context/CallContext';
import axiosClient from '@/api/axiosClient';

export default function DirectVideo({
  currentUser,
  showHeader = true,
  navigateToJoin,
  initialPeerId,
  initialPhone,
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

  const startedPeerRef = useRef(null);

  useEffect(() => {
    if (initialPhone) {
      setPhone(initialPhone);
    }
  }, [initialPhone]);

  useEffect(() => {
    if (!initialPeerId || !currentUser?.id) return;

    const calleeId = Number(initialPeerId);

    if (!Number.isFinite(calleeId)) return;

    const callKey = `VIDEO:${calleeId}`;

    if (startedPeerRef.current === callKey) return;

    startedPeerRef.current = callKey;

    startCall({
      calleeId,
      mode: 'VIDEO',
    });
}, [initialPeerId, currentUser?.id, startCall]);

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
  const query = q.trim();

  if (!query) {
    setResults([]);
    return;
  }

  setLoading(true);

  try {
    const [contactsResult, usersResult] = await Promise.allSettled([
      axiosClient.get('/contacts', { params: { limit: 50 } }),
      axiosClient.get(`/users/search?query=${encodeURIComponent(query)}`),
    ]);

    const contactsData =
      contactsResult.status === 'fulfilled' ? contactsResult.value.data : [];

    const contacts = Array.isArray(contactsData)
      ? contactsData
      : Array.isArray(contactsData?.items)
        ? contactsData.items
        : [];

    const savedContactResults = contacts
      .filter((c) => {
        const text = [
          c.alias,
          c.user?.username,
          c.user?.name,
          c.externalName,
          c.externalPhone,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return text.includes(query.toLowerCase());
      })
      .map((c) => ({
        key: `contact-${c.id ?? c.userId ?? c.externalPhone}`,
        userId: c.userId || c.user?.id || null,
        name:
          c.alias ||
          c.user?.name ||
          c.user?.username ||
          c.externalName ||
          c.externalPhone ||
          'Saved contact',
        username: c.user?.username || '',
        phone: c.externalPhone || '',
        source: 'Saved contact',
      }));

    const usersData =
      usersResult.status === 'fulfilled' ? usersResult.value.data : [];

    const userResults = (Array.isArray(usersData) ? usersData : [])
      .filter((user) => user.id !== currentUser?.id)
      .map((user) => ({
        key: `user-${user.id}`,
        userId: user.id,
        name: user.name || user.username || `User ${user.id}`,
        username: user.username || '',
        phone: user.phoneNumber || '',
        source: 'Chatforia user',
      }));

    const seen = new Set();

    const merged = [...savedContactResults, ...userResults].filter((item) => {
      const dedupeKey = item.userId ? `user-${item.userId}` : item.key;

      if (seen.has(dedupeKey)) return false;

      seen.add(dedupeKey);
      return true;
    });

    setResults(merged);
  } catch (err) {
    console.error('[DirectVideo] search failed:', err);
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
              {results.map((u) => {
                const canVideo = Boolean(u.userId);

                return (
                  <Group
                    key={u.key}
                    justify="space-between"
                    p="xs"
                    style={{
                      border: '1px solid var(--mantine-color-gray-3)',
                      borderRadius: 10,
                    }}
                  >
                    <div>
                      <Text fw={600}>{u.name}</Text>

                      {u.username && (
                        <Text size="sm" c="dimmed">
                          @{u.username}
                        </Text>
                      )}

                      <Text size="xs" c="dimmed">
                        {u.source}
                      </Text>
                    </div>

                    <Button
                      variant="light"
                      disabled={!canVideo}
                      onClick={() => startCall({ calleeId: Number(u.userId), mode: 'VIDEO' })}
                    >
                      {canVideo
                        ? t('video.direct.callBtn', 'Call')
                        : t('contactList.videoRequiresAccount', 'Video requires account')}
                    </Button>
                  </Group>
                );
              })}
            </Stack>
          )}
        </Stack>
      </Card>
    </Box>
  );
}
