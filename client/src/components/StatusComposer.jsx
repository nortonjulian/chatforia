import { useEffect, useState } from 'react';
import {
  Modal,
  Group,
  Textarea,
  FileInput,
  Button,
  Select,
  Text,
  ActionIcon,
  Chip,
  Stack,
  Tooltip,
} from '@mantine/core';
import { X } from 'lucide-react';
import axiosClient from '../api/axiosClient';
import { toast } from '../utils/toast';

const AUDIENCE = [
  { value: 'MUTUALS', label: 'Mutual contacts' },
  { value: 'CONTACTS', label: 'All contacts' },
  { value: 'CUSTOM', label: 'Custom list' }, // simple MVP
];

// Optional soft guard to prevent accidentally massive uploads on slow networks.
// Server enforces its own strict limits; this is just early feedback.
// Set to null to disable client-side size checks.
const CLIENT_MAX_FILE_MB = 100;

export default function StatusComposer({ opened, onClose }) {
  const [caption, setCaption] = useState('');
  const [files, setFiles] = useState([]);
  const [audience, setAudience] = useState('MUTUALS');
  const [custom, setCustom] = useState('[]');
  const [ttl, setTtl] = useState('86400');
  const [loading, setLoading] = useState(false);

  // Reset when modal closes
  useEffect(() => {
    if (!opened) resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  function resetForm() {
    setCaption('');
    setFiles([]);
    setCustom('[]');
    setAudience('MUTUALS');
    setTtl('86400');
    setLoading(false);
  }

  function parseCustomAudience() {
    if (audience !== 'CUSTOM') return null;
    try {
      const parsed = JSON.parse(custom);
      if (!Array.isArray(parsed)) throw new Error('Not an array');
      return parsed;
    } catch {
      toast.err('Custom audience must be a JSON array of user IDs.');
      return null;
    }
  }

  function validateBeforeSubmit() {
    const seconds = Number(ttl);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      toast.err('Please choose a valid expiration.');
      return null;
    }
    const parsedCustom = parseCustomAudience();
    if (audience === 'CUSTOM' && !parsedCustom) return null;

    // Prevent empty posts (no caption, no files)
    if (!caption.trim() && files.length === 0) {
      toast.info('Add a caption or attach a file.');
      return null;
    }
    return { seconds, parsedCustom };
  }

  function humanSize(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  }

  function onAddFile(f) {
    if (!f) return;
    if (CLIENT_MAX_FILE_MB && f.size > CLIENT_MAX_FILE_MB * 1024 * 1024) {
      toast.err(
        `That file is ${humanSize(f.size)}. Max allowed here is ~${CLIENT_MAX_FILE_MB}MB.`
      );
      return;
    }
    setFiles((prev) => [...prev, f]);
  }

  function removeFileAt(index) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function statusErrorMessage(err) {
    const status = err?.response?.status;
    const code = err?.response?.data?.code;
    const msg = err?.response?.data?.message;

    if (status === 402) {
      // Premium gate (generic); specific reasons may be included by server
      return code === 'PREMIUM_REQUIRED'
        ? 'This action requires Premium.'
        : 'Upgrade required for this action.';
    }
    if (status === 413) return 'One or more files exceed the upload size limit.';
    if (status === 415) return 'Unsupported file type.';
    if (status === 422) return msg || 'Please check your inputs and try again.';
    return msg || 'Try again.';
  }

  async function submit(e) {
    if (e?.preventDefault) e.preventDefault();
    if (loading) return;

    const validated = validateBeforeSubmit();
    if (!validated) return;

    const { seconds, parsedCustom } = validated;

    setLoading(true);
    try {
      const form = new FormData();
      if (caption.trim()) form.append('caption', caption.trim());
      form.append('audience', audience);
      form.append('expireSeconds', String(seconds));
      if (audience === 'CUSTOM' && parsedCustom) {
        // The server expects a JSON array in string form
        form.append('customAudienceIds', JSON.stringify(parsedCustom));
      }
      files.forEach((f) => form.append('files', f));

      // Let axios/browser set proper multipart boundary headers automatically
      await axiosClient.post('/status', form);

      toast.ok('Your status is live.');
      resetForm();
      onClose?.();
    } catch (err) {
      toast.err(`Post failed: ${statusErrorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="New status"
      centered
      closeOnEscape
      trapFocus
      aria-label="New status composer"
    >
      <form onSubmit={submit}>
        <Stack gap="sm">
          <Textarea
            label="Caption (optional)"
            aria-label="Caption"
            value={caption}
            onChange={(e) => setCaption(e.currentTarget.value)}
            autosize
            minRows={2}
            disabled={loading}
            maxLength={1000}
          />

          <Select
            label="Audience"
            aria-label="Audience"
            data={AUDIENCE}
            value={audience}
            onChange={(v) => setAudience(v || 'MUTUALS')}
            disabled={loading}
          />

          {audience === 'CUSTOM' && (
            <Textarea
              label="Custom user IDs (JSON array)"
              description='Example: ["123","456"]'
              aria-label="Custom user IDs JSON"
              value={custom}
              onChange={(e) => setCustom(e.currentTarget.value)}
              autosize
              minRows={1}
              disabled={loading}
            />
          )}

          <Select
            label="Expires in"
            aria-label="Expires in"
            data={[
              { value: '3600', label: '1 hour' },
              { value: '21600', label: '6 hours' },
              { value: '43200', label: '12 hours' },
              { value: '86400', label: '24 hours' },
            ]}
            value={ttl}
            onChange={(v) => setTtl(v || '86400')}
            disabled={loading}
          />

          <FileInput
            label="Media (images/video/audio)"
            aria-label="Add media file"
            value={null}
            onChange={onAddFile}
            placeholder="Add file"
            accept="image/*,video/*,audio/*"
            multiple={false}
            clearable
            disabled={loading}
            description={
              CLIENT_MAX_FILE_MB
                ? `Max ~${CLIENT_MAX_FILE_MB}MB per file (server may enforce lower per-plan limits).`
                : undefined
            }
          />

          {files.length > 0 && (
            <Group gap="xs" wrap="wrap" aria-live="polite">
              <Text size="sm">{files.length} item(s) attached</Text>
              {files.map((f, idx) => (
                <Chip
                  key={`${f.name}-${idx}`}
                  checked
                  onChange={() => removeFileAt(idx)}
                  radius="sm"
                >
                  <Group gap={6}>
                    <Text size="sm">
                      {f.name} · {humanSize(f.size)}
                    </Text>
                    <Tooltip label="Remove">
                      <ActionIcon
                        aria-label={`Remove ${f.name}`}
                        size="sm"
                        variant="subtle"
                        onClick={(e) => {
                          e.preventDefault();
                          removeFileAt(idx);
                        }}
                      >
                        <X size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Chip>
              ))}
            </Group>
          )}

          <Group justify="flex-end" mt="md">
            <Button
              variant="subtle"
              onClick={onClose}
              type="button"
              aria-label="Cancel"
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={loading}
              disabled={loading}
              aria-label="Post status"
            >
              Post
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
