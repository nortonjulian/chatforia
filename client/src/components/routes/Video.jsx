import { useState, useMemo, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, Button, Group, Stack, Text, Title, Box, TextInput } from '@mantine/core';
import { Video, Users as UsersIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DirectVideo from '@/video/DirectVideo.jsx';
import VideoCall from '@/video/VideoCall.jsx';

export default function VideoHub({ currentUser }) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const identity = useMemo(
    () => String(currentUser?.id || ''),
    [currentUser?.id]
  );

  // Deep-links:
  const deepRoom = params.get('room');         // /video?room=standup -> Rooms flow
  const deepDirectUser = params.get('peerId'); // /video?peerId=123   -> Direct flow

  const [mode, setMode] = useState(
    deepRoom ? 'rooms' : (deepDirectUser ? 'direct' : 'choose')
  );

  // Rooms state (now inlined)
  const [room, setRoom] = useState(deepRoom || '');
  const [joined, setJoined] = useState(!!deepRoom);

  useEffect(() => {
    if (deepRoom) {
      setMode('rooms');
      setRoom(deepRoom);
      setJoined(true);
    }
  }, [deepRoom]);

  const handleJoin = () => {
    if (!room) return;
    setJoined(true);
    navigate(`/video?room=${encodeURIComponent(room)}`);
  };

  // Direct (1:1) deep link: show DirectVideo prefilled
  if (mode === 'direct') {
    return (
      <Box p="md">
        <Title order={3} mb="sm">
          {t('video.direct.title', 'Direct Video')}
        </Title>
        <Text c="dimmed" mb="md">
          {t(
            'video.direct.subtitle',
            'Start a 1:1 video call using a phone number or Chatforia username.'
          )}
        </Text>
        <DirectVideo
          currentUser={currentUser}
          showHeader={false}
          // 🔧 Pass peerId through as initialPeerId so tests (and UX) match
          initialPeerId={deepDirectUser || undefined}
        />
      </Box>
    );
  }

  // Rooms flow (with inline joiner)
  if (mode === 'rooms') {
    return (
      <Box p="md">
        <Title order={3} mb="sm">
          {t('video.rooms.title', 'Rooms')}
        </Title>
        <Text c="dimmed" mb="md">
          {t(
            'video.rooms.subtitle',
            'Create a room or join an existing one by typing the same name.'
          )}
        </Text>

        {!joined ? (
          <Stack gap="sm" maw={520}>
            <Group align="end">
              <TextInput
                label={t('video.rooms.roomLabel', 'Room name')}
                placeholder={t(
                  'video.rooms.roomPlaceholder',
                  'e.g. team-standup'
                )}
                value={room}
                onChange={(e) => setRoom(e.currentTarget.value)}
                style={{ flex: 1 }}
                aria-label={t('video.rooms.roomAria', 'Room name')}
              />
              <Button onClick={handleJoin} disabled={!room}>
                {t('video.rooms.joinCreate', 'Join / Create')}
              </Button>
            </Group>
            <Text c="dimmed" size="xs">
              {t(
                'video.rooms.tip',
                'Tip: share this name with others, or deep link to'
              )}{' '}
              <code>/video?room=room-name</code>.
            </Text>
          </Stack>
        ) : (
          <VideoCall
            identity={identity}
            room={room}
            onEnd={() => {
              setJoined(false);
              setRoom('');
              navigate('/video');
            }}
          />
        )}
      </Box>
    );
  }

  // Choice screen
  return (
    <Box p="md">
      <Title order={3} mb="sm">
        {t('video.hub.title', 'Video')}
      </Title>
      <Text c="dimmed" mb="lg">
        {t('video.hub.subtitle', 'Choose a video type.')}
      </Text>

      <Group grow align="stretch">
        <Card withBorder radius="lg" p="lg">
          <Stack gap="xs">
            <Group gap="sm">
              <Video size={18} />
              <Text fw={600}>
                {t('video.direct.title', 'Direct Video')}
              </Text>
            </Group>
            <Text c="dimmed" size="sm">
              {t(
                'video.direct.desc',
                '1:1 camera call with another user.'
              )}
            </Text>
            <Button onClick={() => setMode('direct')} mt="sm">
              {t('video.direct.start', 'Start')}
            </Button>
          </Stack>
        </Card>

        <Card withBorder radius="lg" p="lg">
          <Stack gap="xs">
            <Group gap="sm">
              <UsersIcon size={18} />
              <Text fw={600}>{t('video.rooms.title', 'Rooms')}</Text>
            </Group>
            <Text c="dimmed" size="sm">
              {t(
                'video.rooms.desc',
                'Multi-party video using a shared room name.'
              )}
            </Text>
            <Button
              onClick={() => {
                setMode('rooms');
                setJoined(false);
                if (!deepRoom) setRoom('');
              }}
              mt="sm"
            >
              {t('video.rooms.joinCreate', 'Join / Create')}
            </Button>
          </Stack>
        </Card>
      </Group>
    </Box>
  );
}
