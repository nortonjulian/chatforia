import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axiosClient from '@/api/axiosClient';
import ContactList from './ContactList.jsx';
import RecipientSelector from './RecipientSelector.jsx';
import {
  Modal,
  TextInput,
  Button,
  Stack,
  Divider,
  Title,
  Group,
  Text,
  ScrollArea,
  Badge,
  SegmentedControl,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';

// Ads
import AdSlot from '../ads/AdSlot.jsx';
import { PLACEMENTS } from '@/ads/placements';

// Premium gating
import useIsPremium from '@/hooks/useIsPremium';

function coerceUsers(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.users)) return payload.users;
  if (Array.isArray(payload.results)) return payload.results;
  return [payload];
}

function normalizeToE164(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // if already e164-ish
  if (s.startsWith('+') && /^\+\d{8,15}$/.test(s)) return s;
  // digits only
  const digits = s.replace(/[^\d]/g, '');
  // basic US fallback: 10 digits -> +1
  if (digits.length === 10) return `+1${digits}`;
  // 11 digits starting with 1 -> +1...
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  // otherwise best-effort with +
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return '';
}

export default function NewConversationModal({
  currentUserId,
  onClose,
  initialDraft = null, // { text?: string, files?: File[] } - reserved for later
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isPremium = useIsPremium();

  // Primary mode: Chatforia vs SMS
  const [channel, setChannel] = useState('chat'); // 'chat' | 'sms'

  // Chatforia state
  const [recipients, setRecipients] = useState([]);
  const [mode, setMode] = useState('group'); // 'group' | 'broadcast'
  const [groupName, setGroupName] = useState('');
  const [seedMessage, setSeedMessage] = useState('');

  // SMS state
  const [smsTo, setSmsTo] = useState('');

  const [starting, setStarting] = useState(false);
  const [pickerInfo, setPickerInfo] = useState('');

  const [showContacts, setShowContacts] = useState(false);
  const [contacts, setContacts] = useState([]);

  const nonRawCount = recipients.filter((r) => r?.id).length;

  const handleClose = () => {
    setChannel('chat');
    setRecipients([]);
    setMode('group');
    setGroupName('');
    setSeedMessage('');
    setSmsTo('');
    setPickerInfo('');
    setShowContacts(false);
    onClose?.();
  };

  // Suggestions for Chatforia recipients ONLY (users/contacts with userId)
  const fetchSuggestions = useCallback(
    async (q) => {
      const query = (q || '').trim();
      if (!query) return [];

      try {
        const [contactsRes, usersRes] = await Promise.allSettled([
          axiosClient.get('/contacts', { params: { query, limit: 20 } }),
          axiosClient.get('/search/people', { params: { query } }),
        ]);

        const contactsData =
          contactsRes.status === 'fulfilled'
            ? Array.isArray(contactsRes.value?.data)
              ? contactsRes.value.data
              : contactsRes.value?.data?.items || []
            : [];

        const usersData =
          usersRes.status === 'fulfilled' ? coerceUsers(usersRes.value?.data) : [];

        // IMPORTANT: only include contacts that map to a real Chatforia userId for chat mode
        const contactItems = contactsData
          .filter((c) => c.userId) // only app-to-app here
          .map((c) => ({
            id: c.userId,
            display: c.alias || c.name || c.user?.username || 'Contact',
            type: 'contact',
          }))
          .filter((it) => it.id && it.id !== currentUserId);

        const userItems = usersData
          .map((u) => ({
            id: u.id,
            display: u.username || u.name || u.phoneNumber || u.email || 'User',
            type: 'user',
          }))
          .filter((it) => it.id && it.id !== currentUserId);

        const map = new Map();
        for (const it of [...userItems, ...contactItems]) {
          if (!map.has(it.id)) map.set(it.id, it);
        }
        return Array.from(map.values()).slice(0, 20);
      } catch {
        return [];
      }
    },
    [currentUserId]
  );

  const startChatforia = async () => {
    setPickerInfo('');

    if (!recipients.length) {
      setPickerInfo(t('newConv.pickAtLeastOne', 'Pick at least one recipient.'));
      return;
    }

    const ids = recipients.filter((r) => r?.id).map((r) => r.id);

    if (mode === 'group' && ids.length < 2) {
      setPickerInfo(
        t('newConv.selectAtLeastTwo', 'Select at least 2 recipients for a group.')
      );
      return;
    }

    try {
      setStarting(true);

      if (mode === 'group') {
        const { data: chatroom } = await axiosClient.post('/chatrooms', {
          participantIds: ids,
          title: groupName?.trim() || undefined,
        });
        if (chatroom?.id) {
          handleClose();
          navigate(`/chat/${chatroom.id}`);
        }
        return;
      }

      // Separate chats mode
      const messageText = seedMessage?.trim() || undefined;
      const createdRoomIds = [];

      for (const id of ids) {
        const { data } = await axiosClient.post('/chatrooms', {
          participantIds: [id],
        });
        const roomId = data?.chatRoomId || data?.id;
        if (!roomId) continue;
        createdRoomIds.push(roomId);

        if (messageText) {
          await axiosClient.post('/messages', {
            chatRoomId: roomId,
            content: messageText,
          });
        }
      }

      handleClose();
      navigate(createdRoomIds[0] ? `/chat/${createdRoomIds[0]}` : `/chat`);
    } catch {
      setPickerInfo(
        t('newConv.failedStart', 'Failed to start chat with selected recipients.')
      );
    } finally {
      setStarting(false);
    }
  };

  const startSms = async () => {
    setPickerInfo('');
    const e164 = normalizeToE164(smsTo);

    if (!smsTo.trim()) {
      setPickerInfo(t('newConv.smsEnter', 'Enter a phone number.'));
      return;
    }
    if (!e164) {
      setPickerInfo(
        t(
          'newConv.smsInvalid',
          'That number looks invalid. Try including country code (ex: +15551234567).'
        )
      );
      return;
    }

    handleClose();
    navigate(`/sms/compose?to=${encodeURIComponent(e164)}`);
  };

  return (
    <Modal
      opened
      onClose={handleClose}
      title={<Title order={4}>{t('newConv.title', 'New message')}</Title>}
      radius="xl"
      centered
      size="lg"
      aria-label={t('newConv.title', 'New message')}
    >
      <Stack gap="sm">
        {/* Primary channel toggle */}
        <Group justify="space-between" align="center">
          <Text fw={600}>{t('newConv.channel', 'Type')}</Text>
          <SegmentedControl
            value={channel}
            onChange={(v) => {
              setChannel(v);
              setPickerInfo('');
            }}
            data={[
              { label: t('newConv.chatforia', 'Chatforia'), value: 'chat' },
              { label: t('newConv.sms', 'SMS'), value: 'sms' },
            ]}
          />
        </Group>

        <Divider my="xs" />

        {/* CHATFORIA */}
        {channel === 'chat' && (
          <Stack gap="xs">
            <Group justify="space-between" align="center">
              <Text fw={600}>{t('newConv.mode', 'Mode')}</Text>
              <SegmentedControl
                value={mode}
                onChange={setMode}
                data={[
                  { label: t('newConv.group', 'Group chat'), value: 'group' },
                  { label: t('newConv.separate', 'Separate chats'), value: 'broadcast' },
                ]}
              />
            </Group>

            <Group justify="space-between" align="center">
              <Text fw={600}>{t('newConv.recipients', 'Recipients')}</Text>
              {recipients.length > 1 && (
                <Badge variant="light">
                  {t('newConv.selectedCount', '{{count}} selected', {
                    count: recipients.length,
                  })}
                </Badge>
              )}
            </Group>

            <RecipientSelector
              value={recipients}
              onChange={setRecipients}
              fetchSuggestions={fetchSuggestions}
              onRequestBrowse={() => setShowContacts(true)}
              maxRecipients={50}
              placeholder={t(
                'newConv.placeholder',
                'Type a name or username…'
              )}
              allowRaw={false}
            />

            {mode === 'group' && (
              <TextInput
                label={t('newConv.groupNameOptional', 'Group name (optional)')}
                placeholder={t('newConv.groupNamePlaceholder', 'Ex: Friends')}
                value={groupName}
                onChange={(e) => setGroupName(e.currentTarget.value)}
              />
            )}

            {mode === 'broadcast' && (
              <TextInput
                label={t(
                  'newConv.firstMessageOptional',
                  'First message (optional but recommended)'
                )}
                placeholder={t('newConv.firstMessagePlaceholder', 'Hey! Quick update…')}
                value={seedMessage}
                onChange={(e) => setSeedMessage(e.currentTarget.value)}
              />
            )}

            <Group justify="flex-end">
              <Button
                onClick={startChatforia}
                loading={starting}
                disabled={
                  !recipients.length ||
                  (mode === 'group' && recipients.filter((r) => r?.id).length < 2)
                }
              >
                {mode === 'group'
                  ? t('newConv.createGroup', 'Create group')
                  : nonRawCount <= 1
                    ? t('newConv.sendSingle', 'Send message')
                    : t('newConv.sendMany', 'Send to {{count}} chats', { count: nonRawCount })}
              </Button>
            </Group>

            <Divider my="xs" />

            {/* Contact picker (Chatforia-only) */}
            <Group justify="center">
              <Divider
                label={t('newConv.pickFromContacts', 'Or pick from contacts')}
                labelPosition="center"
                my="xs"
              />
              {!showContacts && (
                <Button
                  variant="light"
                  onClick={() => setShowContacts(true)}
                  aria-label={t('newConv.pick', 'Pick')}
                >
                  {t('newConv.pick', 'Pick')}
                </Button>
              )}
            </Group>

            {showContacts && (
              <ScrollArea style={{ maxHeight: 300 }}>
                <ContactList
                  currentUserId={currentUserId}
                  onChanged={setContacts}
                  selectionMode="multiple"
                  selectedIds={recipients.map((r) => r.id)}
                  onToggleSelect={(id) => {
                    const c = contacts.find((x) => (x.userId || x.id) === id);
                    if (!c?.userId) return; // chat mode only accepts userId contacts
                    const resolvedId = c.userId;
                    const display =
                      c.alias || c.user?.username || c.name || 'Contact';

                    setRecipients((prev) => {
                      const next = [...prev];
                      const i = next.findIndex((r) => r.id === resolvedId);
                      if (i >= 0) next.splice(i, 1);
                      else next.push({ id: resolvedId, display, type: 'contact' });
                      return next;
                    });
                  }}
                />
              </ScrollArea>
            )}
          </Stack>
        )}

        {/* SMS */}
        {channel === 'sms' && (
          <Stack gap="xs">
            <TextInput
              label={t('newConv.smsTo', 'To (phone number)')}
              placeholder={t('newConv.smsPlaceholder', 'Ex: +15551234567 or (555) 123-4567')}
              value={smsTo}
              onChange={(e) => setSmsTo(e.currentTarget.value)}
            />

            <Group justify="flex-end">
              <Button onClick={startSms} loading={starting}>
                {t('newConv.smsCompose', 'Compose SMS')}
              </Button>
            </Group>
          </Stack>
        )}

        {pickerInfo && (
          <Text size="sm" c="dimmed">
            {pickerInfo}
          </Text>
        )}

        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" onClick={handleClose}>
            {t('newConv.close', 'Close')}
          </Button>
        </Group>

        {!isPremium && (
          <div style={{ marginTop: 8 }}>
            <AdSlot placement={PLACEMENTS.START_CHAT_MODAL_FOOTER} />
          </div>
        )}
      </Stack>
    </Modal>
  );
}
