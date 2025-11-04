import { useEffect, useMemo, useState } from 'react';
import { Select, Group, Button, Stack, Title, Divider, Text } from '@mantine/core';
import { IconPlayerPlay } from '@tabler/icons-react';
import {
  listMessageTones,
  listRingtones,
  getMessageTone,
  setMessageTone,
  getRingtone,
  setRingtone,
  getVolume,
  messageToneUrl,
  ringtoneUrl,
} from '@/utils/sounds';
import { toast } from '@/utils/toast';

function play(url, vol = 0.7) {
  try {
    const audio = new Audio(url);
    audio.volume = Math.min(1, Math.max(0, vol));
    // Don’t await; fire-and-forget for quick preview
    audio.play().catch(() => {});
  } catch {
    // ignore
  }
}

export default function ProfileSounds({ currentUser }) {
  const plan = (currentUser?.plan || 'FREE').toUpperCase();

  // Initial values from localStorage (or defaults inside helpers)
  const [messageTone, setMessageToneState] = useState(getMessageTone());
  const [ringtone, setRingtoneState] = useState(getRingtone());

  // Options depend on plan
  const messageToneOptions = useMemo(() => listMessageTones(plan), [plan]);
  const ringtoneOptions = useMemo(() => listRingtones(plan), [plan]);

  // When plan changes (e.g., after upgrade), ensure stored values are valid
  useEffect(() => {
    const allowedMsg = messageToneOptions.some(o => o.value === messageTone);
    if (!allowedMsg) {
      const fallback = messageToneOptions[0]?.value;
      if (fallback) {
        setMessageTone(fallback);
        setMessageToneState(fallback);
      }
    }
    const allowedRing = ringtoneOptions.some(o => o.value === ringtone);
    if (!allowedRing) {
      const fallback = ringtoneOptions[0]?.value;
      if (fallback) {
        setRingtone(fallback);
        setRingtoneState(fallback);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]); // run when plan flips FREE↔PREMIUM

  return (
    <Stack gap="md">
      <Title order={4}>Sounds</Title>
      <Text c="dimmed" fz="sm">
        Choose your notification sounds. Selections are stored on this device.
      </Text>

      <Group align="end" justify="space-between" wrap="wrap">
        <Select
          label="Message tone"
          data={messageToneOptions}             
          value={messageTone}                   // 'Default.mp3'
          onChange={(val) => {
            if (!val) return;
            setMessageTone(val);
            setMessageToneState(val);
            toast.ok('Message tone saved.');
          }}
          w={360}
        />
        <Button
          variant="light"
          leftSection={<IconPlayerPlay size={16} />}
          onClick={() => play(messageToneUrl(messageTone), getVolume())}
        >
          Preview
        </Button>
      </Group>

      <Group align="end" justify="space-between" wrap="wrap">
        <Select
          label="Ringtone"
          data={ringtoneOptions}
          value={ringtone}                     
          onChange={(val) => {
            if (!val) return;
            setRingtone(val);
            setRingtoneState(val);
            toast.ok('Ringtone saved.');
          }}
          w={360}
        />
        <Button
          variant="light"
          leftSection={<IconPlayerPlay size={16} />}
          onClick={() => play(ringtoneUrl(ringtone), getVolume())}
        >
          Preview
        </Button>
      </Group>

      <Divider my="sm" />

      <Text fz="xs" c="dimmed">
        Tip: Premium unlocks the full catalog. Free plan shows a limited set.
      </Text>
    </Stack>
  );
}
