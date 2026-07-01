import { useEffect, useRef, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Group,
  Paper,
  Stack,
  Text,
} from '@mantine/core';
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
          background: 'rgba(0, 0, 0, 0.9)',
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
          {/* Remote media */}
          <video
            ref={remoteRef}
            autoPlay
            playsInline
            style={{
              display: isVideo ? 'block' : 'none',
              maxWidth: '100%',
              maxHeight: '80vh',
              borderRadius: 16,
              background: '#000',
            }}
          />

          {/* Audio call UI */}
          {!isVideo && (
            <Paper
              radius="xl"
              p="xl"
              shadow="xl"
              style={{
                minWidth: 320,
                maxWidth: 460,
                background: 'rgba(255, 255, 255, 0.96)',
                textAlign: 'center',
              }}
            >
              <Stack gap="md" align="center">
                <Text fw={700} size="xl">
                  Audio call
                  {status ? ` — ${status}` : ''}
                </Text>

                {activeParticipants.length > 0 && (
                  <Box w="100%">
                    <Text fw={600} mb="sm">
                      Participants ({activeParticipants.length}/3)
                    </Text>

                    <Stack gap="xs">
                      {activeParticipants.map((participant) => (
                        <Group
                          key={participant.userId}
                          justify="space-between"
                          wrap="nowrap"
                        >
                          <Text size="sm">
                            {participant.user?.displayName ||
                              participant.user?.name ||
                              participant.user?.username ||
                              `User ${participant.userId}`}
                          </Text>

                          <Badge variant="light" color="yellow">
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

          {/* Local video preview */}
          <video
            ref={localRef}
            autoPlay
            muted
            playsInline
            style={{
              display: isVideo ? 'block' : 'none',
              position: 'absolute',
              right: 24,
              bottom: 24,
              width: 192,
              maxWidth: '28vw',
              borderRadius: 12,
              background: '#000',
              boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
            }}
          />

          {/* Call controls */}
          <Group
            gap="sm"
            justify="center"
            style={{
              position: 'absolute',
              bottom: 24,
              left: '50%',
              transform: 'translateX(-50%)',
            }}
          >
            {canAddPerson && (
              <Button
                variant="light"
                color="yellow"
                radius="xl"
                size="md"
                onClick={() => setAddOpen(true)}
              >
                Add Person
              </Button>
            )}

            <Button
              color="red"
              radius="xl"
              size="md"
              onClick={handleEndCall}
            >
              End Call
            </Button>
          </Group>
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