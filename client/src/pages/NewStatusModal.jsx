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
import { useTranslation } from 'react-i18next';

const HOUR_MIN = 1;
const HOUR_MAX = 7 * 24; // 168h (7d)
const PRESETS = [6, 12, 24, 48, 72];

export default function NewStatusModal({ opened, onClose }) {
  const { t } = useTranslation();

  const [caption, setCaption] = useState('');
  const [audience, setAudience] = useState('CONTACTS'); // ← default to Contacts (privacy-first)
  const [customIds, setCustomIds] = useState([]);
  const [expireHours, setExpireHours] = useState(24); // hours
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);

  const [contactOptions, setContactOptions] = useState([]);
  const loadContacts = async () => {
    try {
      const { data } = await axiosClient.get('/contacts');
      const opts = data.items
        ? data.items.map((c) => ({
            value: String(c.user?.id || c.contactUserId),
            label:
              c.user?.username ||
              t('status.userNumber', { defaultValue: 'User #{{id}}', id: c.contactUserId }),
          }))
        : (data || []).map((u) => ({
            value: String(u.id),
            label: u.username || t('status.userNumber', { defaultValue: 'User #{{id}}', id: u.id }),
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
      // API expects seconds:
      form.set('expireSeconds', String((Number(expireHours) || 24) * 3600));

      if (audience === 'CUSTOM' && customIds.length) {
        form.set('customAudienceIds', JSON.stringify(customIds.map((v) => Number(v))));
      }

      for (const f of files) form.append('files', f);

      // pass media metadata (incl. audio duration)
      const meta = await buildAttachmentsMeta(files);
      if (meta.length) form.set('attachmentsMeta', JSON.stringify(meta));

      await axiosClient.post('/status', form);

      notifications.show({
        message: t('status.posted', { defaultValue: 'Status posted' }),
        withBorder: true,
      });

      onClose?.();
      setCaption('');
      setFiles([]);
      setCustomIds([]);
      setAudience('CONTACTS'); // reset to default
      setExpireHours(24);
    } catch (e) {
      console.error('post status failed', e);
      notifications.show({
        message: t('status.postFailed', { defaultValue: 'Failed to post status' }),
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
      title={t('status.createTitle', { defaultValue: 'Create a status' })}
      centered
      withCloseButton
      closeOnEscape
      trapFocus
      aria-label={t('status.modalAriaLabel', { defaultValue: 'New status' })}
    >
      <Stack>
        <Textarea
          label={t('status.captionLabel', { defaultValue: 'What’s on your mind?' })}
          placeholder={t('status.captionPlaceholder', { defaultValue: 'Share an update…' })}
          aria-label={t('status.captionAria', { defaultValue: 'Status message' })}
          value={caption}
          onChange={(e) => setCaption(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose?.();
          }}
          autosize
          minRows={3}
          maxLength={1000}
        />

        <Group grow>
          <Select
            label={t('status.audienceLabel', { defaultValue: 'Audience' })}
            value={audience}
            onChange={(v) => {
              const next = v || 'CONTACTS';
              setAudience(next);
              if (next === 'CUSTOM' && contactOptions.length === 0) loadContacts();
            }}
            data={[
              { value: 'PUBLIC',   label: t('status.audience.public',   { defaultValue: 'Public' }) },
              { value: 'CONTACTS', label: t('status.audience.contacts', { defaultValue: 'Contacts' }) },
              { value: 'CUSTOM',   label: t('status.audience.custom',   { defaultValue: 'Custom…' }) },
            ]}
            withinPortal
          />

          <div>
            <NumberInput
              label={t('status.expiresHoursLabel', { defaultValue: 'Expires (hours)' })}
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
              <Tooltip label={t('status.maxTooltip', { defaultValue: 'Maximum 7 days' })}>
                <Badge variant="light">
                  {HOUR_MAX}
                  {t('status.hoursAbbrev', { defaultValue: 'h' })}{' '}
                  {t('status.maxShort', { defaultValue: 'max' })}
                </Badge>
              </Tooltip>
            </Group>
            <Text size="xs" c="dimmed" mt={4}>
              {t('status.expiresOn', { defaultValue: 'Expires on:' })} {expiresAtText}
            </Text>
          </div>
        </Group>

        {audience === 'CUSTOM' ? (
          <MultiSelect
            label={t('status.chooseRecipients', { defaultValue: 'Choose recipients' })}
            placeholder={t('status.selectContacts', { defaultValue: 'Select contacts' })}
            data={contactOptions}
            value={customIds}
            onChange={setCustomIds}
            searchable
            withinPortal
          />
        ) : null}

        <FileInput
          label={t('status.attachmentsLabel', { defaultValue: 'Attachments' })}
          placeholder={t('status.attachmentsPlaceholder', {
            defaultValue: 'Add images/videos',
          })}
          multiple
          accept="image/*,video/*,audio/*"
          value={files}
          onChange={setFiles}
        />
        <Text size="xs" c="dimmed">
          {t('status.filesNote', {
            defaultValue: 'Up to 5 files. 24h expiry by default.',
          })}
        </Text>

        <Group justify="flex-end" mt="sm">
          <Button
            type="button"
            variant="light"
            onClick={onClose}
            aria-label={t('common.cancelAria', { defaultValue: 'Cancel' })}
          >
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            type="button"
            loading={busy}
            onClick={() => {
              if (!caption.trim() && files.length === 0) return;
              onSubmit();
            }}
            aria-label={t('status.postAria', { defaultValue: 'Post status' })}
            disabled={isEmptyPost}
          >
            {t('status.post', { defaultValue: 'Post' })}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/* -------------------- Helpers -------------------- */
async function readAudioDurationSec(file) {
  return new Promise((resolve) => {
    try {
      const el = document.createElement('audio');
      el.preload = 'metadata';
      el.src = URL.createObjectURL(file);
      el.onloadedmetadata = () => {
        const sec = Math.round(el.duration || 0);
        URL.revokeObjectURL(el.src);
        resolve(Number.isFinite(sec) ? sec : null);
      };
      el.onerror = () => {
        try {
          URL.revokeObjectURL(el.src);
        } catch {}
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

async function buildAttachmentsMeta(files) {
  const meta = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const mime = String(f.type || '');
    if (mime.startsWith('image/')) {
      meta.push({ idx: i, kind: 'IMAGE' });
    } else if (mime.startsWith('video/')) {
      meta.push({ idx: i, kind: 'VIDEO' });
    } else if (mime.startsWith('audio/')) {
      const durationSec = await readAudioDurationSec(f);
      meta.push({ idx: i, kind: 'AUDIO', durationSec: durationSec ?? null });
    }
  }
  return meta;
}
