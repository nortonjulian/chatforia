import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Modal, Group, Button, Text, Avatar, Stack } from '@mantine/core';

// NOTE: filenames/paths align with your project
import socket from '../lib/socket';
import { playSound, unlockAudio } from '../lib/sounds';
import { getVolume, messageToneUrl, ringtoneUrl } from '../utils/sounds';
import { useUser } from '../context/UserContext';

const CallContext = createContext(null);
export function useCall() {
  return useContext(CallContext);
}

/**
 * Centralized call manager:
 * - Listens for incoming_call / cancelled / ended
 * - Can start outgoing calls
 * - Plays ringtone (loop) and stops it on accept/decline/cancel
 * - Exposes a context API (startCall/accept/decline/end + state)
 */
export default function CallManager({ children }) {
  const { currentUser } = useUser();
  const [incoming, setIncoming] = useState(null); // { fromUser, roomId }
  const [outgoing, setOutgoing] = useState(null); // { toUser, ringing }
  const [inCall, setInCall] = useState(null);     // { peer, roomId }
  const ringRef = useRef(null);
  const vol = getVolume();

  // Ensure audio is allowed to play after first click/tap
  useEffect(() => {
    const handler = () => unlockAudio();
    window.addEventListener('click', handler, { once: true });
    window.addEventListener('touchstart', handler, { once: true });
    return () => {
      window.removeEventListener('click', handler);
      window.removeEventListener('touchstart', handler);
    };
  }, []);

  // --- Helpers to control ringtone ---
  const stopRinging = useCallback(() => {
    if (ringRef.current) {
      try {
        ringRef.current.pause();
        ringRef.current.currentTime = 0;
      } catch {}
      ringRef.current = null;
    }
  }, []);

  const startRinging = useCallback(() => {
    stopRinging();
    ringRef.current = playSound(ringtoneUrl(), { volume: vol, loop: true });
  }, [stopRinging, vol]);

  // --- Incoming call events ---
  useEffect(() => {
    function onIncoming({ fromUser, roomId }) {
      setIncoming({ fromUser, roomId });
      startRinging();
    }
    function onCallCancelled() {
      stopRinging();
      setIncoming(null);
    }
    function onCallEnded() {
      stopRinging();
      setIncoming(null);
      setOutgoing(null);
      setInCall(null);
    }
    function onCallAnsweredElsewhere() {
      stopRinging();
      setIncoming(null);
    }

    socket.on('incoming_call', onIncoming);
    socket.on('call_cancelled', onCallCancelled);
    socket.on('call_ended', onCallEnded);
    socket.on('call_answered_elsewhere', onCallAnsweredElsewhere);

    return () => {
      socket.off('incoming_call', onIncoming);
      socket.off('call_cancelled', onCallCancelled);
      socket.off('call_ended', onCallEnded);
      socket.off('call_answered_elsewhere', onCallAnsweredElsewhere);
    };
  }, [startRinging, stopRinging]);

  // --- Outgoing call events ---
  useEffect(() => {
    function onCallAccepted({ peerUser, roomId }) {
      stopRinging();
      setInCall({ peer: peerUser, roomId });
      setOutgoing(null);
    }
    function onCallRejected() {
      stopRinging();
      setOutgoing(null);
    }

    socket.on('call_accepted', onCallAccepted);
    socket.on('call_rejected', onCallRejected);

    return () => {
      socket.off('call_accepted', onCallAccepted);
      socket.off('call_rejected', onCallRejected);
    };
  }, [stopRinging]);

  // --- Public API (start/accept/decline/end) ---
  const startCall = useCallback(
    (toUser) => {
      if (!toUser?.id || !currentUser?.id) return;
      setOutgoing({ toUser, ringing: true });
      startRinging(); // ringback
      socket.emit('start_call', { toUserId: toUser.id });
    },
    [currentUser?.id, startRinging]
  );

  const acceptCall = useCallback(() => {
    if (!incoming?.fromUser) return;
    stopRinging();
    socket.emit('accept_call', {
      fromUserId: incoming.fromUser.id,
      roomId: incoming.roomId,
    });
    setInCall({ peer: incoming.fromUser, roomId: incoming.roomId });
    setIncoming(null);
  }, [incoming, stopRinging]);

  const declineCall = useCallback(() => {
    if (!incoming?.fromUser) return;
    stopRinging();
    socket.emit('reject_call', { fromUserId: incoming.fromUser.id });
    setIncoming(null);
  }, [incoming, stopRinging]);

  const endCall = useCallback(() => {
    if (!inCall?.peer) return;
    socket.emit('end_call', { peerUserId: inCall.peer.id, roomId: inCall.roomId });
    setInCall(null);
  }, [inCall]);

  // --- Optional: play message tone globally on non-focused/new messages ---
  useEffect(() => {
    function onAnyMessage(msg) {
      const isMine = msg?.senderId === currentUser?.id;
      const tabHidden = document.hidden;
      if (!isMine && tabHidden) {
        playSound(messageToneUrl(), { volume: vol });
      }
    }
    socket.on('receive_message', onAnyMessage);
    return () => socket.off('receive_message', onAnyMessage);
  }, [currentUser?.id, vol]);

  const value = useMemo(
    () => ({
      startCall,
      acceptCall,
      declineCall,
      endCall,
      incoming,
      outgoing,
      inCall,
    }),
    [startCall, acceptCall, declineCall, endCall, incoming, outgoing, inCall]
  );

  return (
    <CallContext.Provider value={value}>
      {/* ensure children are rendered inside the provider so tests can mount triggers */}
      {children}

      <Modal
        opened={!!incoming}
        onClose={() => setIncoming(null)}
        withCloseButton={false}
        centered
        title="Incoming call"
      >
        {incoming && (
          <Stack align="center" gap="sm">
            <Avatar size="lg" radius="xl" src={incoming.fromUser?.avatarUrl} />
            <Text fw={600}>{incoming.fromUser?.username || 'Unknown user'}</Text>
            <Group mt="xs">
              <Button color="green" onClick={acceptCall}>
                Accept
              </Button>
              <Button variant="outline" color="red" onClick={declineCall}>
                Decline
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      {inCall && (
        <div
          style={{
            position: 'fixed',
            bottom: 16,
            right: 16,
            background: 'var(--mantine-color-dark-7)',
            color: 'white',
            borderRadius: 12,
            padding: '8px 12px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            zIndex: 9999,
          }}
        >
          <Group gap="sm" align="center">
            <Avatar size="sm" radius="xl" src={inCall.peer?.avatarUrl} />
            <Text size="sm">In call with {inCall.peer?.username}</Text>
            <Button size="xs" color="red" onClick={endCall}>
              End
            </Button>
          </Group>
        </div>
      )}
    </CallContext.Provider>
  );
}
