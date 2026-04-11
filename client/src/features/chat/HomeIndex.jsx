import { useMemo, useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Group,
  Text,
  Title,
  TextInput,
  ActionIcon,
  Badge,
  Paper,
  Tooltip,
} from '@mantine/core';
import { IconX } from '@tabler/icons-react';

import ThreadShell from '@/threads/ThreadShell';
import ThreadComposer from '@/threads/ThreadComposer.jsx';
import axiosClient from '@/api/axiosClient';
import { useTranslation } from 'react-i18next';

/* ---------- helpers ---------- */
function normalizePhone(raw) {
  const s = String(raw || '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('+')) return s;
  if (s.length === 10) return `+1${s}`;
  if (s.length === 11 && s.startsWith('1')) return `+${s}`;
  return `+${s}`;
}

function contactMatchesInput(contact, raw) {
  const q = String(raw || '').trim().toLowerCase();
  if (!q) return false;

  const alias = String(contact?.alias || '').trim().toLowerCase();
  const username = String(contact?.user?.username || '').trim().toLowerCase();
  const externalName = String(contact?.externalName || '').trim().toLowerCase();
  const externalPhone = String(contact?.externalPhone || '').trim().toLowerCase();

  return [alias, username, externalName, externalPhone].some(Boolean) &&
    [alias, username, externalName, externalPhone].includes(q);
}

async function resolveTypedRecipient(raw) {
  const typed = String(raw || '').trim();
  if (!typed) return null;

  if (looksLikePhone(typed)) {
    return { kind: 'sms', phone: normalizePhone(typed) };
  }

  const { data } = await axiosClient.get('/contacts', {
    params: { limit: 100 },
  });

  const items = Array.isArray(data)
    ? data
    : Array.isArray(data?.items)
      ? data.items
      : [];

  const match = items.find((c) => contactMatchesInput(c, typed));
  if (!match) return null;

  if (match.externalPhone) {
    return {
      kind: 'sms',
      phone: normalizePhone(match.externalPhone),
      label: match.alias || match.externalName || match.externalPhone,
    };
  }

  if (match.userId) {
    return {
      kind: 'chat',
      userId: match.userId,
      label: match.alias || match.user?.username || `User #${match.userId}`,
    };
  }

  return null;
}

// very lightweight phone detection (US + E.164-ish)
function looksLikePhone(raw) {
  const s = String(raw || '').trim();
  if (!s) return false;

  // allow +15551234567 OR 5551234567 OR (555) 123-4567 etc.
  const digits = s.replace(/[^\d+]/g, '');
  if (digits.startsWith('+') && digits.length >= 11 && digits.length <= 16) return true;

  const onlyDigits = digits.replace(/\D/g, '');
  return onlyDigits.length >= 10 && onlyDigits.length <= 15;
}

function splitRecipients(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function uniq(list) {
  const seen = new Set();
  const out = [];
  for (const v of list) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/* ---------- NOTE: adjust these two navigations if your routes differ ---------- */
function smsThreadPath(threadId) {
  return `/sms/${threadId}`;
}

function chatThreadPath(chatroomId) {
  return `/chat/${chatroomId}`;
}

/* ---------- Chatforia thread create/get (ADJUST ENDPOINT HERE IF NEEDED) ---------- */
async function startChatforiaThread({ recipients, firstMessage }) {
  const { data } = await axiosClient.post('/chatrooms/start', {
    recipients,
    firstMessage: firstMessage || '',
  });

  const chatroomId =
    data?.chatroomId ?? data?.roomId ?? data?.id ?? data?.chatRoomId ?? null;

  if (!chatroomId) throw new Error('Chat thread create returned no id');
  return { chatroomId };
}

export default function HomeIndex({ currentUser }) {
  const navigate = useNavigate();

  const toInputRef = useRef(null);

  useEffect(() => {
    const onFocus = () => {
      // Mantine TextInput forwards ref to the <input>
      toInputRef.current?.focus?.();
    };
    window.addEventListener('focus-home-to', onFocus);
    return () => window.removeEventListener('focus-home-to', onFocus);
  }, []);

  // “To:” entry field (raw input) + parsed chips
  const [toRaw, setToRaw] = useState('');
  const recipients = useMemo(() => uniq(splitRecipients(toRaw)), [toRaw]);

  // composer draft (first message)
  const [draft, setDraft] = useState('');

  const { t } = useTranslation();

  const mode = useMemo(() => {
    if (recipients.length === 0) return null;
    const allPhones = recipients.every(looksLikePhone);
    const anyPhone = recipients.some(looksLikePhone);
    if (allPhones) return 'sms';
    if (anyPhone) return 'mixed'; // block mixed for now
    return 'chat';
  }, [recipients]);

  const canSend =
    recipients.length > 0 && String(draft || '').trim().length > 0;

  const clearAll = () => {
    setToRaw('');
    setDraft('');
  };

  const removeRecipient = (value) => {
    const next = recipients.filter(
      (r) => r.toLowerCase() !== value.toLowerCase()
    );
    setToRaw(next.join(', '));
  };

  const handleSend = async () => {
  if (!canSend) return;

  const firstMessage = String(draft || '').trim();
  if (!firstMessage) return;

  // keep current multi-recipient behavior blocked for now, surgically
  if (recipients.length !== 1) {
    alert(t('home.oneRecipient', 'Please enter one recipient for now.'));
    return;
  }

  const typedRecipient = recipients[0];

  try {
    setDraft('');

    const resolved = await resolveTypedRecipient(typedRecipient);

    if (!resolved) {
      alert(t('home.enterValidRecipient', 'Enter a saved contact name or a phone number.'));
      setDraft(firstMessage);
      return;
    }

    if (resolved.kind === 'sms') {
      const { data } = await axiosClient.post('/sms/send', {
        to: resolved.phone,
        body: firstMessage,
      });

      const threadId = data?.threadId;
      if (!threadId) throw new Error('SMS send returned no threadId');

      navigate(smsThreadPath(threadId));
      return;
    }

    if (resolved.kind === 'chat') {
      const { data } = await axiosClient.post(`/chatrooms/direct/${resolved.userId}`);
      const chatroomId =
        data?.id ?? data?.chatroomId ?? data?.roomId ?? data?.chatRoomId ?? null;

      if (!chatroomId) throw new Error('Direct chat returned no id');

      navigate(chatThreadPath(chatroomId));
      return;
    }

    throw new Error('Unknown recipient resolution');
  } catch (e) {
  console.error('[HomeIndex] send failed', e);
  setDraft(firstMessage);

  const code = e?.response?.data?.code;
  if (code === 'NO_NUMBER') {
    alert('You need a Chatforia number before sending SMS.');
    navigate('/manage-wireless'); // or your actual number activation page
    return;
  }

  alert(t('home.sendFailed', 'Send failed. Check console for details.'));
}
};

  return (
    <Box
      style={{
        flex: 1,
        minHeight: 'calc(100dvh - 60px - 32px)',
        height: 'calc(100dvh - 60px - 32px)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <ThreadShell
        header={
          <Box p="md" w="100%">
            <Paper withBorder radius="md" p="sm" w="100%">
              {recipients.length > 0 && (
                <Group gap={6} mb={8} wrap="wrap">
                  {recipients.map((r) => (
                    <Badge
                      key={r}
                      variant="light"
                      radius="sm"
                      rightSection={
                        <ActionIcon
                          size="xs"
                          variant="subtle"
                          aria-label={`Remove ${r}`}
                          onClick={() => removeRecipient(r)}
                        >
                          <IconX size={12} />
                        </ActionIcon>
                      }
                    >
                      {r}
                    </Badge>
                  ))}
                </Group>
              )}

              <Group gap="xs" wrap="nowrap" align="center">
                <Text fw={600}>
                  {t('home.to', 'To:')}
                </Text>

                <Box style={{ flex: 1, minWidth: 0 }}>
                  <TextInput
                    ref={toInputRef}
                    value={toRaw}
                    onChange={(e) => setToRaw(e.currentTarget.value)}
                    placeholder={t('home.enterRecipient', 'Enter a name or number')}
                    variant="unstyled"
                    styles={{
                      input: {
                        fontSize: 14,
                        padding: 0,
                        minHeight: 28,
                      },
                    }}
                  />

                  {mode === 'mixed' && (
                    <Text size="xs" c="red" mt={6}>
                      Mixed recipients detected. Use either all phone numbers (SMS) or all usernames (Chatforia).
                    </Text>
                  )}
                </Box>

                <Tooltip label={t('common.clear', 'Clear')}withArrow>
                  <ActionIcon
                    variant="subtle"
                    onClick={clearAll}
                    aria-label={t('home.clearRecipients', 'Clear recipients')}
                  >
                    <IconX size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>

              {mode && mode !== 'mixed' && (
                <Group mt={10} gap="xs">
                  <Badge variant="light" radius="sm">
                    {mode === 'sms'
                      ? t('home.sms', 'SMS')
                      : t('home.chatforia', 'Chatforia')}
                  </Badge>
                </Group>
              )}
            </Paper>
          </Box>
        }
        composer={
          <Box w="100%">
            <ThreadComposer
              value={draft}
              onChange={setDraft}
              placeholder={
                recipients.length
                  ? t('home.typeMessage', 'Type a message…')
                  : t('home.addRecipient', 'Add a recipient above to start…')
              }
              onSend={handleSend}
              features={{
                showGif: true,
                showEmoji: true,
                showMic: true,
                showUpload: true,
              }}
            />
          </Box>
        }
      >
        <Box
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Box
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Box style={{ textAlign: 'center' }}>
              <Title order={3} mb={6}>
                Your messages
              </Title>
              <Text c="dimmed">
                Enter a recipient above, then send a message to start a conversation.
              </Text>
            </Box>
          </Box>
        </Box>
      </ThreadShell>
    </Box>
  );
}
