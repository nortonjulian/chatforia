import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Group,
  Modal,
  Stack,
  Text,
} from '@mantine/core';
import {
  notifications,
} from '@mantine/notifications';
import { useCall } from '../context/CallContext';
import { DEFAULTS, getRingtone, getVolume, listRingtones, ringtoneUrl } from '../utils/sounds';
import { startVideoRingtone } from '../utils/videoRingtone';

export default function IncomingCallModal() {
  const call = useCall();

  /*
   * Keep hooks unconditional so an incoming call can safely
   * appear after the component's initial render.
   */
  const [pending, setPending] =
    useState(null);

  const incoming =
    call?.incoming;

  const ringerRef = useRef(null);
  const ringtoneOwnerRef = useRef(null);
  const [ringtoneStatus, setRingtoneStatus] = useState(null);
  const videoCallId = incoming?.mode?.toUpperCase() === 'VIDEO' && incoming.callId != null
    ? String(incoming.callId) : null;
  const accountId = call?.me?.id;
  const plan = call?.me?.plan;
  const active = !!call?.active;

  useEffect(() => {
    setRingtoneStatus(null);
    if (!videoCallId) { ringtoneOwnerRef.current = null; return; }
    if (!accountId || active || pending != null) return;
    if (ringtoneOwnerRef.current?.callId !== videoCallId) {
      ringtoneOwnerRef.current = { callId: videoCallId, accountId };
    }
    if (ringtoneOwnerRef.current.accountId !== accountId) return;
    let ringer;
    try {
      const selected = getRingtone();
      const allowed = listRingtones(plan);
      const filename = allowed.some(option => option.value === selected) ? selected : DEFAULTS.ringtone;
      ringer = startVideoRingtone({ src: ringtoneUrl(filename), volume: getVolume(), onStatus: setRingtoneStatus });
      ringerRef.current = ringer;
    } catch { setRingtoneStatus('error'); }
    return () => {
      ringer?.stop();
      if (ringerRef.current === ringer) ringerRef.current = null;
    };
  }, [videoCallId, accountId, plan, active, pending]);

  if (!call || !incoming) {
    return null;
  }

  const {
    acceptCall,
    rejectCall,
    accept,
    reject,
    onAccept,
    onReject,
  } = call;

  const doAccept =
    acceptCall ||
    accept ||
    onAccept;

  const doReject =
    rejectCall ||
    reject ||
    onReject;

  const callerName =
    incoming.callerName ||
    incoming.fromUser?.displayName ||
    incoming.fromUser?.name ||
    incoming.fromUser?.username ||
    (
      incoming.fromUser?.id
        ? `User ${incoming.fromUser.id}`
        : 'Unknown caller'
    );

  const isVideo =
    incoming.mode?.toUpperCase() === 'VIDEO';

  const handleAccept = async () => {
    if (pending != null) return;

    ringerRef.current?.stop();
    setPending('accept');

    try {
      await doAccept?.();
    } catch (error) {
      notifications.show({
        color: 'red',
        title:
          'Could not answer call',
        message:
          error?.response?.data
            ?.message ||
          error?.message ||
          'Failed to accept call.',
        withBorder: true,
      });
    } finally {
      setPending(null);
    }
  };

  const handleReject = async () => {
    if (pending != null) return;

    ringerRef.current?.stop();
    setPending('reject');

    try {
      await doReject?.();
    } catch (error) {
      notifications.show({
        color: 'red',
        title:
          'Could not decline call',
        message:
          error?.response?.data
            ?.message ||
          error?.message ||
          'Failed to decline call.',
        withBorder: true,
      });
    } finally {
      setPending(null);
    }
  };

  return (
    <Modal
      opened
      onClose={() => {}}
      title={
        isVideo
          ? 'Incoming video call'
          : 'Incoming audio call'
      }
      centered
      withCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
      overlayProps={{
        backgroundOpacity: 0.72,
        blur: 4,
      }}
    >
      <Stack gap="lg">
        <Stack gap={4}>
          <Text size="sm" c="dimmed">
            Incoming call from
          </Text>

          <Text fw={700} size="lg">
            {callerName}
          </Text>

          <Text size="sm" c="dimmed">
            {isVideo
              ? 'Answer to join the video call.'
              : 'Answer to join the audio call.'}
          </Text>
        </Stack>

        {isVideo && ['blocked', 'error'].includes(ringtoneStatus) && pending == null && (
          ringerRef.current ? (
            <Button variant="light" onClick={() => ringerRef.current?.retry()}>
              {ringtoneStatus === 'blocked' ? 'Enable ringing' : 'Retry ringtone'}
            </Button>
          ) : <Text size="sm" c="dimmed">Ringtone could not play.</Text>
        )}

        <Group
          justify="flex-end"
          gap="sm"
        >
          <Button
            variant="default"
            onClick={handleReject}
            loading={
              pending === 'reject'
            }
            disabled={pending != null}
            data-testid="decline"
          >
            Decline
          </Button>

          <Button
            color="yellow"
            onClick={handleAccept}
            loading={
              pending === 'accept'
            }
            disabled={pending != null}
            data-testid="accept"
          >
            Accept
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
