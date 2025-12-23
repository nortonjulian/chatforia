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

/* ---------- helpers ---------- */

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

    if (mode === 'mixed') {
      alert(
        'Please send either all phone numbers (SMS) OR all usernames (Chatforia) in one message.'
      );
      return;
    }

    try {
      setDraft('');

      if (mode === 'sms') {
        if (recipients.length !== 1) {
          alert('SMS currently supports one phone number at a time.');
          setDraft(firstMessage);
          return;
        }

        const to = recipients[0];
        const { data } = await axiosClient.post('/sms/send', {
          to,
          body: firstMessage,
        });

        const threadId = data?.threadId;
        if (!threadId) throw new Error('SMS send returned no threadId');

        navigate(smsThreadPath(threadId));
        return;
      }

      const { chatroomId } = await startChatforiaThread({
        recipients,
        firstMessage,
      });

      navigate(chatThreadPath(chatroomId));
    } catch (e) {
      console.error('[HomeIndex] send failed', e);
      setDraft(firstMessage);
      alert('Send failed. Check console for details.');
    }
  };

  return (
    <ThreadShell
      header={
        // ✅ iMessage/TextNow-like "To:" bar (simple row, no extra random buttons)
        <Box p="md" w="100%">
          <Paper withBorder radius="md" p="sm" w="100%">
            {/* chips (optional, lightweight) */}
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
              <Text fw={600} style={{ minWidth: 32 }}>
                To:
              </Text>

              <Box style={{ flex: 1, minWidth: 0 }}>
                <TextInput
                  ref={toInputRef}
                  value={toRaw}
                  onChange={(e) => setToRaw(e.currentTarget.value)}
                  placeholder="Enter a name or number"
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

              <Tooltip label="Clear" withArrow>
                <ActionIcon
                  variant="subtle"
                  onClick={clearAll}
                  aria-label="Clear recipients"
                >
                  <IconX size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>

            {/* mode badge row */}
            {mode && mode !== 'mixed' && (
              <Group mt={10} gap="xs">
                <Badge variant="light" radius="sm">
                  {mode === 'sms' ? 'SMS' : 'Chatforia'}
                </Badge>
              </Group>
            )}
          </Paper>
        </Box>
      }
      composer={
        // ✅ Full-width composer container (BottomComposer owns the Send button)
        <Box w="100%">
          <ThreadComposer
            value={draft}
            onChange={setDraft}
            placeholder={
              recipients.length
                ? 'Type a message…'
                : 'Add a recipient above to start…'
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
      {/* Center panel content */}
      <Box w="100%" p="md" style={{ height: '100%', minHeight: 0 }}>
        <Box
          style={{
            height: '100%',
            minHeight: 240,
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
  );
}
