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
// Optional icons (safe to remove if you prefer text-only labels)
// import { IconUsers, IconMegaphone } from '@tabler/icons-react';

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
  // ---------- NEW: quick-pick recipients + modes ----------
  const [recipients, setRecipients] = useState([]); // [{id, display, type, phone, email} or {type:'raw', ...}]
  const [startingBulk, setStartingBulk] = useState(false);
  const [pickerInfo, setPickerInfo] = useState('');

  // Mode: 'group' | 'broadcast'
  const [mode, setMode] = useState('group');
  const [groupName, setGroupName] = useState('');
  const [seedMessage, setSeedMessage] = useState(''); // used for broadcast

  const navigate = useNavigate();
  const isPremium = useIsPremium();

  // Suggestions: merge contacts + users (dedup by id), filter out self
  const fetchSuggestions = useCallback(
    async (q) => {
      const query = (q || '').trim();
      if (!query) return [];

      try {
        // Try contacts (if endpoint supports query); ignore failures silently
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

        // Normalize to RecipientSelector's shape
        const contactItems = contacts
          .map((c) => ({
            id: c.userId || c.id, // prefer linked userId when present
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

        // Dedup by id preferring user over contact when both exist
        const map = new Map();
        for (const it of [...userItems, ...contactItems]) {
          if (!map.has(it.id)) map.set(it.id, it);
        }
        return Array.from(map.values()).slice(0, 20);
      } catch {
        // Fallback to just user search if anything explodes
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
      setPickerInfo('Pick at least one recipient.');
      return;
    }

    // We only start chats with recipients that resolve to a known userId.
    const ids = recipients
      .filter((r) => r.id && r.type !== 'raw')
      .map((r) => r.id);

    const hasRaw = recipients.some((r) => r.type === 'raw');
    if (hasRaw) {
      // Optional UX hint: raw entries need to be saved or invited first
      setPickerInfo('Phone/email entries will be available after you save them as contacts.');
    }

    if (!ids.length) return;

    // Validate selection by mode
    if (mode === 'group' && ids.length < 2) {
      setPickerInfo('Select at least 2 recipients for a group.');
      return;
    }

    try {
      setStartingBulk(true);

      if (mode === 'group') {
        // GROUP: one room with all participants (plus optional title)
        const { data: chatroom } = await axiosClient.post('/chatrooms', {
          participantIds: ids,
          title: groupName?.trim() || undefined,
        });
        onClose?.();
        if (chatroom?.id) navigate(`/chat/${chatroom.id}`);
        return;
      }

      // BROADCAST: N 1:1 rooms (server may support /broadcasts)
      const payload = {
        participantIds: ids,
        message: seedMessage?.trim() || undefined,
      };

      let createdRoomIds = [];
      let usedServerBroadcast = false;

      try {
        const { data } = await axiosClient.post('/broadcasts', payload);
        createdRoomIds = data?.createdRoomIds || [];
        usedServerBroadcast = true;
      } catch {
        // Fallback: client-side loop to create 1:1 rooms + optional seed message
        for (const id of ids) {
          const { data } = await axiosClient.post('/chatrooms', { participantIds: [id] });
          const roomId = data?.chatRoomId || data?.id; // support either shape
          if (roomId) {
            createdRoomIds.push(roomId);
            if (payload.message) {
              await axiosClient.post(`/messages`, { chatRoomId: roomId, text: payload.message });
            }
          }
        }
      }

      onClose?.();
      // Navigate to the first created thread for continuity
      if (createdRoomIds[0]) {
        navigate(`/chat/${createdRoomIds[0]}`);
      } else if (usedServerBroadcast) {
        // In case server broadcast didn't return IDs, fall back to inbox
        navigate(`/`);
      }
    } catch {
      setPickerInfo('Failed to start chat with selected recipients.');
    } finally {
      setStartingBulk(false);
    }
  };

  // ---------- Existing state/logic (search & contacts) ----------
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
  const [addPhone, setAddPhone] = useState(); // E.164 from PhoneField
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setError('Failed to search users.');
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
      setError('Failed to save contact.');
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
      setError('Failed to update alias.');
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
      setError('Failed to delete contact.');
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
      setError('Failed to start chat.');
    } finally {
      setStartingId(null);
    }
  };

  // ✅ Add contact: prefer PhoneField (E.164). If not provided, try username/email search path.
  const handleAddContactDirect = async () => {
    setError('');
    const phone = addPhone; // already E.164 from PhoneField
    const raw = addUsernameOrEmail.trim();
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
        // fire & forget optional invite
        axiosClient.post('/invites', { phone, name: addAlias }).catch(() => {});
      } else {
        // No phone provided; treat as username/email lookup
        const res = await axiosClient.get('/users/search', { params: { query: raw } });
        const arr = coerceUsers(res?.data);
        const u = arr.find((x) => x && x.id !== currentUserId);

        if (u) {
          await axiosClient.post('/contacts', {
            ownerId: currentUserId,
            userId: u.id,
            alias: addAlias || undefined,
          });
        } else {
          // fallback: free-form name only
          await axiosClient.post('/contacts', {
            name: addAlias || raw,
            alias: addAlias || undefined,
          });
        }
      }

      // reset inputs
      setAddAlias('');
      setAddUsernameOrEmail('');
      setAddPhone(undefined);
      setAddOpen(false);
    } catch (e) {
      setError(e?.response?.data?.message || e.message || 'Failed to add contact.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <Modal
      opened
      onClose={onClose}
      title={<Title order={4}>Start a chat</Title>}
      radius="xl"
      centered
      size="lg"
      aria-label="Start a chat"
    >
      <Stack gap="sm">
        {/* ---------- NEW: Mode toggle (Group vs Broadcast) ---------- */}
        <Group justify="space-between" align="center">
          <Text fw={600}>Mode</Text>
          <SegmentedControl
            value={mode}
            onChange={setMode}
            data={[
              // { label: <Group gap={6}><IconUsers size={16}/> <span>Group</span></Group>, value: 'group' },
              // { label: <Group gap={6}><IconMegaphone size={16}/> <span>Broadcast</span></Group>, value: 'broadcast' },
              { label: 'Group', value: 'group' },
              { label: 'Broadcast', value: 'broadcast' },
            ]}
          />
        </Group>

        {/* ---------- NEW: Quick picker using RecipientSelector ---------- */}
        <Stack gap="xs">
          <Group justify="space-between" align="center">
            <Text fw={600}>Quick picker</Text>
            {recipients.length > 1 && (
              <Badge variant="light">{recipients.length} selected</Badge>
            )}
          </Group>

          <RecipientSelector
            value={recipients}
            onChange={setRecipients}
            fetchSuggestions={fetchSuggestions}
            onRequestBrowse={() => setShowContacts(true)}
            maxRecipients={50}
            placeholder="Type a name, username, phone, or email…"
          />

          {/* Group extras */}
          {mode === 'group' && (
            <TextInput
              label="Group name (optional)"
              placeholder="Ex: Friends in Denver"
              value={groupName}
              onChange={(e) => setGroupName(e.currentTarget.value)}
            />
          )}

          {/* Broadcast extras */}
          {mode === 'broadcast' && (
            <TextInput
              label="First message (optional but recommended)"
              placeholder="Hey! Quick update…"
              value={seedMessage}
              onChange={(e) => setSeedMessage(e.currentTarget.value)}
            />
          )}

          <Group justify="flex-end">
            <Button
              onClick={handleStartWithRecipients}
              disabled={
                !recipients.length ||
                (mode === 'group' && recipients.filter((r) => r.id && r.type !== 'raw').length < 2)
              }
              loading={startingBulk}
            >
              {mode === 'group' ? 'Create group' : 'Send broadcast'}
            </Button>
          </Group>

          {pickerInfo && (
            <Text size="sm" c="dimmed">
              {pickerInfo}
            </Text>
          )}

          <Divider my="xs" />
        </Stack>

        {/* ---------- Existing search box ---------- */}
        {!hideSearch && (
          <Group align="end" wrap="nowrap">
            <TextInput
              style={{ flex: 1 }}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder="Search by username or phone"
              aria-label="Search users"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            />
            <Button onClick={() => runSearch()} loading={!!loading}>
              Search
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
                        placeholder="Alias (optional)"
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
                          Save
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="light"
                            loading={updatingId === u.id}
                            onClick={() => handleUpdateAlias(u)}
                            disabled={busy}
                          >
                            Update
                          </Button>
                          <Button
                            color="red"
                            variant="light"
                            loading={deletingId === u.id}
                            onClick={() => handleDelete(u)}
                            disabled={busy}
                          >
                            Delete
                          </Button>
                        </>
                      )}
                      <Button
                        loading={startingId === u.id}
                        onClick={() => handleStartChat(u)}
                        disabled={busy}
                      >
                        Start
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
              <Text c="dimmed">No results</Text>
            ) : hideSearch ? (
              <Text c="dimmed">
                Use the page search to find people, or pick from contacts below.
              </Text>
            ) : (
              <Text c="dimmed">Type a username or phone and press Search.</Text>
            )}
          </>
        )}

        <Group justify="center">
          <Divider label="Or pick from contacts" labelPosition="center" my="xs" />
          {!showContacts && (
            <Button
              variant="light"
              onClick={() => setShowContacts(true)}
              aria-label="Show contacts"
            >
              Show
            </Button>
          )}
        </Group>

        {showContacts && (
          <ScrollArea style={{ maxHeight: 300 }}>
            {/* Picker mode with multi-select */}
            <ContactList
              currentUserId={currentUserId}
              onChanged={setContacts}
              selectionMode="multiple"
              selectedIds={recipients.map((r) => r.id)}           // keep UI in sync
              onToggleSelect={(id) => {
                // resolve the contact by id; then push into recipients (shape { id, display, type })
                const c = contacts.find((x) => (x.userId || x.externalPhone) === id);
                if (!c) return;
                const resolvedId = c.userId || c.externalPhone; // choose your key
                const display =
                  c.alias || c.user?.username || c.externalName || c.externalPhone || 'Contact';

                setRecipients((prev) => {
                  const next = [...prev];
                  const i = next.findIndex((r) => r.id === resolvedId);
                  if (i >= 0) next.splice(i, 1);
                  else next.push({ id: resolvedId, display, type: c.userId ? 'contact' : 'external' });
                  return next;
                });
              }}
            />
          </ScrollArea>
        )}

        <Divider label="Add a Contact" labelPosition="center" my="xs" />

        {!addOpen ? (
          <Group justify="flex-start">
            <Button type="button" onClick={() => setAddOpen(true)}>
              Add
            </Button>
          </Group>
        ) : (
          <Stack gap="xs">
            <Group align="end" wrap="wrap">
              <PhoneField
                label="Phone (optional)"
                value={addPhone}
                onChange={setAddPhone}
                defaultCountry="US"
              />
              <TextInput
                style={{ flex: 1, minWidth: 240 }}
                placeholder="Username or email (optional)"
                value={addUsernameOrEmail}
                onChange={(e) => setAddUsernameOrEmail(e.currentTarget.value)}
              />
              <TextInput
                style={{ flex: 1, minWidth: 200 }}
                placeholder="Alias (optional)"
                value={addAlias}
                onChange={(e) => setAddAlias(e.currentTarget.value)}
              />
            </Group>

            <Group>
              <Button loading={adding} onClick={handleAddContactDirect}>
                Save Contact
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
                Cancel
              </Button>
            </Group>
          </Stack>
        )}

        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" onClick={onClose}>
            Close
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
