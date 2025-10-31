import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axiosClient from '@/api/axiosClient';
import ContactList from './ContactList';
import RecipientSelector from '@/components/compose/RecipientSelector.jsx';
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
} from '@mantine/core';

// Ads
import AdSlot from '../ads/AdSlot';
import { PLACEMENTS } from '@/ads/placements';

// Premium gating
import useIsPremium from '@/hooks/useIsPremium';

// 🌍 Phone utils: strict (prod) + permissive (dev/test) fallback
import { toE164, isLikelyPhone } from '@/utils/phone';
import useDefaultRegion from '@/hooks/useDefaultRegion';
import CountrySelect from '@/components/CountrySelect';
import { toE164Dev } from '@/utils/phoneLocalDev';

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
  // ---------- NEW: quick-pick recipients ----------
  const [recipients, setRecipients] = useState([]); // [{id, display, type, ...}]
  const [startingBulk, setStartingBulk] = useState(false);
  const [pickerInfo, setPickerInfo] = useState('');

  // Suggestions: merge contacts + users (dedup by id), filter out self
  const fetchSuggestions = useCallback(async (q) => {
    const query = (q || '').trim();
    if (!query) return [];

    try {
      // Try contacts (if endpoint supports query); ignore failures silently
      const [contactsRes, usersRes] = await Promise.allSettled([
        axiosClient.get('/contacts', { params: { query, limit: 20 } }),
        axiosClient.get('/users/search', { params: { query } }),
      ]);

      const contacts = contactsRes.status === 'fulfilled'
        ? (Array.isArray(contactsRes.value?.data)
            ? contactsRes.value.data
            : contactsRes.value?.data?.items || [])
        : [];

      const users = usersRes.status === 'fulfilled' ? coerceUsers(usersRes.value?.data) : [];

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
  }, [currentUserId]);

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

    try {
      setStartingBulk(true);
      if (ids.length === 1) {
        // Use your existing 1:1 endpoint for consistency
        const chatRes = await axiosClient.post(`/chatrooms/direct/${ids[0]}`);
        const chatroom = chatRes?.data;
        onClose?.();
        if (chatroom?.id) navigate(`/chat/${chatroom.id}`);
        return;
      }
      // Group chat upsert (expects backend route)
      const chatRes = await axiosClient.post('/chatrooms', { participantIds: ids });
      const chatroom = chatRes?.data;
      onClose?.();
      if (chatroom?.id) navigate(`/chat/${chatroom.id}`);
    } catch {
      setPickerInfo('Failed to start chat with selected recipients.');
    } finally {
      setStartingBulk(false);
    }
  };

  // ---------- Existing state/logic (untouched) ----------
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
  const [addOpen, setAddOpen] = useState(false);
  const [addValue, setAddValue] = useState('');
  const [addAlias, setAddAlias] = useState('');
  const [adding, setAdding] = useState(false);

  // 🌍 NEW: Country selection (defaults via hook)
  const defaultRegion = useDefaultRegion({ userCountryCode: undefined });
  const [country, setCountry] = useState('US');
  useEffect(() => {
    setCountry(defaultRegion);
  }, [defaultRegion]);

  const navigate = useNavigate();
  const isPremium = useIsPremium();

  // Initial contacts fetch
  useEffect(() => {
    axiosClient
      .get('/contacts') // ✅ correct endpoint (owner inferred from auth)
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

  // ✅ when adding by phone, send { externalPhone, externalName, alias }
  const handleAddContactDirect = async () => {
    setError('');
    const raw = addValue.trim();
    if (!raw) return;
    setAdding(true);

    try {
      if (isLikelyPhone(raw)) {
        // Try strict formatter first; fall back to dev-safe formatter so tests/fixtures like 555-555-5555 pass.
        const phoneE164 = toE164(raw, country) || toE164Dev(raw, country);
        if (!phoneE164) throw new Error('Invalid phone number for selected country.');

        await axiosClient.post('/contacts', {
          ownerId: currentUserId,
          externalPhone: phoneE164,
          externalName: addAlias || '',
          alias: addAlias || undefined,
        });

        // fire & forget optional invite
        axiosClient.post('/invites', { phone: phoneE164, name: addAlias }).catch(() => {});
      } else {
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
          // fallback: treat as free-form “name only”
          await axiosClient.post('/contacts', {
            phone: undefined,
            name: addAlias || raw,
            alias: addAlias || undefined,
          });
        }
      }

      setAddValue('');
      setAddAlias('');
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
        {/* ---------- NEW: Quick picker using RecipientSelector ---------- */}
        <Stack gap="xs">
          <Group justify="space-between" align="center">
            <Text fw={600}>Quick picker</Text>
            {recipients.length > 1 && <Badge variant="light">{recipients.length} selected</Badge>}
          </Group>

          <RecipientSelector
            value={recipients}
            onChange={setRecipients}
            fetchSuggestions={fetchSuggestions}
            onRequestBrowse={() => setShowContacts(true)} // reuse your existing contacts section
            maxRecipients={50}
            placeholder="Type a name, username, phone, or email…"
          />

          <Group justify="flex-end">
            <Button
              onClick={handleStartWithRecipients}
              disabled={!recipients.length}
              loading={startingBulk}
            >
              Start chat with selected
            </Button>
          </Group>

          {pickerInfo && <Text size="sm" c="dimmed">{pickerInfo}</Text>}

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
            {/* NOTE: If/when ContactList supports picker mode, pass onSelect to push into `recipients` */}
            <ContactList currentUserId={currentUserId} onChanged={setContacts} />
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
          <Group align="end" wrap="wrap">
            {/* 🌍 NEW: Country selector */}
            <CountrySelect
              value={country}
              onChange={(val) => {
                setCountry(val);
                try {
                  localStorage.setItem('cf_default_region', val);
                } catch {}
              }}
              style={{ minWidth: 220 }}
            />
            <TextInput
              style={{ flex: 1, minWidth: 240 }}
              placeholder="Username or phone"
              value={addValue}
              onChange={(e) => setAddValue(e.currentTarget.value)}
            />
            <TextInput
              style={{ flex: 1, minWidth: 200 }}
              placeholder="Alias (optional)"
              value={addAlias}
              onChange={(e) => setAddAlias(e.currentTarget.value)}
            />
            <Button loading={adding} onClick={handleAddContactDirect}>
              Save Contact
            </Button>
            <Button
              variant="light"
              color="gray"
              onClick={() => {
                setAddValue('');
                setAddAlias('');
                setAddOpen(false);
              }}
            >
              Cancel
            </Button>
          </Group>
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
