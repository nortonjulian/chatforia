import { useEffect, useRef, useState } from 'react';
import { Box, Card, Group, TextInput, Button, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useCall } from '@/context/CallContext';
import axiosClient from '@/api/axiosClient';

export default function DirectVideo({
  currentUser,
  showHeader = true,
  initialPeerId,
}) {
  const { t } = useTranslation();
  const { startCall } = useCall();

  // user search flow
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const startedPeerRef = useRef(null);


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
      .filter((user) => Number(user.id) !== Number(currentUser?.id))
      .map((user) => ({
        key: `user-${user.id}`,
        userId: user.id,
        name: user.name || user.username || `User ${user.id}`,
        username: user.username || '',
        phone: user.phoneNumber || '',
        source: 'Chatforia user',
      }));

    const seen = new Set();

    const merged = [...savedContactResults, ...userResults]
      .filter((item) => item.userId)
      .filter((item) => {
        const dedupeKey = `user-${item.userId}`;

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

useEffect(() => {
  const query = q.trim();

  if (!query) {
    setResults([]);
    return;
  }

  const timer = setTimeout(() => {
    searchUsers();
  }, 300);

  return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [q]);

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
              'Start a 1:1 video call with another Chatforia user.'
            )}
          </Text>
        </>
      )}

      {/* Find a user */}
      <Card withBorder radius="lg" p="lg">
        <Stack gap="sm">
          <Text fw={600}>{t('video.direct.findUser.title', 'Find a Chatforia user')}</Text>
          <Group align="end" wrap="nowrap">
            <TextInput
              style={{ flex: 1 }}
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
              // no label to avoid “Find a user” + “Search users” duplication
              placeholder={t('video.direct.search.placeholder', 'Search by name or username')}
              aria-label={t('video.direct.search.aria', 'Search by name or username')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && q.trim() && !loading) {
                  searchUsers();
                }
              }}
            />
            <Button onClick={searchUsers} loading={loading} disabled={!q.trim() || loading}>
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
                      onClick={() =>
                        startCall({
                          calleeId: Number(u.userId),
                          mode: 'VIDEO',
                          peerName: u.name,
                        })
                      }
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
