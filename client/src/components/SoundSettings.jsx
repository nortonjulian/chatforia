import { useEffect, useMemo, useState } from 'react';
import { Group, Select, Slider, Button, Stack, Text, Alert, Anchor, Divider } from '@mantine/core';
import { useNavigate } from 'react-router-dom';

import { useUser } from '../context/UserContext';
// import { toast } from '../utils/toast';
import axiosClient from '../api/axiosClient';

// OLD helper kept for non-preview SFX; not used for previews anymore
// import { playSound } from '../lib/sounds';

// NEW: singleton preview controller
import {
  playPreview,
  stopPreview,
  subscribePreview,
  isPreviewing,
  previewLabel,
} from '../lib/sounds';

import {
  // catalogs & config
  ALL_MESSAGE_TONES,
  ALL_RINGTONES,
  premiumConfig,
  DEFAULTS,
  // plan-aware lists
  listMessageTones,
  listRingtones,
  // local prefs + url builders
  getMessageTone,
  setMessageTone,
  getRingtone,
  setRingtone,
  getVolume,
  setVolume,
  messageToneUrl,
  ringtoneUrl,
} from '../utils/sounds';

/* -----------------------------------------------------------
 * Helpers (grouped options, selection guards)
 * --------------------------------------------------------- */

// Build grouped options so Free users can *see* Premium (disabled) with a ⭐
function buildGroupedOptions(kind, isPremium) {
  const all =
    kind === 'message'
      ? ALL_MESSAGE_TONES
      : ALL_RINGTONES;

  const freeList =
    kind === 'message'
      ? premiumConfig.tones.freeMessageTones
      : premiumConfig.tones.freeRingtones;

  const freeSet = new Set(freeList);

  const freeItems = [];
  const premiumItems = [];

  for (const opt of all) {
    const isFree = freeSet.has(opt.value);
    const row = {
      value: opt.value,
      label: isFree ? opt.label : `⭐ ${opt.label}`,
      disabled: !isFree && !isPremium, // lock premium for Free plan
    };
    (isFree ? freeItems : premiumItems).push(row);
  }

  return [
    { group: 'Free', items: freeItems },
    { group: 'Premium', items: premiumItems },
  ];
}

function ensureValidSelection(value, groupedOptions, plan) {
  if (!value) return null;
  const isPremium = plan === 'PREMIUM';
  const flat = groupedOptions.flatMap((g) => g.items);
  const found = flat.find((x) => x.value === value);
  if (!found) return null;
  if (found.disabled && !isPremium) return null;
  return value;
}

/* -----------------------------------------------------------
 * Component
 * --------------------------------------------------------- */

