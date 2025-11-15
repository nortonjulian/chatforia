import { useMemo, useState } from 'react';
import { ActionIcon, Tooltip } from '@mantine/core';
import { Phone, Video as VideoIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCall } from '@/context/CallContext';

export default function ChatHeaderActions({
  peerUser,
  isGroup = false,        // if true, treat as group room
  groupRoomSlug = '',     // optional: deep link target for group video
  enableDirectVideo = true,  // feature flag for 1:1 WebRTC video
}) {
  const navigate = useNavigate();
  const { startCall, active, incoming } = useCall();
  const [pending, setPending] = useState(false);

  const disabled = useMemo(() => {
    // disable while a call is ongoing or being set up
    return !!active || !!incoming || pending || !peerUser?.id;
  }, [active, incoming, pending, peerUser?.id]);

  if (!peerUser?.id) return null;

  async function startAudio() {
    try {
      setPending(true);
      await startCall({ calleeId: peerUser.id, mode: 'AUDIO' });
    } finally {
      setPending(false);
    }
  }

  async function startVideoDirect() {
    try {
      setPending(true);
      await startCall({ calleeId: peerUser.id, mode: 'VIDEO' });
    } finally {
      setPending(false);
    }
  }

  function goToGroupVideo() {
    // either navigate to hub or directly into a room
    const dest = groupRoomSlug ? `/video?room=${encodeURIComponent(groupRoomSlug)}` : '/video';
    navigate(dest);
  }

  return (
    <div className="flex items-center gap-2">
      {/* Audio (always 1:1) */}
      {!isGroup && (
        <Tooltip label="Audio call" withArrow>
          <ActionIcon
            variant="subtle"
            aria-label="Start audio call"
            onClick={startAudio}
            disabled={disabled}
          >
            <Phone size={18} />
          </ActionIcon>
        </Tooltip>
      )}

      {/* Video */}
      {isGroup ? (
        <Tooltip label="Start group video" withArrow>
          <ActionIcon
            variant="subtle"
            aria-label="Start group video"
            onClick={goToGroupVideo}
          >
            <VideoIcon size={18} />
          </ActionIcon>
        </Tooltip>
      ) : (
        enableDirectVideo && (
          <Tooltip label="Video call" withArrow>
            <ActionIcon
              variant="subtle"
              aria-label="Start video call"
              onClick={startVideoDirect}
              disabled={disabled}
            >
              <VideoIcon size={18} />
            </ActionIcon>
          </Tooltip>
        )
      )}
    </div>
  );
}
