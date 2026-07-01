import { useEffect, useRef, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  ThemeIcon,
} from '@mantine/core';
import { Phone, PhoneOff, UserPlus, Video } from 'lucide-react';
import { useCall } from '../../context/CallContext';
import AddCallParticipantModal from './AddCallParticipantModal';
import posthog from '@/utils/analytics';

export default function CallScreen() {
  const {
    active,
    status,
    localStream,
    remoteStream,
    endCall,
    participants = [],
    addParticipant,
    me,
  } = useCall();

  const [addOpen, setAddOpen] = useState(false);

  const localRef = useRef(null);
  const remoteRef = useRef(null);

  useEffect(() => {
    if (localRef.current && localStream?.current) {
      localRef.current.srcObject = localStream.current;
    }
  }, [active, localStream]);

  useEffect(() => {
    if (remoteRef.current && remoteStream?.current) {
      remoteRef.current.srcObject = remoteStream.current;
    }
  }, [active, remoteStream]);

  if (!active) return null;

  const isVideo = active.mode === 'VIDEO';

  const activeParticipants = participants.filter((p) =>
    ['RINGING', 'JOINED'].includes(p.status)
  );

  const existingParticipantIds = activeParticipants
    .map((p) => Number(p.userId))
    .filter(Boolean);

  const canAddPerson =
    active.mode === 'AUDIO' &&
    activeParticipants.length < 3 &&
    typeof addParticipant === 'function';

  const statusText =
    status ||
    (activeParticipants.some((p) => p.status === 'JOINED')
      ? 'In call'
      : 'Connecting…');

  const handleEndCall = () => {
    posthog.capture(
      active?.mode === 'VIDEO' ? 'video_call_ended' : 'voice_call_ended',
      {
        reason: 'hangup',
        mode: active?.mode,
      }
    );

    endCall('hangup');
  };

  return (
    <>
      <Box
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          background:
            'radial-gradient(circle at top, rgba(255, 183, 0, 0.12), transparent 32%), rgba(0, 0, 0, 0.88)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <Box
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {isVideo ? (
            <>
              <Box
                style={{
                  width: 'min(920px, 92vw)',
                  height: 'min(560px, 68vh)',
                  borderRadius: 24,
                  overflow: 'hidden',
                  background: '#050505',
                  boxShadow: '0 24px 80px rgba(0, 0, 0, 0.55)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                }}
              >
                <video
                  ref={remoteRef}
                  autoPlay
                  playsInline
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    background: '#000',
                  }}
                />

                <Stack
                  align="center"
                  gap={8}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    justifyContent: 'center',
                    color: 'white',
                    pointerEvents: 'none',
                  }}
                >
                  <ThemeIcon
                    size={56}
                    radius="xl"
                    variant="light"
                    color="yellow"
                  >
                    <Video size={26} />
                  </ThemeIcon>

                  <Text fw={700} size="lg">
                    Video call
                  </Text>

                  <Text size="sm" c="gray.4">
                    Waiting for video…
                  </Text>
                </Stack>
              </Box>

              <video
                ref={localRef}
                autoPlay
                muted
                playsInline
                style={{
                  position: 'absolute',
                  right: 28,
                  bottom: 96,
                  width: 210,
                  maxWidth: '28vw',
                  aspectRatio: '16 / 10',
                  objectFit: 'cover',
                  borderRadius: 16,
                  background: '#000',
                  border: '1px solid rgba(255, 255, 255, 0.16)',
                  boxShadow: '0 16px 40px rgba(0, 0, 0, 0.45)',
                }}
              />
            </>
          ) : (
            <Paper
              radius={28}
              p="xl"
              shadow="xl"
              style={{
                width: 'min(420px, 92vw)',
                background: 'rgba(255, 255, 255, 0.97)',
                textAlign: 'center',
                border: '1px solid rgba(255, 183, 0, 0.20)',
              }}
            >
              <Stack gap="md" align="center">
                <ThemeIcon size={76} radius="xl" variant="light" color="yellow">
                  <Phone size={34} />
                </ThemeIcon>

                <Stack gap={2} align="center">
                  <Text fw={800} size="xl">
                    Audio call
                  </Text>

                  <Text size="sm" c="dimmed">
                    {statusText}
                  </Text>
                </Stack>

                {activeParticipants.length > 0 && (
                  <Box w="100%">
                    <Group justify="center" gap={6} mb="xs">
                      <Text fw={600} size="sm">
                        Participants
                      </Text>

                      <Badge color="yellow" variant="light">
                        {activeParticipants.length}/3
                      </Badge>
                    </Group>

                    <Stack gap={6}>
                      {activeParticipants.map((participant) => (
                        <Group
                          key={participant.userId}
                          justify="space-between"
                          wrap="nowrap"
                          style={{
                            padding: '8px 10px',
                            borderRadius: 12,
                            background: 'rgba(255, 183, 0, 0.08)',
                          }}
                        >
                          <Text size="sm" fw={500}>
                            {participant.user?.displayName ||
                              participant.user?.name ||
                              participant.user?.username ||
                              `User ${participant.userId}`}
                          </Text>

                          <Badge size="sm" variant="light" color="yellow">
                            {participant.status}
                          </Badge>
                        </Group>
                      ))}
                    </Stack>
                  </Box>
                )}
              </Stack>
            </Paper>
          )}

          <Paper
            radius="xl"
            p={8}
            shadow="xl"
            style={{
              position: 'absolute',
              bottom: 24,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(255, 255, 255, 0.95)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
            }}
          >
            <Group gap="xs" justify="center" wrap="nowrap">
              {canAddPerson && (
                <Button
                  variant="light"
                  color="yellow"
                  radius="xl"
                  leftSection={<UserPlus size={16} />}
                  onClick={() => setAddOpen(true)}
                >
                  Add Person
                </Button>
              )}

              <Button
                color="red"
                radius="xl"
                leftSection={<PhoneOff size={16} />}
                onClick={handleEndCall}
              >
                End Call
              </Button>
            </Group>
          </Paper>
        </Box>
      </Box>

      <AddCallParticipantModal
        opened={addOpen}
        onClose={() => setAddOpen(false)}
        currentUser={me}
        existingParticipantIds={existingParticipantIds}
        onAdd={addParticipant}
      />
    </>
  );
}