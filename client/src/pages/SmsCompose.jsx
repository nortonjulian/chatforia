import { useSearchParams, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState, useCallback } from 'react';
import axiosClient from '@/api/axiosClient';
import {
  Box,
  Group,
  Text,
  Button,
} from '@mantine/core';
import {
  IconX,
} from '@tabler/icons-react';
import BottomComposer from '@/components/BottomComposer.jsx';
import RecipientSelector from '@/components/RecipientSelector';
import { NumberPickerModal } from '@/components/profile/PhoneNumberManager';
import { prepareCarrierMmsFile } from '@/utils/prepareCarrierMmsFile.js';
import { sendCarrierMmsAttachment } from '@/pages/sendCarrierMmsAttachment.js';
import { useTranslation } from 'react-i18next';
import posthog from '@/utils/analytics';

/* ---------------- helpers ---------------- */

function toE164Dev(raw) {
  const input = String(raw || '').trim();
  if (!/^\+?[0-9().\-\s]+$/.test(input)) return '';
  const digits = input.replace(/\D/g, '');
  const normalized = input.startsWith('+')
    ? `+${digits}`
    : digits.length === 10 ? `+1${digits}` : `+${digits}`;
  return /^\+[1-9]\d{6,14}$/.test(normalized) ? normalized : '';
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
  const [hasNumber, setHasNumber] = useState(true);
  const [numberPickerOpen, setNumberPickerOpen] = useState(false);
  const [sendError, setSendError] = useState('');
  const { t } = useTranslation();

  const to = useMemo(() => {
    const first = recipients[0];
    if (!first) return '';
    return first.phone || '';
  }, [recipients]);

    const refreshMyNumber = useCallback(async () => {
      try {
        const res = await axiosClient.get('/numbers/my');
        const num = res?.data?.number || res?.data?.e164;
        setHasNumber(Boolean(num));
      } catch {
        setHasNumber(false);
      }
    }, []);

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
    refreshMyNumber();
  }, [refreshMyNumber]);

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

  async function handleSend(payload) {
    const normalizedTo = toE164Dev(to);
    const body = String(payload?.text || '').trim();
    const attachment = payload?.attachments?.[0];
    if (!normalizedTo) {
      setSendError(t('sms.addRecipient', 'Add a recipient above to start…'));
      return false;
    }
    if (!hasNumber) {
      setNumberPickerOpen(true);
      setSendError(t('sms.numberRequired', 'You need a Chatforia number before sending SMS.'));

      posthog.capture('sms_number_missing_blocked', {
        source: 'sms_compose',
      });
      return false;
    }

    if (!body && !attachment) return false;

    setSendError('');
    try {
      const res = attachment
        ? await sendCarrierMmsAttachment({
            axiosClient, toNumber: normalizedTo, text: body, fileMeta: attachment,
          })
        : await axiosClient.post('/sms/send', { to: normalizedTo, body });

      posthog.capture('sms_sent', {
        source: 'sms_compose',
        has_recipient: Boolean(normalizedTo),
        type: attachment ? 'mms' : 'sms',
      });

      const data = res.data;

      if (data?.threadId) {
        navigate(`/sms/${data.threadId}`);
        return true;
      }

      try {
        const lookup = await axiosClient.get('/sms/threads/lookup', {
          params: { to: normalizedTo },
        });
        if (lookup?.data?.threadId) {
          navigate(`/sms/${lookup.data.threadId}`);
          return true;
        }
      } catch {
        // Sending succeeded; a delayed thread lookup must not resend the MMS.
      }
      navigate('/sms');
      return true;
    } catch (e) {
      const code = e?.response?.data?.code;
      if (code === 'NO_NUMBER') {
        setNumberPickerOpen(true);
      }
      setSendError(e?.response
        ? t('sms.sendFailed', 'Message could not be sent. Check the recipient and attachment, then try again.')
        : e?.message || t('sms.sendFailed', 'Message could not be sent. Try again.'));
      return false;
    }
  }

  function handlePickMedia(p) {
    if ((p.kind === 'GIF' || p.kind === 'STICKER') && p.url) {
      setText((draft) => (draft ? `${draft} ${p.url}` : p.url));
      return true;
    }
    return false;
  }

  return (
    <Box
      style={{
        minHeight: 'calc(100vh - 60px)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >

      {!hasNumber && (
            <Box mb="xs">
              <Text c="red" size="sm">
                You need a Chatforia number before sending SMS.
              </Text>

              <Button
                size="xs"
                variant="light"
                mt={4}
                onClick={() => setNumberPickerOpen(true)}
              >
                Choose a number
              </Button>
            </Box>
          )}

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
        {sendError && <Text role="alert" c="red" size="sm">{sendError}</Text>}
        <BottomComposer
          value={text}
          onChange={(next) => { setText(next); setSendError(''); }}
          onSend={handleSend}
          prepareFile={prepareCarrierMmsFile}
          onPickMedia={handlePickMedia}
          showMic={false}
          placeholder={
              to
                ? t('sms.typeMessage', 'Type a message…')
                : t('sms.addRecipient', 'Add a recipient above to start…')
          }
        />
      </Box>

      <NumberPickerModal
        opened={numberPickerOpen}
        onClose={async () => {
          setNumberPickerOpen(false);
          await refreshMyNumber();
        }}
      />
    </Box>
  );
}
