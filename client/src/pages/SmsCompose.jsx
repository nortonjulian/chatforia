import { useSearchParams, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import axiosClient from '@/api/axiosClient';
import {
  Box,
  Group,
  Text,
  Button,
  Textarea,
  FileButton,
} from '@mantine/core';
import {
  IconMoodSmile,
  IconGif,
  IconPaperclip,
  IconSend,
  IconX,
} from '@tabler/icons-react';
import StickerPicker from '@/components/StickerPicker';
import RecipientSelector from '@/components/RecipientSelector';
import { NumberPickerModal } from '@/components/profile/PhoneNumberManager';
import { useTranslation } from 'react-i18next';

/* ---------------- helpers ---------------- */

function toE164Dev(raw) {
  const s = String(raw || '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('+')) return s;
  if (s.length === 10) return `+1${s}`;
  return `+${s}`;
}

function contactToRecipient(c) {
  const username = c?.user?.username || '';
  const alias = c?.alias || '';
  const externalName = c?.externalName || '';
  const externalPhone = c?.externalPhone || '';

  const display =
    alias ||
    username ||
    externalName ||
    externalPhone ||
    'Unknown contact';

  const phone = externalPhone ? toE164Dev(externalPhone) : '';

  if (!phone) return null;

  return {
    id: `contact:${c.id ?? c.userId ?? phone}`,
    display,
    type: 'contact',
    phone,
  };
}

/* ---------------- component ---------------- */

export default function SmsCompose() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();

  const presetTo = sp.get('to') || '';
  const presetName = sp.get('name') || '';

  const [recipients, setRecipients] = useState(() => {
    if (!presetTo) return [];
    return [
      {
        id: `preset:${toE164Dev(presetTo)}`,
        display: presetName || presetTo,
        type: 'contact',
        phone: toE164Dev(presetTo),
      },
    ];
  });

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [numberPickerOpen, setNumberPickerOpen] = useState(false);
  const { t } = useTranslation();

  const inputRef = useRef(null);

  const to = useMemo(() => {
    const first = recipients[0];
    if (!first) return '';
    return first.phone || first.email || first.display || '';
  }, [recipients]);

  const fetchRecipientSuggestions = useCallback(async (query) => {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];

    const { data } = await axiosClient.get('/contacts', {
      params: { limit: 50 },
    });

    const items = Array.isArray(data)
      ? data
      : Array.isArray(data?.items)
        ? data.items
        : [];

    return items
      .map(contactToRecipient)
      .filter(Boolean)
      .filter((r) => {
        const display = String(r.display || '').toLowerCase();
        const phone = String(r.phone || '').toLowerCase();
        return display.includes(q) || phone.includes(q);
      });
  }, []);

  useEffect(() => {
    (async () => {
      if (!presetTo) return;

      const normalized = toE164Dev(presetTo);
      if (!normalized) return;

      try {
        const res = await axiosClient.get('/sms/threads/lookup', {
          params: { to: normalized },
        });

        const threadId = res?.data?.threadId;
        if (threadId) {
          navigate(`/sms/${threadId}`, { replace: true });
        }
      } catch {
        // lookup failure → stay on compose
      }
    })();
  }, [presetTo, navigate]);

  useEffect(() => {
    if (!presetTo) return;

    setRecipients([
      {
        id: `preset:${toE164Dev(presetTo)}`,
        display: presetName || presetTo,
        type: 'contact',
        phone: toE164Dev(presetTo),
      },
    ]);
  }, [presetTo, presetName]);

  const canSend = useMemo(
    () => Boolean(to && text.trim()),
    [to, text]
  );

  async function handleSend() {
    if (!canSend) return;

    setSending(true);
    try {
      const normalizedTo = toE164Dev(to);

      const res = await axiosClient.post('/sms/send', {
        to: normalizedTo,
        body: text.trim(),
      });

      const data = res.data;

      if (data?.threadId) {
        navigate(`/sms/${data.threadId}`);
        return;
      }

      const lookup = await axiosClient.get('/sms/threads/lookup', {
        params: { to: normalizedTo },
      });

      if (lookup?.data?.threadId) {
        navigate(`/sms/${lookup.data.threadId}`);
      } else {
        setText('');
      }
    } catch (e) {
      const code = e?.response?.data?.code;
      if (code === 'NO_NUMBER') {
        setNumberPickerOpen(true);
      } else {
        console.error('SMS send failed', e);
      }
    } finally {
      setSending(false);
    }
  }

  function handlePick(p) {
    if (p.kind === 'EMOJI' && p.native) {
      setText((t) => `${t}${p.native}`);
      setPickerOpen(false);
      inputRef.current?.focus();
      return;
    }
    if ((p.kind === 'GIF' || p.kind === 'STICKER') && p.url) {
      setText((t) => (t ? `${t} ${p.url}` : p.url));
      setPickerOpen(false);
      inputRef.current?.focus();
    }
  }

  return (
    <Box
      style={{
        minHeight: 'calc(100vh - 60px)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Group justify="space-between" px="md" py="xs">
        <Text fw={600}>
          {t('sms.newText', 'New text')}
        </Text>
        <Button
          variant="light"
          color="gray"
          leftSection={<IconX size={16} />}
          onClick={() => navigate(-1)}
        >
          {t('common.cancel', 'Cancel')}
        </Button>
      </Group>

      <Box px="md" pb="xs">
        <RecipientSelector
          value={recipients}
          onChange={(next) => setRecipients(next.slice(0, 1))}
          fetchSuggestions={fetchRecipientSuggestions}
          maxRecipients={1}
          allowRaw
          placeholder={t('sms.enterRecipient', 'Enter a name or number')}
        />
      </Box>

      <div style={{ flex: 1 }} />

      <Box
        px="md"
        py="sm"
        style={{
          position: 'sticky',
          bottom: 0,
          background: 'var(--mantine-color-body)',
          borderTop: '1px solid var(--mantine-color-default-border)',
        }}
      >
        <Group gap="xs" align="center" wrap="nowrap">
          <Button variant="subtle" onClick={() => setPickerOpen(true)}>
            <IconMoodSmile size={18} />
          </Button>
          <Button variant="subtle" onClick={() => setPickerOpen(true)}>
            <IconGif size={18} />
          </Button>
          <FileButton onChange={() => {}}>
            {(props) => (
              <Button variant="subtle" {...props}>
                <IconPaperclip size={18} />
              </Button>
            )}
          </FileButton>

          <Textarea
            ref={inputRef}
            variant="filled"
            placeholder={
              to
                ? t('sms.typeMessage', 'Type a message…')
                : t('sms.addRecipient', 'Add a recipient above to start…')
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
            autosize
            minRows={3}
            maxRows={6}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            styles={{ root: { flex: 1 } }}
          />

          <Button
            onClick={handleSend}
            disabled={!canSend}
            loading={sending}
            rightSection={<IconSend size={16} />}
          >
            {t('common.send', 'Send')}
          </Button>
        </Group>
      </Box>

      <StickerPicker
        opened={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={handlePick}
      />

      <NumberPickerModal
        opened={numberPickerOpen}
        onClose={() => setNumberPickerOpen(false)}
      />
    </Box>
  );
}