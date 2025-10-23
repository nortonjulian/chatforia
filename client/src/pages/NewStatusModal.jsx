import { useMemo, useState } from 'react';
import {
  Modal,
  Textarea,
  Button,
  Group,
  Select,
  FileInput,
  Stack,
  Text,
  MultiSelect,
  NumberInput,
  Tooltip,
  Badge,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import axiosClient from '@/api/axiosClient';

const HOUR_MIN = 1;
const HOUR_MAX = 7 * 24; // 168h (7d)
const PRESETS = [6, 12, 24, 48, 72];

export default function NewStatusModal({ opened, onClose }) {
  const [caption, setCaption] = useState('');
  const [audience, setAudience] = useState('MUTUALS');
  const [customIds, setCustomIds] = useState([]);
  const [expireHours, setExpireHours] = useState(24); // <-- hours now
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);

  const [contactOptions, setContactOptions] = useState([]);
  const loadContacts = async () => {
    try {
      const { data } = await axiosClient.get('/contacts');
      const opts = data.items
        ? data.items.map((c) => ({
            value: String(c.user?.id || c.contactUserId),
            label: c.user?.username || `User #${c.contactUserId}`,
          }))
        : (data || []).map((u) => ({
            value: String(u.id),
            label: u.username || `User #${u.id}`,
          }));
      setContactOptions(opts);
    } catch (e) {
      console.error('load contacts failed', e);
    }
  };

  const onSubmit = async () => {
    if (!caption.trim() && files.length === 0) return;
    try {
      setBusy(true);
      const form = new FormData();
      form.set('caption', caption);
      form.set('audience', audience);
      // API remains seconds:
      form.set('expireSeconds', String((Number(expireHours) || 24) * 3600));

      if (audience === 'CUSTOM' && customIds.length) {
        form.set('customAudienceIds', JSON.stringify(customIds.map((v) => Number(v))));
      }
      for (const f of files) form.append('files', f);

      await axiosClient.post('/status', form);

      notifications.show({ message: 'Status posted', withBorder: true });

      onClose?.();
      setCaption('');
      setFiles([]);
      setCustomIds([]);
      setAudience('MUTUALS');
      setExpireHours(24); // reset to 24h
    } catch (e) {
      console.error('post status failed', e);
      notifications.show({
        message: 'Failed to post status',
        color: 'red',
        withBorder: true,
      });
    } finally {
      setBusy(false);
    }
  };

  const isEmptyPost = !caption.trim() && files.length === 0;

  const expiresAtText = useMemo(() => {
    const ms = (Number(expireHours) || 24) * 3600 * 1000;
    return new Date(Date.now() + ms).toLocaleString();
  }, [expireHours]);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Create a status"
      centered
      withCloseButton
      closeOnEscape
      trapFocus
      aria-label="New status"
    >
      <Stack>
        <Textarea
          label="What’s on your mind?"
          placeholder="Share an update…"
          aria-label="Status message"
          value={caption}
          onChange={(e) => setCaption(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose?.();
          }}
          autosize
          minRows={3}
        />

        <Group grow>
          <Select
            label="Audience"
            value={audience}
            onChange={(v) => {
              const next = v || 'MUTUALS';
              setAudience(next);
              if (next === 'CUSTOM' && contactOptions.length === 0) loadContacts();
            }}
            data={[
              { value: 'PUBLIC', label: 'Public' },
              { value: 'FOLLOWERS', label: 'Followers' },
              { value: 'CONTACTS', label: 'Contacts' },
              { value: 'MUTUALS', label: 'Mutuals' },
              { value: 'CUSTOM', label: 'Custom...' },
            ]}
            withinPortal
          />

          <div>
            <NumberInput
              label="Expires (hours)"
              min={HOUR_MIN}
              max={HOUR_MAX}
              step={1}
              clampOnBlur
              value={expireHours}
              onChange={(v) => {
                const n = Number(v);
                setExpireHours(Number.isFinite(n) ? n : 24);
              }}
            />
            <Group gap="xs" mt={6} wrap="wrap">
              {PRESETS.map((h) => (
                <Button
                  key={h}
                  size="xs"
                  variant={h === expireHours ? 'filled' : 'light'}
                  onClick={() => setExpireHours(h)}
                >
                  {h}h
                </Button>
              ))}
              <Tooltip label="Maximum 7 days">
                <Badge variant="light">{HOUR_MAX}h max</Badge>
              </Tooltip>
            </Group>
            <Text size="xs" c="dimmed" mt={4}>
              Expires on: {expiresAtText}
            </Text>
          </div>
        </Group>

        {audience === 'CUSTOM' ? (
          <MultiSelect
            label="Choose recipients"
            placeholder="Select contacts"
            data={contactOptions}
            value={customIds}
            onChange={setCustomIds}
            searchable
            withinPortal
          />
        ) : null}

        <FileInput
          label="Attachments"
          placeholder="Add images/videos"
          multiple
          accept="image/*,video/*,audio/*"
          value={files}
          onChange={setFiles}
        />
        <Text size="xs" c="dimmed">
          Up to 5 files. 24h expiry by default.
        </Text>

        <Group justify="flex-end" mt="sm">
          <Button
            type="button"
            variant="light"
            onClick={onClose}
            aria-label="Cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            loading={busy}
            onClick={() => {
              if (!caption.trim() && files.length === 0) return;
              onSubmit();
            }}
            aria-label="Post status"
            disabled={isEmptyPost}
          >
            Post
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
