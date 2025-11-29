import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axiosClient from '@/api/axiosClient';
import ContactList from './ContactList';
import RecipientSelector from './RecipientSelector.jsx';
import PhoneField from '@/components/PhoneField.jsx';
import {
  Modal,
  TextInput,
  Button,
  Stack,
  Divider,
  Title,
  Group,
  Alert,
  ScrollArea,
  Text,
  Paper,
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
  const { t } = useTranslation(); // default ns = 'translation'

  // ---------- NEW: quick-pick recipients + modes ----------
  const [recipients, setRecipients] = useState([]);
  const [startingBulk, setStartingBulk] = useState(false);
  const [pickerInfo, setPickerInfo] = useState('');

  // Mode: 'group' | 'broadcast'
  // - group      -> one shared room with many participants
  // - broadcast  -> separate 1:1 chats (multi-send)
  const [mode, setMode] = useState('group');
  const [groupName, setGroupName] = useState('');
  const [seedMessage, setSeedMessage] = useState('');

  const navigate = useNavigate();
  const isPremium = useIsPremium();

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

        const contacts =
          contactsRes.status === 'fulfilled'
            ? Array.isArray(contactsRes.value?.data)
              ? contactsRes.value.data
              : contactsRes.value?.data?.items || []
            : [];

        const users =
          usersRes.status === 'fulfilled'
            ? coerceUsers(usersRes.value?.data)
            : [];

        // Normalize
        const contactItems = contacts
          .map((c) => ({
            id: c.userId || c.id,
            display: c.alias || c.name || c.phone || c.email || 'Contact',
            type: 'contact',
            phone: c.phone,
            email: c.email,
          }))
          .filter((it) => it.id && it.id !== currentUserId);

        const userItems = users
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
      setPickerInfo(t('startChatModal.pickAtLeastOne', 'Pick at least one recipient.'));
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
        // One shared room with all participants
        const { data: chatroom } = await axiosClient.post('/chatrooms', {
          participantIds: ids,
          title: groupName?.trim() || undefined,
        });
        onClose?.();
        if (chatroom?.id) navigate(`/chat/${chatroom.id}`);
        return;
      }

      // Separate 1:1 chats (multi-send / "broadcast")
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
          // /messages accepts { chatRoomId, content }
          await axiosClient.post('/messages', {
            chatRoomId: roomId,
            content: messageText,
          });
        }
      }

      onClose?.();
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

  // ---------- Existing search ----------
  const [query, setQuery] = useState(initialQuery);
  const [hasSearched, setHasSearched] = useState(false);

  const [results, setResults] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [aliasEdits, setAliasEdits] = useState({});
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [startingId, setStartingId] = useState(null);
  const [error, setError] = useState('');

  const [showContacts, setShowContacts] = useState(false);

  // "Add a Contact" inline UI state
  const [addOpen, setAddOpen] = useState(false);
  const [addAlias, setAddAlias] = useState('');
  const [addUsernameOrEmail, setAddUsernameOrEmail] = useState('');
  const [addPhone, setAddPhone] = useState();
  const [adding, setAdding] = useState(false);

  // Load contacts initially
  useEffect(() => {
    axiosClient
      .get('/contacts')
      .then((res) =>
        setContacts(Array.isArray(res?.data) ? res.data : res?.data?.items || [])
      )
      .catch(() => {});
  }, [currentUserId]);

  const savedMap = useMemo(() => {
    const map = new Map();
    (contacts || []).forEach((c) => {
      if (c.userId) map.set(c.userId, c);
    });
    return map;
  }, [contacts]);

  useEffect(() => {
    setQuery(initialQuery || '');
    if (initialQuery?.trim()) {
      runSearch(initialQuery.trim());
    } else {
      setResults([]);
      setHasSearched(false);
    }
  }, [initialQuery]);

  const runSearch = async (qStr) => {
    const q = (qStr ?? query).trim();
    setError('');
    setHasSearched(true);
    setResults([]);

    if (!q) return;

    setLoading(true);
    try {
      const res = await axiosClient.get('/users/search', { params: { query: q } });
      const arr = coerceUsers(res?.data);
      const cleaned = arr.filter((u) => u && u.id !== currentUserId);
      setResults(cleaned);

      const seed = {};
      cleaned.forEach((u) => {
        const saved = savedMap.get(u.id);
        if (saved?.alias) seed[u.id] = saved.alias;
      });
      setAliasEdits((prev) => ({ ...seed, ...prev }));
    } catch {
      setError(t('startChatModal.searchFailed', 'Failed to search users.'));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (user) => {
    setSavingId(user.id);
    setError('');
    try {
      await axiosClient.post('/contacts', {
        ownerId: currentUserId,
        userId: user.id,
        alias: aliasEdits[user.id] || undefined,
      });
    } catch {
      setError(t('startChatModal.saveContactFailed', 'Failed to save contact.'));
    } finally {
      setSavingId(null);
    }
  };

  const handleUpdateAlias = async (user) => {
    setUpdatingId(user.id);
    setError('');
    try {
      await axiosClient.patch('/contacts', {
        ownerId: currentUserId,
        userId: user.id,
        alias: aliasEdits[user.id] || '',
      });
    } catch {
      setError(t('startChatModal.updateAliasFailed', 'Failed to update alias.'));
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDelete = async (user) => {
    setDeletingId(user.id);
    setError('');
    try {
      await axiosClient.delete('/contacts', {
        data: { ownerId: currentUserId, userId: user.id },
      });
    } catch {
      setError(t('startChatModal.deleteContactFailed', 'Failed to delete contact.'));
    } finally {
      setDeletingId(null);
    }
  };

  const handleStartChat = async (user) => {
    setStartingId(user.id);
    setError('');
    try {
      const chatRes = await axiosClient.post(`/chatrooms/direct/${user.id}`);
      const chatroom = chatRes?.data;
      onClose?.();
      if (chatroom?.id) navigate(`/chat/${chatroom.id}`);
    } catch {
      setError(t('startChatModal.startChatFailed', 'Failed to start chat.'));
    } finally {
      setStartingId(null);
    }
  };

  /**
   * THE ONLY CHANGE REQUESTED:
   * Refresh contacts after adding a contact (for test compatibility)
   */
  const handleAddContactDirect = async () => {
    setError('');
    const phone = addPhone;
    const raw = (addUsernameOrEmail || '').trim();
    if (!phone && !raw) return;

    setAdding(true);
    try {
      if (phone) {
        await axiosClient.post('/contacts', {
          ownerId: currentUserId,
          externalPhone: phone,
          externalName: addAlias || '',
          alias: addAlias || undefined,
        });

        axiosClient.post('/invites', { phone, name: addAlias }).catch(() => {});
      } else {
        const res = await axiosClient.get('/users/search', {
          params: { query: raw },
        });
        const arr = coerceUsers(res?.data);
        const u = arr.find((x) => x && x.id !== currentUserId);

        if (u) {
          await axiosClient.post('/contacts', {
            ownerId: currentUserId,
            userId: u.id,
            alias: addAlias || undefined,
          });
        } else {
          await axiosClient.post('/contacts', {
            name: addAlias || raw,
            alias: addAlias || undefined,
          });
        }
      }

      // 🔥 Refresh contacts with limit=50 (required by Jest tests)
      try {
        const refreshed = await axiosClient.get('/contacts', {
          params: { limit: 50 },
        });
        const list = Array.isArray(refreshed?.data)
          ? refreshed.data
          : refreshed?.data?.items || [];
        setContacts(list);
      } catch {
        /* ignore */
      }

      setAddAlias('');
      setAddUsernameOrEmail('');
      setAddPhone(undefined);
      setAddOpen(false);
    } catch (e) {
      setError(
        e?.response?.data?.message ||
          e.message ||
          t('startChatModal.saveContactFailed', 'Failed to save contact.')
      );
    } finally {
      setAdding(false);
    }
  };

  const nonRawCount = recipients.filter((r) => r.id && r.type !== 'raw').length;

  return (
    <Modal
      opened
      onClose={onClose}
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
              { label: t('startChatModal.group', 'Group chat'), value: 'group' },
              {
                label: t('startChatModal.broadcast', 'Separate chats'),
                value: 'broadcast',
              },
            ]}
          />
        </Group>

        {/* Quick picker */}
        <Stack gap="xs">
          <Group justify="space-between" align="center">
            <Text fw={600}>{t('startChatModal.quickPicker', 'Quick picker')}</Text>
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
                : nonRawCount === 1
                  ? t('startChatModal.sendSingle', 'Send message')
                  : t(
                      'startChatModal.sendBroadcast',
                      'Send to {{count}} chats',
                      { count: nonRawCount || 0 }
                    )}
            </Button>
          </Group>

          {pickerInfo && (
            <Text size="sm" c="dimmed">
              {pickerInfo}
            </Text>
          )}

          <Divider my="xs" />
        </Stack>

        {/* Existing search */}
        {!hideSearch && (
          <Group align="end" wrap="nowrap">
            <TextInput
              style={{ flex: 1 }}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder={t(
                'startChatModal.searchByUsernameOrPhone',
                'Search by username or phone'
              )}
              aria-label={t('startChatModal.searchByUsernameOrPhone', 'Search by username or phone')}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            />
            <Button onClick={() => runSearch()} loading={!!loading}>
              {t('startChatModal.search', 'Search')}
            </Button>
          </Group>
        )}

        {error && <Alert color="red">{error}</Alert>}

        {results.length > 0 ? (
          <Stack gap="xs">
            {results.map((u) => {
              const saved = savedMap.get(u.id);
              const busy =
                savingId === u.id ||
                updatingId === u.id ||
                deletingId === u.id ||
                startingId === u.id;

              return (
                <Paper key={u.id} withBorder radius="md" p="sm">
                  <Group justify="space-between" align="center">
                    <Stack gap={2} style={{ minWidth: 0 }}>
                      <Text fw={600} truncate>
                        {u.username}
                      </Text>
                      <Text c="dimmed" size="sm">
                        {u.phoneNumber || u.email || 'User'}
                      </Text>
                      <TextInput
                        placeholder={t('startChatModal.aliasOptional', 'Alias (optional)')}
                        value={aliasEdits[u.id] ?? (saved?.alias || '')}
                        onChange={(e) =>
                          setAliasEdits((prev) => ({
                            ...prev,
                            [u.id]: e.currentTarget.value,
                          }))
                        }
                        maw={280}
                      />
                    </Stack>

                    <Group wrap="nowrap">
                      {!saved ? (
                        <Button
                          variant="light"
                          loading={savingId === u.id}
                          onClick={() => handleSave(u)}
                          disabled={busy}
                        >
                          {t('common.save', 'Save')}
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="light"
                            loading={updatingId === u.id}
                            onClick={() => handleUpdateAlias(u)}
                            disabled={busy}
                          >
                            {t('startChatModal.update', 'Update')}
                          </Button>
                          <Button
                            color="red"
                            variant="light"
                            loading={deletingId === u.id}
                            onClick={() => handleDelete(u)}
                            disabled={busy}
                          >
                            {t('startChatModal.delete', 'Delete')}
                          </Button>
                        </>
                      )}
                      <Button
                        loading={startingId === u.id}
                        onClick={() => handleStartChat(u)}
                        disabled={busy}
                      >
                        {t('startChatModal.start', 'Start')}
                      </Button>
                    </Group>
                  </Group>
                </Paper>
              );
            })}

            {!isPremium && (
              <div style={{ marginTop: 8 }}>
                <AdSlot placement={PLACEMENTS.SEARCH_RESULTS_FOOTER} />
              </div>
            )}
          </Stack>
        ) : (
          <>
            {hasSearched ? (
              <Text c="dimmed">{t('startChatModal.noResults', 'No results')}</Text>
            ) : hideSearch ? (
              <Text c="dimmed">
                {t(
                  'startChatModal.usePageSearch',
                  'Use the page search to find people, or pick from contacts below.'
                )}
              </Text>
            ) : (
              <Text c="dimmed">
                {t(
                  'startChatModal.searchPrompt',
                  'Type a username or phone and press Search.'
                )}
              </Text>
            )}
          </>
        )}

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

        <Divider
          label={t('startChatModal.addContact', 'Add a Contact')}
          labelPosition="center"
          my="xs"
        />

        {!addOpen ? (
          <Group justify="flex-start">
            <Button type="button" onClick={() => setAddOpen(true)}>
              {t('startChatModal.add', 'Add')}
            </Button>
          </Group>
        ) : (
          <Stack gap="xs">
            <Group align="end" wrap="wrap">
              <PhoneField
                label={t('startChatModal.phoneOptional', 'Phone (optional)')}
                value={addPhone}
                onChange={setAddPhone}
                defaultCountry="US"
              />
              <TextInput
                style={{ flex: 1, minWidth: 240 }}
                placeholder={t(
                  'startChatModal.usernameOrEmailOptional',
                  'Username or email (optional)'
                )}
                value={addUsernameOrEmail}
                onChange={(e) => setAddUsernameOrEmail(e.currentTarget.value)}
              />
              <TextInput
                style={{ flex: 1, minWidth: 200 }}
                placeholder={t('startChatModal.aliasOptional', 'Alias (optional)')}
                value={addAlias}
                onChange={(e) => setAddAlias(e.currentTarget.value)}
              />
            </Group>

            <Group>
              <Button loading={adding} onClick={handleAddContactDirect}>
                {t('startChatModal.saveContact', 'Save Contact')}
              </Button>
              <Button
                variant="light"
                color="gray"
                onClick={() => {
                  setAddAlias('');
                  setAddUsernameOrEmail('');
                  setAddPhone(undefined);
                  setAddOpen(false);
                }}
              >
                {t('common.cancel', 'Cancel')}
              </Button>
            </Group>
          </Stack>
        )}

        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" onClick={onClose}>
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