export default function SoundSettings() {
  const { currentUser } = useUser();
  const navigate = useNavigate();

  const plan = String(currentUser?.plan || 'FREE').toUpperCase();
  const isPremium = plan === 'PREMIUM';

  // Local state from stored prefs (helpers coerce unknowns)
  const [messageTone, setMsg] = useState(getMessageTone());
  const [ringtone, setRing] = useState(getRingtone());
  const [volume, setVol] = useState(getVolume());
  const [saving, setSaving] = useState(false);

  // Preview UI state from singleton
  const [previewState, setPreviewState] = useState({
    playing: isPreviewing(),
    label: previewLabel(),
  });

  useEffect(() => {
    const unsub = subscribePreview(setPreviewState);
    return unsub;
  }, []);

  // a) Grouped (for UI) — shows Free + Premium (disabled for Free)
  const groupedMessage = useMemo(() => buildGroupedOptions('message', isPremium), [isPremium]);
  const groupedRing = useMemo(() => buildGroupedOptions('ring', isPremium), [isPremium]);

  // b) Plan-aware flat lists (for fallbacks & coercion)
  const allowedMessages = useMemo(() => listMessageTones(plan), [plan]);
  const allowedRings = useMemo(() => listRingtones(plan), [plan]);

  // Keep selections valid when plan or catalogs change
  useEffect(() => {
    let nextMsg = ensureValidSelection(messageTone, groupedMessage, plan);
    if (!nextMsg) nextMsg = allowedMessages[0]?.value || DEFAULTS.messageTone;
    if (nextMsg !== messageTone) {
      setMessageTone(nextMsg);
      setMsg(nextMsg);
    }

    let nextRing = ensureValidSelection(ringtone, groupedRing, plan);
    if (!nextRing) nextRing = allowedRings[0]?.value || DEFAULTS.ringtone;
    if (nextRing !== ringtone) {
      setRingtone(nextRing);
      setRing(nextRing);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, groupedMessage, groupedRing, allowedMessages, allowedRings]);

  const onSave = async () => {
    try {
      setSaving(true);

      // Always persist locally
      setMessageTone(messageTone);
      setRingtone(ringtone);
      setVolume(volume);

      // Try server save (optional; ignore if endpoint doesn’t exist)
      try {
        await axiosClient.post('/settings/tones', {
          messageTone,
          ringtone,
          volume,
        });
      } catch (e) {
        const status = e?.response?.status;
        const code = e?.response?.data?.code;
        if (status === 402 || code === 'PREMIUM_REQUIRED') {
          toast.err('Premium required for that selection.');
          return navigate('/settings/upgrade');
        }
        // If 404 or not implemented, just ignore silently and use local
      }

      toast.ok('Sound settings saved.');
    } catch {
      toast.err('Could not save sound settings.');
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = () => {
    setMsg(DEFAULTS.messageTone);
    setRing(DEFAULTS.ringtone);
    setVol(DEFAULTS.volume);
    toast.info('Reset to defaults (not yet saved).');
  };

  // Preview lengths (tweak to taste)
  const MESSAGE_PREVIEW_SECONDS = 3;
  const RING_PREVIEW_SECONDS = 7;

  const handleMessagePreview = () => {
    if (previewState.playing && previewState.label === 'message') {
      stopPreview();
      return;
    }
    playPreview(
      messageToneUrl(messageTone),
      { seconds: MESSAGE_PREVIEW_SECONDS, volume, label: 'message' }
    );
  };

  const handleRingPreview = () => {
    if (previewState.playing && previewState.label === 'ring') {
      stopPreview();
      return;
    }
    playPreview(
      ringtoneUrl(ringtone),
      { seconds: RING_PREVIEW_SECONDS, volume, label: 'ring' }
    );
  };

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Text fw={600}>Notification Sounds</Text>
        <Button variant="subtle" size="xs" onClick={resetDefaults}>
          Reset to defaults
        </Button>
      </Group>

      {!isPremium && (
        <Alert variant="light" color="blue">
          You’re on Free — premium tones are shown but locked.{' '}
          <Anchor href="/settings/upgrade">Upgrade</Anchor> to unlock all.
        </Alert>
      )}

      {/* Message tone */}
      <Group gap="sm" align="end" wrap="wrap">
        <Select
          label="Message tone"
          data={groupedMessage}
          value={messageTone}
          onChange={(v) => {
            if (!v) return;
            const flatPrem = groupedMessage[1]?.items || [];
            const isPremPick = flatPrem.some((i) => i.value === v);
            if (isPremPick && !isPremium) {
              toast.info('That’s a Premium tone.');
              return navigate('/settings/upgrade');
            }
            setMsg(v);
          }}
          searchable
          nothingFoundMessage="Put files in /public/sounds/Message_Tones"
          w={400}
          withinPortal
          // lock the select while the *ring* preview is playing (optional)
          disabled={previewState.playing && previewState.label === 'ring'}
        />
        <Button
          variant="light"
          onClick={handleMessagePreview}
          disabled={!messageTone}
        >
          {previewState.playing && previewState.label === 'message' ? 'Stop' : 'Preview'}
        </Button>
      </Group>

      {/* Ringtone */}
      <Group gap="sm" align="end" wrap="wrap">
        <Select
          label="Ringtone"
          data={groupedRing}
          value={ringtone}
          onChange={(v) => {
            if (!v) return;
            const flatPrem = groupedRing[1]?.items || [];
            const isPremPick = flatPrem.some((i) => i.value === v);
            if (isPremPick && !isPremium) {
              toast.info('That’s a Premium ringtone.');
              return navigate('/settings/upgrade');
            }
            setRing(v);
          }}
          searchable
          nothingFoundMessage="Put files in /public/sounds/Ringtones"
          w={400}
          withinPortal
          // lock the select while the *message* preview is playing (optional)
          disabled={previewState.playing && previewState.label === 'message'}
        />
        <Button
          variant="light"
          onClick={handleRingPreview}
          disabled={!ringtone}
        >
          {previewState.playing && previewState.label === 'ring' ? 'Stop' : 'Preview'}
        </Button>
      </Group>

      <Divider my="sm" />

      {/* Volume */}
      <div>
        <Group justify="space-between" mb={6}>
          <Text size="sm">Volume</Text>
          <Text size="xs" c="dimmed">
            {(Math.round(volume * 100) || 0)}%
          </Text>
        </Group>
        <Slider min={0} max={1} step={0.05} value={volume} onChange={setVol} />
      </div>

      <Group justify="flex-end">
        <Button onClick={onSave} loading={saving}>
          Save
        </Button>
      </Group>

      <Text size="xs" c="dimmed">
        Files live in <code>client/public/sounds/Message_Tones</code> and <code>client/public/sounds/Ringtones</code>.
      </Text>
    </Stack>
  );
}
