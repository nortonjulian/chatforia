// client/src/components/StartChatModal.jsx
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axiosClient from '@/api/axiosClient';
import ContactList from './ContactList';
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
import AdSlot from '../ads/AdSlot';
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

export default function StartChatModal({
  currentUserId,
  onClose,
  initialQuery = '',
  hideSearch = false,
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isPremium = useIsPremium();

  // unified recipients + modes
  const [recipients, setRecipients] = useState([]);
  const [startingBulk, setStartingBulk] = useState(false);
  const [pickerInfo, setPickerInfo] = useState('');

  // Mode: 'group' | 'broadcast' (internal)
  const [mode, setMode] = useState('group');
  const [groupName, setGroupName] = useState('');
  const [seedMessage, setSeedMessage] = useState('');

  const [showContacts, setShowContacts] = useState(false);
  const [contacts, setContacts] = useState([]);

  const nonRawCount = recipients.filter((r) => r.id && r.type !== 'raw').length;

  // Reset + close helper
  const handleClose = () => {
    setRecipients([]);
    setGroupName('');
    setSeedMessage('');
    setPickerInfo('');
    setShowContacts(false);
    onClose?.();
  };

  // Suggestions: merge contacts + users
  const fetchSuggestions = useCallback(
    async (q) => {
      const query = (q || '').trim();
      if (!query) return [];

      try {
        const [contactsRes, usersRes] = await Promise.allSettled([
          axiosClient.get('/contacts', { params: { query, limit: 20 } }),
          axiosClient.get('/users/search', { params: { query } }),
        ]);

        const contactsData =
          contactsRes.status === 'fulfilled'
            ? Array.isArray(contactsRes.value?.data)
              ? contactsRes.value.data
              : contactsRes.value?.data?.items || []
            : [];

        const usersData =
          usersRes.status === 'fulfilled'
            ? coerceUsers(usersRes.value?.data)
            : [];

        const contactItems = contactsData
          .map((c) => ({
            id: c.userId || c.id,
            display: c.alias || c.name || c.phone || c.email || 'Contact',
            type: 'contact',
            phone: c.phone,
            email: c.email,
          }))
          .filter((it) => it.id && it.id !== currentUserId);

        const userItems = usersData
          .map((u) => ({
            id: u.id,
            display: u.username || u.name || u.phoneNumber || u.email || 'User',
            type: 'user',
            phone: u.phoneNumber,
            email: u.email,
          }))
          .filter((it) => it.id && it.id !== currentUserId);

        const map = new Map();
        for (const it of [...userItems, ...contactItems]) {
          if (!map.has(it.id)) map.set(it.id, it);
        }
        return Array.from(map.values()).slice(0, 20);
      } catch {
        try {
          const res = await axiosClient.get('/users/search', { params: { query } });
          const users = coerceUsers(res?.data);
          return users
            .filter((u) => u && u.id !== currentUserId)
            .map((u) => ({
              id: u.id,
              display: u.username || u.name || u.phoneNumber || u.email || 'User',
              type: 'user',
              phone: u.phoneNumber,
              email: u.email,
            }));
        } catch {
          return [];
        }
      }
    },
    [currentUserId]
  );

  const handleStartWithRecipients = async () => {
    setPickerInfo('');

    if (!recipients.length) {
      setPickerInfo(
        t('startChatModal.pickAtLeastOne', 'Pick at least one recipient.')
      );
      return;
    }

    const nonRawRecipients = recipients.filter((r) => r.id && r.type !== 'raw');
    const ids = nonRawRecipients.map((r) => r.id);
    const hasRaw = recipients.some((r) => r.type === 'raw');

    if (hasRaw) {
      setPickerInfo(
        t(
          'startChatModal.saveContactsHint',
          'Phone/email entries will be available after you save them as contacts.'
        )
      );
    }

    if (!ids.length) return;

    if (mode === 'group' && ids.length < 2) {
      setPickerInfo(
        t(
          'startChatModal.selectAtLeastTwoForGroup',
          'Select at least 2 recipients for a group.'
        )
      );
      return;
    }

    try {
      setStartingBulk(true);

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

      // "Separate chats" mode: one 1:1 chat per person
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
      if (createdRoomIds[0]) {
        navigate(`/chat/${createdRoomIds[0]}`);
      } else {
        navigate(`/`);
      }
    } catch {
      setPickerInfo(
        t(
          'startChatModal.failedBulkStart',
          'Failed to start chat with selected recipients.'
        )
      );
    } finally {
      setStartingBulk(false);
    }
  };

  return (
    <Modal
      opened
      onClose={handleClose}
      title={<Title order={4}>{t('startChatModal.title', 'Start a chat')}</Title>}
      radius="xl"
      centered
      size="lg"
      aria-label={t('startChatModal.title', 'Start a chat')}
    >
      <Stack gap="sm">
        {/* Mode toggle */}
        <Group justify="space-between" align="center">
          <Text fw={600}>{t('startChatModal.mode', 'Mode')}</Text>
          <SegmentedControl
            value={mode}
            onChange={setMode}
            data={[
              {
                label: t('startChatModal.group', 'Group chat'),
                value: 'group',
              },
              {
                // internal value is still "broadcast", but user sees "Separate chats"
                label: t('startChatModal.separate', 'Separate chats'),
                value: 'broadcast',
              },
            ]}
          />
        </Group>

        {/* Recipients selector */}
        <Stack gap="xs">
          <Group justify="space-between" align="center">
            <Text fw={600}>{t('startChatModal.recipients', 'Recipients')}</Text>
            {recipients.length > 1 && (
              <Badge variant="light">
                {t('startChatModal.selectedCount', '{{count}} selected', {
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
              'startChatModal.nameUsernamePhoneEmail',
              'Type a name, username, phone, or email…'
            )}
          />

          {mode === 'group' && (
            <TextInput
              label={t('startChatModal.groupNameOptional', 'Group name (optional)')}
              placeholder={t(
                'startChatModal.groupNamePlaceholder',
                'Ex: Friends in Denver'
              )}
              value={groupName}
              onChange={(e) => setGroupName(e.currentTarget.value)}
            />
          )}

          {mode === 'broadcast' && (
            <TextInput
              label={t(
                'startChatModal.firstMessageOptional',
                'First message (optional but recommended)'
              )}
              placeholder={t(
                'startChatModal.firstMessagePlaceholder',
                'Hey! Quick update…'
              )}
              value={seedMessage}
              onChange={(e) => setSeedMessage(e.currentTarget.value)}
            />
          )}

          <Group justify="flex-end">
            <Button
              onClick={handleStartWithRecipients}
              disabled={
                !recipients.length ||
                (mode === 'group' &&
                  recipients.filter((r) => r.id && r.type !== 'raw').length < 2)
              }
              loading={startingBulk}
            >
              {mode === 'group'
                ? t('startChatModal.createGroup', 'Create group')
                : nonRawCount <= 1
                  ? t('startChatModal.sendSingle', 'Send message')
                  : t('startChatModal.sendBroadcast', 'Send to {{count}} chats', {
                      count: nonRawCount || 0,
                    })}
            </Button>
          </Group>

          {pickerInfo && (
            <Text size="sm" c="dimmed">
              {pickerInfo}
            </Text>
          )}

          <Divider my="xs" />
        </Stack>

        {/* Contact picker section */}
        <Group justify="center">
          <Divider
            label={t('startChatModal.pickFromContacts', 'Or pick from contacts')}
            labelPosition="center"
            my="xs"
          />
          {!showContacts && (
            <Button
              variant="light"
              onClick={() => setShowContacts(true)}
              aria-label={t('startChatModal.show', 'Show')}
            >
              {t('startChatModal.show', 'Show')}
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
                const c = contacts.find((x) => (x.userId || x.externalPhone) === id);
                if (!c) return;
                const resolvedId = c.userId || c.externalPhone;
                const display =
                  c.alias ||
                  c.user?.username ||
                  c.externalName ||
                  c.externalPhone ||
                  'Contact';

                setRecipients((prev) => {
                  const next = [...prev];
                  const i = next.findIndex((r) => r.id === resolvedId);
                  if (i >= 0) next.splice(i, 1);
                  else
                    next.push({
                      id: resolvedId,
                      display,
                      type: c.userId ? 'contact' : 'external',
                    });
                  return next;
                });
              }}
            />
          </ScrollArea>
        )}

        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" onClick={handleClose}>
            {t('startChatModal.close', 'Close')}
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
