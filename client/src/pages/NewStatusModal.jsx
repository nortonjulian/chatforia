import { useState } from 'react';
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
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import axiosClient from '@/api/axiosClient';

export default function NewStatusModal({ opened, onClose }) {
  const [caption, setCaption] = useState('');
  const [audience, setAudience] = useState('MUTUALS');
  const [customIds, setCustomIds] = useState([]);
  const [expire, setExpire] = useState(24 * 3600);
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
      // eslint-disable-next-line no-console
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
      form.set('expireSeconds', String(expire));
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
      setExpire(24 * 3600);
    } catch (e) {
      // eslint-disable-next-line no-console
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
          <NumberInput
            label="Expires (seconds)"
            min={60}
            max={7 * 24 * 3600}
            value={expire}
            onChange={(v) => setExpire(Number(v) || 24 * 3600)}
          />
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
            aria-label="Cancel"         // <-- was "Cancel posting status"
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
            aria-label="Post status"           // <-- was "Post status"
            disabled={isEmptyPost}
          >
            Post
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
